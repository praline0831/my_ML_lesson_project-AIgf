import { arxivService, deepResearchService, generateAnalysisDoc, generateResearchReport, generateSearchResultDoc } from "@agent/paper";
import { LLMProviderAdapter, PaperAlignAgent, extractRepoUrl } from "@agent/paper-align";
import { Agent, ConfirmRequest, createAgent, paperTools } from "@agent/runtime";
import cors from "cors";
import express from "express";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { WebSocketServer } from "ws";

// ── 交互式对齐会话 ──
interface InteractiveSession {
  id: string;
  topic: string;
  step: 'confirm_search' | 'showing_results' | 'asking_repo' | 'aligning' | 'done' | 'cancelled';
  papers?: { id: string; title: string; authors: string[]; abstract: string; published: string; pdfUrl: string }[];
  selectedPaper?: { id: string; title: string };
  repoUrl?: string;
  report?: import("@agent/paper-align").AlignmentReport;
  error?: string;
  /** 用于 SSE 推送的响应对象 */
  res?: express.Response;
}

const interactiveSessions = new Map<string, InteractiveSession>();

function createInteractiveSession(topic: string, res: express.Response): InteractiveSession {
  const session: InteractiveSession = {
    id: crypto.randomUUID(),
    topic,
    step: 'confirm_search',
    res,
  };
  interactiveSessions.set(session.id, session);
  // 30分钟超时清理
  setTimeout(() => {
    const s = interactiveSessions.get(session.id);
    if (s && (s.step === 'confirm_search' || s.step === 'showing_results' || s.step === 'asking_repo')) {
      s.step = 'cancelled';
      pushEvent(s, { type: 'ia_cancelled', reason: 'timeout' });
      interactiveSessions.delete(session.id);
    }
  }, 30 * 60 * 1000);
  return session;
}

function pushEvent(session: InteractiveSession, data: Record<string, unknown>): void {
  if (session.res) {
    session.res.write(`data: ${JSON.stringify({ sessionId: session.id, ...data })}\n\n`);
  }
}

