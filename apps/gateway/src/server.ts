import { arxivService, deepResearchService, generateAnalysisDoc, generateResearchReport, generateSearchResultDoc } from "@agent/paper";
import { LLMProviderAdapter, PaperAlignAgent } from "@agent/paper-align";
import { createAgent, paperTools } from "@agent/runtime";
import cors from "cors";
import express from "express";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

const agent = createAgent({ verbose: false });

for (const tool of paperTools) {
  agent.registerTool(tool.name, tool.execute);
}

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
    const { message } = req.body ?? {};
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
    });

    send({ type: "user", content: message });

    // 流式运行
    for await (const chunk of agent.runStream(message.trim())) {
      if (Array.isArray(chunk)) {
        const [marker, output] = chunk;
        if (marker === "__DONE__") {
          send({ type: "done", output, id: assistantMsgId });
        }
      } else if (typeof chunk === "string") {
        // 节点 trace
        send({ type: "node", trace: chunk });
      }
    }

    res.end();
  } catch (err) {
    console.error("[Gateway] /chat/stream 错误:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : String(err) })}\n\n`);
    res.end();
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
      onProgress: (stage, info) => {
        send({ type: "progress", stage, info });
      },
    });

    const report = await alignAgent.align(arxiv_id, repo_url);

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

