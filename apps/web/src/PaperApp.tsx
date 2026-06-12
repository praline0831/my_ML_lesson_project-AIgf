import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const API_BASE = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4000";

interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdfUrl: string;
}

interface ResearchStep {
  round: number;
  query: string;
  papers: ArxivPaper[];
  summary: string;
}

interface ResearchReport {
  topic: string;
  steps: ResearchStep[];
  allPapers: ArxivPaper[];
  synthesis: string;
  generatedAt: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  papers?: ArxivPaper[];
  report?: ResearchReport;
  analysisContext?: {
    paper: ArxivPaper;
    question: string;
  };
}

export function PaperApp() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [researchTopic, setResearchTopic] = useState("");
  const [searchResults, setSearchResults] = useState<ArxivPaper[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "search" | "research">("research");
  const [researchProgress, setResearchProgress] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const downloadMarkdown = async (endpoint: string, payload: any, defaultName: string) => {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const contentDisposition = res.headers.get("Content-Disposition");
      const match = contentDisposition?.match(/filename="?([^";]+)"?/);
      a.download = match?.[1] ?? defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`下载失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExportReport = (report: ResearchReport) => {
    const filename = `research-${report.topic.slice(0, 20)}.md`;
    downloadMarkdown("/papers/export-report", { report }, filename);
  };

  const handleExportSearch = () => {
    if (searchResults.length === 0) return;
    const filename = `search-${searchQuery.slice(0, 20)}.md`;
    downloadMarkdown(
      "/papers/export-search",
      { query: searchQuery, papers: searchResults },
      filename
    );
  };

  const handleExportAnalysis = () => {
    const analysisItems = messages
      .filter((m) => m.role === "assistant" && m.analysisContext)
      .map((m) => ({
        paper: m.analysisContext!.paper,
        question: m.analysisContext!.question,
        analysis: m.content,
        analyzedAt: Date.now(),
      }));

    if (analysisItems.length === 0) {
      alert("对话中还没有论文分析内容");
      return;
    }
    downloadMarkdown(
      "/papers/export-analysis",
      { items: analysisItems, topic: "论文分析合集" },
      "analysis.md"
    );
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setLoading(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `${API_BASE}/papers/search?q=${encodeURIComponent(q)}&max=15`
      );
      const data = await res.json();
      setSearchResults(data.papers || []);
    } catch (e) {
      console.error("Search failed:", e);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `❌ 搜索失败: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepResearch = async () => {
    const topic = researchTopic.trim();
    if (!topic) return;
    setLoading(true);
    setResearchProgress([
      `🚀 开始深度研究：${topic}`,
      `⏳ 正在连接服务器...`,
    ]);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: `🔬 深度研究：${topic}` };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const fetchPromise = fetch(`${API_BASE}/papers/deep-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, rounds: 3, per_round: 8 }),
      });

      setResearchProgress((prev) => [...prev, `🔌 等待服务器响应...`]);

      const res = await fetchPromise;

      if (!res.body) throw new Error("无响应流");

      setResearchProgress((prev) => [...prev, `✅ 已连接，正在检索...`]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalReport: ResearchReport | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "start") {
              setResearchProgress((prev) => [
                ...prev,
                `📡 服务器开始处理 (共 ${payload.rounds} 轮)`,
              ]);
            } else if (payload.type === "step") {
              const p = payload.step;
              setResearchProgress((prev) => [...prev, p.summary]);
            } else if (payload.type === "done") {
              finalReport = payload.report;
            } else if (payload.type === "error") {
              throw new Error(payload.error);
            }
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }

      if (finalReport) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `✅ 深度研究完成！共检索到 ${finalReport.allPapers.length} 篇论文`,
            report: finalReport,
          },
        ]);
        setResearchProgress((prev) => [...prev, `✅ 完成！共 ${finalReport!.allPapers.length} 篇论文`]);
      }
    } catch (e) {
      console.error("Deep research failed:", e);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `❌ 深度研究失败: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // 占位消息（流式会不断更新）
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    setLoading(true);
    setTimeout(scrollToBottom, 100);

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.body) throw new Error("无响应流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          if (!evt.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(evt.slice(6));
            if (payload.type === "token") {
              // 逐 token 追加内容
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + payload.content }
                    : m
                )
              );
              setTimeout(scrollToBottom, 0);
            } else if (payload.type === "node") {
              // 节点 trace - 在消息内容里加个标记
              console.log("[Node]", payload.trace);
            } else if (payload.type === "done") {
              console.log("[Stream done]", payload.output?.slice(0, 80));
            } else if (payload.type === "error") {
              throw new Error(payload.error);
            }
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `网络错误: ${e instanceof Error ? e.message : String(e)}` }
            : m
        )
      );
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const analysisCount = messages.filter(
    (m) => m.role === "assistant" && m.analysisContext
  ).length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <style>{`@keyframes blink { 0%, 50% { opacity: 0.5; } 51%, 100% { opacity: 0; } }`}</style>
      <header style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, color: "#1a73e8" }}>📚 论文研究助手</h1>
          <p style={{ color: "#666", margin: "4px 0 0" }}>联网检索 ArXiv · 深度研究 · 智能对话 · 文档导出</p>
        </div>
        {analysisCount > 0 && (
          <button
            onClick={handleExportAnalysis}
            style={{
              padding: "8px 16px",
              background: "#34a853",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            📥 导出对话分析 ({analysisCount} 段)
          </button>
        )}
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #eee" }}>
        <TabButton active={activeTab === "research"} onClick={() => setActiveTab("research")}>
          🔬 深度研究
        </TabButton>
        <TabButton active={activeTab === "search"} onClick={() => setActiveTab("search")}>
          🔍 论文搜索
        </TabButton>
        <TabButton active={activeTab === "chat"} onClick={() => setActiveTab("chat")}>
          💬 智能对话
        </TabButton>
      </div>

      {activeTab === "research" && (
        <div>
          <div style={{ background: "#f8f9fa", padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 12px" }}>🎯 输入研究方向</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleDeepResearch()}
                placeholder="例如：基于大语言模型的代码生成、大模型对齐与RLHF..."
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  fontSize: 14,
                  border: "1px solid #ddd",
                  borderRadius: 6,
                }}
                disabled={loading}
              />
              <button
                onClick={handleDeepResearch}
                disabled={loading || !researchTopic.trim()}
                style={{
                  padding: "10px 20px",
                  background: loading ? "#ccc" : "#1a73e8",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {loading ? "检索中..." : "🚀 开始研究"}
              </button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#888" }}>
              提示：系统会自动进行 3 轮 ArXiv 检索，完成后可导出 Markdown 报告
            </p>
          </div>

          {researchProgress.length > 0 && (
            <div style={{ background: "#fff3cd", padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
              <strong>📊 实时进度：</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {researchProgress.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {messages.filter((m) => m.report).slice(-1).map((m) => (
            <div key={m.id}>
              {m.report && <ResearchReportView report={m.report} onExport={() => handleExportReport(m.report!)} />}
            </div>
          ))}
        </div>
      )}

      {activeTab === "search" && (
        <div>
          <div style={{ background: "#f8f9fa", padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 12px" }}>🔍 关键词搜索</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleSearch()}
                placeholder="例如：LoRA, transformer, reinforcement learning..."
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  fontSize: 14,
                  border: "1px solid #ddd",
                  borderRadius: 6,
                }}
                disabled={loading}
              />
              <button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                style={{
                  padding: "10px 20px",
                  background: loading ? "#ccc" : "#1a73e8",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "搜索中..." : "搜索"}
              </button>
            </div>
          </div>

          {searchResults.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 12px" }}>
                <h3 style={{ margin: 0 }}>📑 搜索结果 ({searchResults.length})</h3>
                <button
                  onClick={handleExportSearch}
                  style={{
                    padding: "6px 14px",
                    background: "#34a853",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  📥 导出 Markdown
                </button>
              </div>
              {searchResults.map((p, i) => (
                <PaperCard key={i} paper={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "chat" && (
        <div>
          <div
            style={{
              background: "#f8f9fa",
              borderRadius: 8,
              padding: 16,
              minHeight: 400,
              maxHeight: 500,
              overflowY: "auto",
              marginBottom: 12,
            }}
          >
            {messages.length === 0 && (
              <p style={{ color: "#999", textAlign: "center", margin: "40px 0" }}>
                与论文助手对话，例如："帮我搜索 LoRA 相关论文"
              </p>
            )}
            {messages.map((m, idx) => {
              // 最后一条 assistant 消息 + loading 中 = 流式状态
              const isLastAssistant = m.role === "assistant" && idx === messages.length - 1;
              const isStreaming = isLastAssistant && loading;
              return <MessageBubble key={m.id} message={m} isStreaming={isStreaming} />;
            })}
            {loading && <div style={{ color: "#999", fontStyle: "italic" }}>🤔 思考中...</div>}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="输入消息..."
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 14,
                border: "1px solid #ddd",
                borderRadius: 6,
              }}
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                padding: "10px 20px",
                background: loading ? "#ccc" : "#1a73e8",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 20px",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #1a73e8" : "2px solid transparent",
        color: active ? "#1a73e8" : "#666",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function PaperCard({ paper }: { paper: ArxivPaper }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <h4 style={{ margin: "0 0 8px", color: "#1a73e8" }}>{paper.title}</h4>
      <p style={{ margin: "4px 0", fontSize: 13, color: "#666" }}>
        👤 {paper.authors.slice(0, 3).join(", ")}
        {paper.authors.length > 3 ? " et al." : ""} · 📅 {paper.published?.slice(0, 10)}
      </p>
      <p style={{ margin: "8px 0", fontSize: 13, color: "#444", lineHeight: 1.5 }}>
        {paper.abstract?.slice(0, 300)}
        {paper.abstract && paper.abstract.length > 300 ? "..." : ""}
      </p>
      <p style={{ margin: "8px 0 0", fontSize: 12 }}>
        <a href={paper.id} target="_blank" rel="noreferrer" style={{ color: "#1a73e8", marginRight: 12 }}>
          🔗 查看
        </a>
        <a href={paper.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#1a73e8" }}>
          📄 PDF
        </a>
      </p>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const isUser = message.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser ? "#1a73e8" : "#fff",
          color: isUser ? "white" : "#333",
          border: isUser ? "none" : "1px solid #e0e0e0",
          fontSize: 14,
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}
      >
        {/* 流式中：纯文本（避免 markdown 解析闪烁）；流结束：渲染 markdown */}
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
        ) : isStreaming ? (
          <div style={{ whiteSpace: "pre-wrap" }}>
            {message.content}
            <span style={{ animation: "blink 1s infinite", opacity: 0.5 }}>▊</span>
          </div>
        ) : message.content ? (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeHighlight, rehypeKatex]}
              components={{
                a: ({ node, ...props }: any) => (
                  <a {...props} target="_blank" rel="noreferrer" style={{ color: "#1a73e8" }} />
                ),
                table: ({ node, ...props }: any) => (
                  <table {...props} style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }} />
                ),
                th: ({ node, ...props }: any) => (
                  <th {...props} style={{ border: "1px solid #e0e0e0", padding: "6px 10px", background: "#f8f9fa", textAlign: "left" }} />
                ),
                td: ({ node, ...props }: any) => (
                  <td {...props} style={{ border: "1px solid #e0e0e0", padding: "6px 10px" }} />
                ),
                code: ({ node, inline, className, children, ...props }: any) =>
                  inline ? (
                    <code {...props} style={{ background: "#f1f3f4", padding: "2px 5px", borderRadius: 3, fontSize: 13, fontFamily: "Consolas, Monaco, monospace" }}>
                      {children}
                    </code>
                  ) : (
                    <code {...props} className={className} style={{ display: "block", background: "#f6f8fa", padding: 10, borderRadius: 6, overflowX: "auto", fontSize: 13 }}>
                      {children}
                    </code>
                  ),
                pre: ({ node, ...props }: any) => (
                  <pre {...props} style={{ background: "#f6f8fa", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 13, margin: "8px 0" }} />
                ),
                ul: ({ node, ...props }: any) => <ul {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
                ol: ({ node, ...props }: any) => <ol {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
                h1: ({ node, ...props }: any) => <h1 {...props} style={{ fontSize: 22, marginTop: 12, marginBottom: 8, fontWeight: 600 }} />,
                h2: ({ node, ...props }: any) => <h2 {...props} style={{ fontSize: 18, marginTop: 12, marginBottom: 6, fontWeight: 600 }} />,
                h3: ({ node, ...props }: any) => <h3 {...props} style={{ fontSize: 16, marginTop: 10, marginBottom: 4, fontWeight: 600 }} />,
                blockquote: ({ node, ...props }: any) => (
                  <blockquote {...props} style={{ borderLeft: "3px solid #d0d7de", paddingLeft: 12, margin: "6px 0", color: "#57606a" }} />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : null}
        {message.report && (
          <ResearchReportView
            report={message.report}
            onExport={() => {
              const blob = new Blob([JSON.stringify(message.report, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `report-${message.report!.topic}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
        )}
        {message.papers && message.papers.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {message.papers.map((p, i) => (
              <PaperCard key={i} paper={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResearchReportView({ report, onExport }: { report: ResearchReport; onExport: () => void }) {
  return (
    <div style={{ marginTop: 12, background: "#f8f9fa", padding: 12, borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>🔬 深度研究报告</strong>
        <button
          onClick={onExport}
          style={{
            padding: "6px 14px",
            background: "#34a853",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          📥 导出 Markdown
        </button>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: 0, color: "#333" }}>
        {report.synthesis}
      </pre>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          📚 查看 {report.allPapers.length} 篇论文清单
        </summary>
        <div style={{ marginTop: 8 }}>
          {report.allPapers.slice(0, 20).map((p, i) => (
            <PaperCard key={i} paper={p} />
          ))}
        </div>
      </details>
    </div>
  );
}