/** 交互式对话中的 ArXiv 搜索结果 */
interface ArxivSearchResult {
  id: string; title: string; authors: string[]; abstract: string; published: string; pdfUrl: string;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

const agent = createAgent({ verbose: false });

for (const tool of paperTools) {
  agent.registerTool(tool.name, tool.execute);
  agent.addToolDescription(tool.name, tool.description);
}

/** 最近一次对齐报告（供前端对齐模块 UI 读取） */
let lastAlignReport: import("@agent/paper-align").AlignmentReport | null = null;

// ── Agent-to-Agent: align_paper ──
// Chat agent 可以委托 PaperAlignAgent 干活，无需用户在独立界面操作
agent.registerTool('align_paper', async (args) => {
  const arxivId = args.arxiv_id as string;
  const repoUrl = args.repo_url as string | undefined;
  if (!arxivId || typeof arxivId !== 'string') {
    throw new Error('请提供 arxiv_id（如 "2106.09685"）');
  }

  const sharedProvider = agent.getLLMProvider();
  const alignAgent = new PaperAlignAgent({
    llm: new LLMProviderAdapter(sharedProvider),
    githubToken: process.env.GITHUB_TOKEN,
    proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
  });

  let report;
  try {
    report = await alignAgent.align(arxivId, repoUrl);
  } catch (e) {
    const errMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[align_paper] align 失败:', e);
    throw new Error(`论文对齐失败 (arxiv_id=${arxivId}): ${errMsg}`);
  }

  // 保存报告供前端对齐模块 UI 读取
  lastAlignReport = report;

  // 自动注入对齐结果到 agent 的长期记忆（与 /align/run 一致）
  const memory = agent.getMemory();
  if (memory && report.rows.length > 0) {
    try {
      await memory.longTerm.addSummary(
        report.paper.title,
        `Aligned ${report.rows.length} claims: ${report.summary.matched} match, ${report.summary.partial} partial, ${report.summary.mismatch} mismatch, ${report.summary.missing} missing`,
        [report.paper.title],
      );
      for (const row of report.rows) {
        if (row.matchedFunction) {
          await memory.longTerm.addAlignmentResult(
            row.claim.description, row.claim.location,
            row.matchedFunction.name, row.matchedFunction.file,
            row.status, [report.paper.title],
          );
        } else {
          await memory.longTerm.addAlignmentResult(
            row.claim.description, row.claim.location,
            '', '', row.status, [report.paper.title],
          );
        }
      }
      await memory.save();
    } catch (e) {
      console.error('[Memory injection error]', e);
    }
  }

  // 返回摘要文本（LLM 能直接读懂）
  const rows = report.rows;
  const lines: string[] = [];
  lines.push(`📄 **${report.paper.title}**`);
  lines.push(`🔗 https://arxiv.org/abs/${report.paper.arxivId}`);
  if (report.repo) lines.push(`📂 ${report.repo.owner}/${report.repo.repo}`);
  lines.push('');
  lines.push(`**对齐摘要**：共 ${report.summary.total} 个声明`);
  lines.push(`- ✅ 完全匹配: ${report.summary.matched}`);
  lines.push(`- 🟡 部分匹配: ${report.summary.partial}`);
  lines.push(`- ❌ 存在偏差: ${report.summary.mismatch}`);
  lines.push(`- ❔ 代码缺失: ${report.summary.missing}`);
  if (report.summary.total > 0) {
    const coverage = ((report.summary.matched + report.summary.partial) / report.summary.total * 100).toFixed(0);
    lines.push(`- 📊 代码覆盖率: ${coverage}%`);
  }
  lines.push('');
  lines.push('**声明清单**：');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const icon = r.status === 'match' ? '✅' : r.status === 'partial' ? '🟡' : r.status === 'mismatch' ? '❌' : '❔';
    const code = r.matchedFunction
      ? `→ ${r.matchedFunction.file}:${r.matchedFunction.name} (L${r.matchedFunction.startLine})`
      : '→ 未找到对应代码';
    lines.push(`${i + 1}. ${icon} ${r.claim.description} — ${code}`);
    lines.push(`    ${r.note} (置信度 ${(r.confidence * 100).toFixed(0)}%)`);
  }

  return lines.join('\n');
});
agent.addToolDescription(
  'align_paper',
  '论文-代码对齐工具。给定一个 ArXiv ID，自动解析论文中的方法声明（公式、算法、超参数等），' +
  '然后在 GitHub 仓库中找到对应的代码实现，逐条分析对齐程度（完全匹配/部分匹配/偏差/缺失）。' +
  '参数：arxiv_id（必填，如 "2106.09685"），repo_url（可选，GitHub 仓库地址）。' +
  '返回结构化对齐报告，包含每个声明的匹配结果、对应代码文件和行号。',
);

// ── 交互式对齐工具（供 AI agent 自主触发） ──
agent.registerTool('interactive_align', async (args) => {
  const topic = args.topic as string;
  if (!topic || typeof topic !== 'string') {
    throw new Error('请提供论文主题（如 "LoRA"）');
  }
  // 实际工作由前端的交互式对齐面板完成
  // 工具仅返回占位消息，交互流程结束后 report 通过 SSE 推回
  return `🧩 已启动交互式对齐，主题：「${topic}」。请在前端面板中完成搜索、选论文、定仓库等步骤。`;
});
agent.addToolDescription(
  'interactive_align',
  '交互式论文-代码对齐。当用户想将某篇论文与其开源代码进行对比分析时，使用此工具。' +
  '它会先搜索 arXiv 相关论文，让用户选择具体论文，再自动检测或手动输入 GitHub 仓库，最终生成逐声明的对齐报告。' +
  '参数：topic（必填，论文主题或名称，如 "LoRA"、"Transformer"、"Diffusion Model"）。' +
  '注意：此工具适合用户提供论文名称或主题而非具体 ArXiv ID 的场景。',
);

/** 健康检查 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gateway" });
});

/** 根路径 */
app.get("/", (_req, res) => {
  res.json({
    name: "@agent/gateway",
    endpoints: {
      health: "GET /health",
      chat: "POST /chat { \"message\": \"...\" }",
      websocket: "ws://localhost:PORT (echo)",
      search: "GET /papers/search?q=...&max=10",
      deepResearch: "POST /papers/deep-research { \"topic\": \"...\", \"rounds\": 3, \"per_round\": 8 }",
      alignRun: "POST /align/run { \"arxiv_id\": \"...\", \"repo_url\": \"...\" } (SSE)",
      alignExport: "POST /align/export { \"markdown\": \"...\", \"arxiv_id\": \"...\" }",
      memoryStats: "GET /memory/stats",
      memorySearch: "POST /memory/search { \"query\": \"...\", \"k\": 5 }",
      memoryRecent: "GET /memory/recent",
    },
  });
});

/** Agent 对话 */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "请提供 message 字符串" });
      return;
    }
    const result = await agent.run(message.trim());
    res.json({
      reply: result.finalOutput,
      steps: result.steps,
      error: result.error,
    });
  } catch (err) {
    console.error("[Gateway] /chat 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * Agent 对话 - SSE 流式接口
 *
 * 事件格式：
 *   data: {"type":"token","content":"你"}\n\n
 *   data: {"type":"node","name":"retrieve","trace":"..."}\n\n
 *   data: {"type":"done","output":"...","steps":2}\n\n
 *   data: {"type":"error","error":"..."}\n\n
 */
app.post("/chat/stream", async (req, res) => {
  try {
    const { message, context } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "请提供 message 字符串" });
      return;
    }

    // SSE 头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let aiBuffer = "";  // 累积 AI 文本（用于流式追加）
    let assistantMsgId = crypto.randomUUID();
    let firstTokenSent = false;

    // 设置流式回调
    agent.setStreamCallbacks({
      onToken: (token) => {
        if (!firstTokenSent) {
          send({ type: "start", id: assistantMsgId });
          firstTokenSent = true;
        }
        aiBuffer += token;
        send({ type: "token", content: token });
      },
      onConfirm: (req: ConfirmRequest) => {
        send({ type: "confirm", id: req.id, name: req.name, args: req.args });
      },
      onMessage: (msg) => {
        send({ type: "node", name: "system", trace: msg });
      },
    });

    send({ type: "user", content: message });

    // 构建带上下文的完整消息
    const fullMessage = context && typeof context === "string" && context.trim()
      ? `${context}\n\n【用户提问】\n${message.trim()}`
      : message.trim();

    // 流式运行
    for await (const chunk of agent.runStream(fullMessage)) {
      if (Array.isArray(chunk)) {
        const [marker, output] = chunk;
        if (marker === "__DONE__") {
          send({ type: "done", output, id: assistantMsgId });
        }
      } else if (typeof chunk === "object" && chunk !== null && 'node' in chunk) {
        const nodeName = (chunk as any).node;
        // 错误节点同时转发为 error 事件
        if (nodeName === '__error__') {
          send({ type: "error", error: (chunk as any).trace });
        }
        // 结构化节点事件
        send({ type: "node", name: nodeName, trace: (chunk as any).trace });
      } else if (typeof chunk === "string") {
        send({ type: "node", name: "unknown", trace: chunk });
      }
    }

    res.end();
  } catch (err) {
    console.error("[Gateway] /chat/stream 错误:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : String(err) })}\n\n`);
    res.end();
  }
});

/**
 * Human-in-the-loop：用户对工具调用的确认/拒绝
 *
 * 当 agent 调用工具时，/chat/stream 会发出 type:"confirm" 事件，
 * 前端弹出确认对话框，用户点击后调用此接口注入决策。
 */
app.post("/chat/confirm", (req, res) => {
  try {
    const { id, decision } = req.body ?? {};
    if (typeof id !== "string" || !id) {
      res.status(400).json({ error: "缺少 id" });
      return;
    }
    if (decision !== true && decision !== false) {
      res.status(400).json({ error: "decision 必须为 true(允许) 或 false(拒绝)" });
      return;
    }
    const ok = Agent.resolveConfirm(id, decision ? "confirmed" : "rejected");
    if (ok) {
      res.json({ ok: true, decision: decision ? "confirmed" : "rejected" });
    } else {
      res.status(404).json({ error: "确认请求不存在或已过期" });
    }
  } catch (err) {
    console.error("[Gateway] /chat/confirm 错误:", err);
    res.status(500).json({ error: String(err) });
  }
});

/** 搜索 ArXiv */
app.get("/papers/search", async (req, res) => {
  try {
    const { q, max } = req.query ?? {};
    if (!q || typeof q !== "string") {
      res.status(400).json({ error: "缺少查询参数 q" });
      return;
    }

    const results = await arxivService.search(q, typeof max === "number" ? max : 10);
    res.json({
      query: results.query,
      totalResults: results.totalResults,
      papers: results.papers.map(p => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        abstract: p.abstract.slice(0, 500) + (p.abstract.length > 500 ? "..." : ""),
        published: p.published,
        categories: p.categories,
        pdfUrl: p.pdfUrl,
      })),
    });
  } catch (err) {
    console.error("[Gateway] /papers/search 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** 深度研究 - 流式返回（每轮结果） */
app.post("/papers/deep-research", async (req, res) => {
  try {
    const { topic, rounds, per_round } = req.body ?? {};
    if (!topic || typeof topic !== "string") {
      res.status(400).json({ error: "缺少 topic 参数" });
      return;
    }

    const researchRounds = typeof rounds === "number" ? Math.min(Math.max(rounds, 1), 5) : 3;
    const perRound = typeof per_round === "number" ? Math.min(Math.max(per_round, 3), 20) : 8;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let eventCount = 0;
    const sendEvent = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      eventCount++;
    };

    sendEvent({ type: "start", topic, rounds: researchRounds });

    const report = await deepResearchService.research(
      topic,
      researchRounds,
      perRound,
      (step) => {
        sendEvent({ type: "step", step });
      }
    );

    sendEvent({ type: "done", report });
    res.end();
  } catch (err) {
    console.error("[Gateway] /papers/deep-research 错误:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : String(err) })}\n\n`);
    res.end();
  }
});

/** 导出深度研究报告为 Markdown 文件 */
app.post("/papers/export-report", async (req, res) => {
  try {
    const { report } = req.body ?? {};
    if (!report || !report.topic || !Array.isArray(report.allPapers)) {
      res.status(400).json({ error: "缺少 report 参数" });
      return;
    }

    const md = generateResearchReport(report);
    const filename = `research-${report.topic.replace(/[^\w一-龥]/g, '_')}-${Date.now()}.md`;
    const exportsDir = join(process.cwd(), 'exports');

    if (!existsSync(exportsDir)) {
      mkdirSync(exportsDir, { recursive: true });
    }

    const filepath = join(exportsDir, filename);
    writeFileSync(filepath, md, 'utf-8');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
  } catch (err) {
    console.error("[Gateway] /papers/export-report 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** 导出搜索结果为 Markdown */
app.post("/papers/export-search", async (req, res) => {
  try {
    const { query, papers } = req.body ?? {};
    if (!query || !Array.isArray(papers)) {
      res.status(400).json({ error: "缺少 query 或 papers 参数" });
      return;
    }

    const md = generateSearchResultDoc(query, papers);
    const filename = `search-${query.replace(/[^\w一-龥]/g, '_')}-${Date.now()}.md`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
  } catch (err) {
    console.error("[Gateway] /papers/export-search 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** 导出对话中的论文分析为 Markdown */
app.post("/papers/export-analysis", async (req, res) => {
  try {
    const { items, topic } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "缺少 items 参数" });
      return;
    }

    const md = generateAnalysisDoc(items, topic || '论文分析');
    const filename = `analysis-${Date.now()}.md`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
  } catch (err) {
    console.error("[Gateway] /papers/export-analysis 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * 论文-代码对齐 - SSE 流式接口
 *
 * 事件格式：
 *   data: {"type":"start", "arxivId": "..."}
 *   data: {"type":"progress", "stage": "paper|repo|functions|align", "info": "..."}
 *   data: {"type":"done", "report": {...完整的 AlignmentReport}}
 *   data: {"type":"error", "error": "..."}
 */
app.post("/align/run", async (req, res) => {
  try {
    const { arxiv_id, repo_url } = req.body ?? {};
    if (!arxiv_id || typeof arxiv_id !== "string") {
      res.status(400).json({ error: "缺少 arxiv_id" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ type: "start", arxivId: arxiv_id });

    // 复用 chat agent 的同一个 LLM provider，保证模型/温度/endpoint 完全一致
    const sharedProvider = agent.getLLMProvider();
    const alignAgent = new PaperAlignAgent({
      llm: new LLMProviderAdapter(sharedProvider),
      githubToken: process.env.GITHUB_TOKEN, // 传递 GitHub Token 避免 429 限制
      proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY, // 传递代理配置
      onProgress: (stage, info) => {
        send({ type: "progress", stage, info });
      },
    });

    const report = await alignAgent.align(arxiv_id, repo_url);

    // 自动注入对齐结果到 agent 的长期记忆
    const memory = agent.getMemory();
    if (memory && report.rows.length > 0) {
      try {
        await memory.longTerm.addSummary(
          report.paper.title,
          `Aligned ${report.rows.length} claims: ${report.summary.matched} match, ${report.summary.partial} partial, ${report.summary.mismatch} mismatch, ${report.summary.missing} missing`,
          [report.paper.title],
        );
        for (const row of report.rows) {
          if (row.matchedFunction) {
            await memory.longTerm.addAlignmentResult(
              row.claim.description,
              row.claim.location,
              row.matchedFunction.name,
              row.matchedFunction.file,
              row.status,
              [report.paper.title],
            );
          } else {
            await memory.longTerm.addAlignmentResult(
              row.claim.description,
              row.claim.location,
              '',
              '',
              row.status,
              [report.paper.title],
            );
          }
        }
        await memory.save();
      } catch (e) {
        console.error('[Memory injection error]', e);
      }
    }

    send({ type: "done", report });
    res.end();
  } catch (err) {
    console.error("[Gateway] /align/run 错误:", err);
    res.write(`data: ${JSON.stringify({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    })}\n\n`);
    res.end();
  }
});

/** 下载对齐报告为 Markdown */
app.post("/align/export", async (req, res) => {
  try {
    const { markdown, arxiv_id } = req.body ?? {};
    if (typeof markdown !== "string" || !markdown) {
      res.status(400).json({ error: "缺少 markdown" });
      return;
    }
    const safeId = (arxiv_id || "report").replace(/[^\w.-]/g, "_");
    const filename = `align-${safeId}-${Date.now()}.md`;

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(markdown);
  } catch (err) {
    console.error("[Gateway] /align/export 错误:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** 交互式对齐：开始新会话（SSE） */
app.post("/align/interactive/start", async (req, res) => {
  try {
    const { topic } = req.body ?? {};
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      res.status(400).json({ error: "缺少 topic 参数" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const session = createInteractiveSession(topic.trim(), res);

    // Step 1: 询问用户是否搜索
    pushEvent(session, { type: "ia_ask_confirm", topic: session.topic });

    // 等待用户响应（通过 /align/interactive/respond）
    // 这里不 await，让 SSE 连接保持
  } catch (err) {
    console.error("[Gateway] /align/interactive/start 错误:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** 交互式对齐：用户响应 */
app.post("/align/interactive/respond", async (req, res) => {
  try {
    const { sessionId, action, value } = req.body ?? {};
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "缺少 sessionId" });
      return;
    }
    if (!action || typeof action !== "string") {
      res.status(400).json({ error: "缺少 action" });
      return;
    }

    const session = interactiveSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "会话不存在或已过期" });
      return;
    }

    switch (action) {
      case "confirm_search": {
        // 用户确认搜索 → 执行 arXiv 搜索
        session.step = 'showing_results';
        pushEvent(session, { type: "ia_node", name: "search_arxiv", trace: `正在搜索 arXiv 上的「${session.topic}」...` });
        pushEvent(session, { type: "ia_progress", message: `正在搜索 arXiv 上的「${session.topic}」...` });

        const maxResults = typeof value === "number" ? value : 10;
        const searchResult = await arxivService.search(session.topic, maxResults);
        const papers: ArxivSearchResult[] = searchResult.papers.map(p => ({
          id: p.id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, '').replace(/v\d+$/, ''),
          title: p.title,
          authors: p.authors.slice(0, 5),
          abstract: p.abstract.slice(0, 500) + (p.abstract.length > 500 ? '...' : ''),
          published: p.published,
          pdfUrl: p.pdfUrl,
        }));
        session.papers = papers;
        pushEvent(session, { type: "ia_show_papers", papers, query: session.topic });
        break;
      }

      case "select_paper": {
        // 用户选择了一篇论文
        const paperId = typeof value === "string" ? value : "";
        const paper = session.papers?.find(p => p.id === paperId);
        if (!paper) {
          pushEvent(session, { type: "ia_error", message: `未找到论文 ${paperId}` });
          res.json({ ok: false, error: "论文不存在" });
          return;
        }
        session.selectedPaper = { id: paper.id, title: paper.title };
        session.step = 'asking_repo';
        pushEvent(session, { type: "ia_node", name: "detect_repo", trace: `检测「${paper.title}」的 GitHub 仓库...` });
        pushEvent(session, { type: "ia_progress", message: `已选择论文: ${paper.title}` });

        // 自动检测 GitHub 仓库
        const sharedProvider = agent.getLLMProvider();
        const alignAgent = new PaperAlignAgent({
          llm: new LLMProviderAdapter(sharedProvider),
          githubToken: process.env.GITHUB_TOKEN,
          proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
          onProgress: (stage, info) => {
            pushEvent(session, { type: "ia_node", name: stage, trace: info || '' });
          },
        });
        const searchMeta = await arxivService.search(paperId, 1).catch(() => null);
        const paperInfo = searchMeta?.papers?.[0];
        const detectedRepo = paperInfo ? extractRepoUrl(`${paperInfo.abstract}\n${paperInfo.comment || ''}`) : undefined;

        if (detectedRepo) {
          session.repoUrl = detectedRepo;
          session.step = 'aligning';
          pushEvent(session, { type: "ia_found_repo", repoUrl: detectedRepo });
          // 自动开始对齐
          runAlignment(session, alignAgent).catch(err => {
            pushEvent(session, { type: "ia_error", message: err instanceof Error ? err.message : String(err) });
          });
        } else {
          pushEvent(session, { type: "ia_ask_repo", paperTitle: paper.title });
        }
        break;
      }

      case "input_repo": {
        // 用户手动输入了 GitHub 仓库
        const repoUrl = typeof value === "string" ? value.trim() : "";
        if (!repoUrl || !repoUrl.includes('github.com')) {
          pushEvent(session, { type: "ia_error", message: "请输入有效的 GitHub 仓库地址" });
          res.json({ ok: false, error: "无效的仓库地址" });
          return;
        }
        session.repoUrl = repoUrl;
        session.step = 'aligning';
        pushEvent(session, { type: "ia_node", name: "align_paper", trace: `开始对齐论文代码，仓库: ${repoUrl}` });
        pushEvent(session, { type: "ia_progress", message: `使用仓库: ${repoUrl}` });

        const sharedProvider = agent.getLLMProvider();
        const alignAgent = new PaperAlignAgent({
          llm: new LLMProviderAdapter(sharedProvider),
          githubToken: process.env.GITHUB_TOKEN,
          proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
          onProgress: (stage, info) => {
            pushEvent(session, { type: "ia_progress", message: `[${stage}] ${info}` });
          },
        });
        runAlignment(session, alignAgent, repoUrl).catch(err => {
          pushEvent(session, { type: "ia_error", message: err instanceof Error ? err.message : String(err) });
        });
        break;
      }

      case "cancel": {
        session.step = 'cancelled';
        pushEvent(session, { type: "ia_cancelled", reason: "user cancelled" });
        interactiveSessions.delete(sessionId);
        break;
      }

      default:
        res.status(400).json({ error: `未知动作: ${action}` });
        return;
    }

    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("[Gateway] /align/interactive/respond 错误:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

async function runAlignment(session: InteractiveSession, alignAgent: PaperAlignAgent, explicitRepoUrl?: string) {
  if (!session.selectedPaper) {
    pushEvent(session, { type: "ia_error", message: "未选择论文" });
    return;
  }
  const id = session.selectedPaper.id;
  pushEvent(session, { type: "ia_node", name: "align_paper", trace: `解析论文 ${id} ...` });
  pushEvent(session, { type: "ia_progress", message: "开始论文-代码对齐..." });

  const report = await alignAgent.align(id, explicitRepoUrl || session.repoUrl);

  session.report = report;
  session.step = 'done';

  // 注入记忆
  const memory = agent.getMemory();
  if (memory && report.rows.length > 0) {
    try {
      await memory.longTerm.addSummary(
        report.paper.title,
        `Aligned ${report.rows.length} claims: ${report.summary.matched} match, ${report.summary.partial} partial, ${report.summary.mismatch} mismatch, ${report.summary.missing} missing`,
        [report.paper.title],
      );
      await memory.save();
    } catch (e) {
      console.error('[Memory injection error]', e);
    }
  }

  pushEvent(session, { type: "ia_done", report });
  // 也设置最近一次对齐报告
  lastAlignReport = report;

  // 清理会话
  setTimeout(() => interactiveSessions.delete(session.id), 60_000);
}

/**
 * 返回最近一次对齐报告（供前端对齐模块 UI 渲染）
 * 由 chat agent 的 align_paper 工具写入
 */
app.get("/align/last-result", (_req, res) => {
  if (lastAlignReport) {
    res.json({ report: lastAlignReport });
  } else {
    res.json({ report: null });
  }
});

/** 记忆系统 - 知识库统计 */
app.get("/memory/stats", async (_req, res) => {
  try {
    const memory = agent.getMemory();
    if (!memory) {
      res.json({ total: 0, bySource: {}, byType: {} });
      return;
    }
    await memory.initialize();
    const all = memory.longTerm.getAll();
    const bySource: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const item of all) {
      const s = item.metadata.source || 'unknown';
      const t = item.metadata.type || 'unknown';
      bySource[s] = (bySource[s] || 0) + 1;
      byType[t] = (byType[t] || 0) + 1;
    }
    res.json({ total: all.length, bySource, byType });
  } catch (err) {
    console.error("[Gateway] /memory/stats 错误:", err);
    res.status(500).json({ error: String(err) });
  }
});

/** 记忆系统 - 检索 */
app.post("/memory/search", async (req, res) => {
  try {
    const { query, k } = req.body ?? {};
    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "缺少 query" });
      return;
    }
    const memory = agent.getMemory();
    if (!memory) {
      res.json({ results: [] });
      return;
    }
    await memory.initialize();
    const results = await memory.longTerm.search(query, k ?? 5);
    res.json({ results: results.map(r => ({ content: r.content.slice(0, 300), metadata: r.metadata, score: r.score })) });
  } catch (err) {
    console.error("[Gateway] /memory/search 错误:", err);
    res.status(500).json({ error: String(err) });
  }
});

/** 记忆系统 - 最近条目 */
app.get("/memory/recent", async (_req, res) => {
  try {
    const memory = agent.getMemory();
    if (!memory) {
      res.json({ items: [] });
      return;
    }
    await memory.initialize();
    const all = memory.longTerm.getAll();
    const sorted = all.sort((a, b) => (b.metadata.timestamp as number || 0) - (a.metadata.timestamp as number || 0));
    const items = sorted.slice(0, 50).map(item => ({
      id: item.id,
      content: item.content.slice(0, 200),
      source: item.metadata.source,
      type: item.metadata.type,
      title: item.metadata.title,
      timestamp: item.metadata.timestamp,
    }));
    res.json({ items });
  } catch (err) {
    console.error("[Gateway] /memory/recent 错误:", err);
    res.status(500).json({ error: String(err) });
  }
});

/** WebSocket 简单回显 */
function startServer(PORT: number): Promise<void> {
  return new Promise((resolve) => {
    const httpServer = createServer(app);
    const wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (ws) => {
      console.log("[Gateway] WebSocket 客户端已连接");
      ws.on("message", (data) => {
        ws.send(`[Echo] ${data.toString()}`);
      });
    });

    httpServer.listen(PORT, () => {
      console.log(`[Gateway] 已启动 http://localhost:${PORT}`);
      console.log(`[Gateway] 健康检查 GET /health`);
      console.log(`[Gateway] WebSocket 连接 ws://localhost:${PORT}`);
      resolve();
    });
  });
}

export { startServer };

