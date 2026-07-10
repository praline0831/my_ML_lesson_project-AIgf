import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeViewer } from "./components/CodeViewer";

const API_BASE = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4000";

// ───────────── 类型定义 ─────────────

interface ArxivPaper {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    published: string;
    categories: string[];
    pdfUrl: string;
}

type AlignStatus = "match" | "partial" | "mismatch" | "missing";
type ClaimType = "formula" | "loss" | "algorithm" | "hyperparam" | "training" | "data" | "arch";

interface PaperClaim {
    description: string;
    location: string;
    quote?: string;
    type?: ClaimType;
    importance?: 1 | 2 | 3;
}

interface CodeFunction {
    file: string;
    name: string;
    startLine: number;
    endLine: number;
    signature: string;
    body: string;
    isKey?: boolean;
}

interface AlignmentRow {
    claim: PaperClaim;
    matchedFunction?: CodeFunction;
    status: AlignStatus;
    note: string;
    confidence: number;
    reasoning?: string;
    evidence?: string;
    evidenceLine?: number;
}

interface AlignmentReport {
    paper: { arxivId: string; title: string; repoUrl?: string };
    repo?: { owner: string; repo: string; url: string };
    generatedAt: string;
    rows: AlignmentRow[];
    summary: { total: number; matched: number; partial: number; mismatch: number; missing: number };
    markdown: string;
}

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
}

interface ProgressEvent {
    stage: "paper" | "repo" | "functions" | "align";
    info: string;
}

// ───────────── 常量 ─────────────

const STATUS_META: Record<AlignStatus, { icon: string; label: string; color: string; bg: string }> = {
    match: { icon: "✅", label: "匹配", color: "#0d652d", bg: "#e6f4ea" },
    partial: { icon: "🟡", label: "部分", color: "#9a6700", bg: "#fef7e0" },
    mismatch: { icon: "❌", label: "偏差", color: "#a50e0e", bg: "#fce8e6" },
    missing: { icon: "❔", label: "缺失", color: "#5f6368", bg: "#f1f3f4" },
};

const CLAIM_TYPE_META: Record<ClaimType, { icon: string; label: string; color: string }> = {
    formula: { icon: "📐", label: "公式", color: "#7b1fa2" },
    loss: { icon: "🧮", label: "损失", color: "#c62828" },
    algorithm: { icon: "⚙️", label: "算法", color: "#1565c0" },
    hyperparam: { icon: "🎛️", label: "超参", color: "#6a1b9a" },
    training: { icon: "🏋️", label: "训练", color: "#2e7d32" },
    data: { icon: "📊", label: "数据", color: "#ef6c00" },
    arch: { icon: "🏛️", label: "结构", color: "#455a64" },
};

// ───────────── 主组件 ─────────────

export function UnifiedResearchApp() {
    // 模块1: 论文搜索
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ArxivPaper[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // 模块2: 论文-代码对齐
    const [arxivIdInput, setArxivIdInput] = useState("");
    const [repoUrlInput, setRepoUrlInput] = useState("");
    const [alignLoading, setAlignLoading] = useState(false);
    const [alignProgress, setAlignProgress] = useState<ProgressEvent[]>([]);
    const [alignmentReport, setAlignmentReport] = useState<AlignmentReport | null>(null);
    const [selectedClaimIndex, setSelectedClaimIndex] = useState(0);
    const [alignError, setAlignError] = useState<string | null>(null);

    // 模块3: 对话
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [customContext, setCustomContext] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // ───────────── 模块1: 论文搜索 ─────────────

    const handleSearch = async () => {
        const q = searchQuery.trim();
        if (!q) return;
        setSearchLoading(true);
        setSearchResults([]);
        try {
            const res = await fetch(`${API_BASE}/papers/search?q=${encodeURIComponent(q)}&max=15`);
            const data = await res.json();
            setSearchResults(data.papers || []);
        } catch (e) {
            console.error("Search failed:", e);
        } finally {
            setSearchLoading(false);
        }
    };

    const selectPaperForAlign = (paper: ArxivPaper) => {
        const arxivId = paper.id.replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "");
        setArxivIdInput(arxivId);
    };

    // ───────────── 模块2: 论文-代码对齐 ─────────────

    const runAlignment = async () => {
        const arxivId = arxivIdInput.trim();
        if (!arxivId || alignLoading) return;

        setAlignLoading(true);
        setAlignError(null);
        setAlignmentReport(null);
        setAlignProgress([]);

        try {
            const res = await fetch(`${API_BASE}/align/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    arxiv_id: arxivId,
                    repo_url: repoUrlInput.trim() || undefined,
                }),
            });

            if (!res.body) throw new Error("无响应流");
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }

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
                        if (payload.type === "progress") {
                            setAlignProgress((prev) => [...prev, { stage: payload.stage, info: payload.info }]);
                        } else if (payload.type === "done") {
                            setAlignmentReport(payload.report);
                            setSelectedClaimIndex(0);
                        } else if (payload.type === "error") {
                            throw new Error(payload.error);
                        }
                    } catch (e) {
                        if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                            throw e;
                        }
                    }
                }
            }
        } catch (e) {
            setAlignError(e instanceof Error ? e.message : String(e));
        } finally {
            setAlignLoading(false);
        }
    };

    const loadAlignmentToChat = () => {
        if (alignmentReport) {
            const context = buildContextMessage();
            setCustomContext(context);
            setMessages([
                {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: "✅ 已加载对齐结果到对话上下文！现在你可以基于论文声明和代码实现进行提问。",
                },
            ]);
        }
    };

    // ───────────── 模块3: 对话 ─────────────

    const sendMessage = async () => {
        const text = chatInput.trim();
        if (!text || chatLoading) return;
        setChatInput("");

        const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
        setMessages((prev) => [...prev, userMsg]);

        const assistantId = crypto.randomUUID();
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
        setChatLoading(true);
        setTimeout(scrollToBottom, 100);

        try {
            const contextMsg = customContext.trim() || (alignmentReport ? buildContextMessage() : "");

            const res = await fetch(`${API_BASE}/chat/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    context: contextMsg || undefined,
                }),
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
                            setMessages((prev) =>
                                prev.map((m) => m.id === assistantId ? { ...m, content: m.content + payload.content } : m)
                            );
                            setTimeout(scrollToBottom, 0);
                        } else if (payload.type === "done") {
                            console.log("[Stream done]");
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
            setChatLoading(false);
            setTimeout(scrollToBottom, 100);
        }
    };

    const buildContextMessage = () => {
        if (!alignmentReport) return "";

        const contextParts = [
            `【论文信息】\n标题: ${alignmentReport.paper.title}\narXiv: ${alignmentReport.paper.arxivId}`,
            `【论文核心声明及代码对齐】`,
        ];

        alignmentReport.rows.slice(0, 5).forEach((row, i) => {
            contextParts.push(`\n**声明 ${i + 1}**: ${row.claim.description}`);
            contextParts.push(`位置: ${row.claim.location}`);
            if (row.matchedFunction) {
                contextParts.push(`对应代码: ${row.matchedFunction.file} - ${row.matchedFunction.name}`);
                contextParts.push(`代码片段:\n` + "```" + `\n${row.matchedFunction.body.slice(0, 300)}\n` + "```");
            }
            contextParts.push(`状态: ${STATUS_META[row.status].label} (${row.note})`);
        });

        return contextParts.join("\n");
    };

    // ───────────── UI ─────────────

    return (
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
            <style>{`@keyframes blink { 0%, 50% { opacity: 0.5; } 51%, 100% { opacity: 0; } }`}</style>

            {/* 标题 */}
            <header style={{ marginBottom: 30 }}>
                <h1 style={{ margin: 0, color: "#1a73e8" }}>🔬 论文研究助手</h1>
                <p style={{ color: "#666", margin: "4px 0 0" }}>论文搜索 · 代码对齐 · 深度对话</p>
            </header>

            {/* 模块1: 论文搜索 */}
            <section style={{ marginBottom: 40 }}>
                <h2 style={{ color: "#1a73e8", borderBottom: "2px solid #1a73e8", paddingBottom: 8, marginBottom: 16 }}>
                    📄 论文搜索
                </h2>

                <div style={{ background: "#f8f9fa", padding: 16, borderRadius: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !searchLoading && handleSearch()}
                            placeholder="例如：LoRA, transformer, reinforcement learning..."
                            style={{
                                flex: 1,
                                padding: "10px 12px",
                                fontSize: 14,
                                border: "1px solid #ddd",
                                borderRadius: 6,
                            }}
                            disabled={searchLoading}
                        />
                        <button
                            onClick={handleSearch}
                            disabled={searchLoading || !searchQuery.trim()}
                            style={{
                                padding: "10px 20px",
                                background: searchLoading ? "#ccc" : "#1a73e8",
                                color: "white",
                                border: "none",
                                borderRadius: 6,
                                cursor: searchLoading ? "not-allowed" : "pointer",
                            }}
                        >
                            {searchLoading ? "搜索中..." : "🔍 搜索"}
                        </button>
                    </div>
                </div>

                {searchResults.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                        <h3 style={{ margin: "0 0 12px" }}>📑 搜索结果 ({searchResults.length})</h3>
                        {searchResults.map((paper, i) => (
                            <div key={i} style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 12 }}>
                                <h4 style={{ margin: "0 0 8px", color: "#1a73e8" }}>{paper.title}</h4>
                                <p style={{ margin: "4px 0", fontSize: 13, color: "#666" }}>
                                    👤 {paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " et al." : ""} · 📅 {paper.published?.slice(0, 10)}
                                </p>
                                <p style={{ margin: "8px 0", fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                                    {paper.abstract?.slice(0, 200)}{paper.abstract && paper.abstract.length > 200 ? "..." : ""}
                                </p>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                                    <div style={{ fontSize: 12 }}>
                                        <a href={paper.id} target="_blank" rel="noreferrer" style={{ color: "#1a73e8", marginRight: 12 }}>🔗 查看</a>
                                        <a href={paper.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#1a73e8" }}>📄 PDF</a>
                                    </div>
                                    <button
                                        onClick={() => selectPaperForAlign(paper)}
                                        style={{
                                            padding: "6px 16px",
                                            background: "#34a853",
                                            color: "white",
                                            border: "none",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                            fontSize: 13,
                                            fontWeight: 500,
                                        }}
                                    >
                                        🧩 用于对齐 →
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* 模块2: 论文-代码对齐 */}
            <section style={{ marginBottom: 40 }}>
                <h2 style={{ color: "#1a73e8", borderBottom: "2px solid #1a73e8", paddingBottom: 8, marginBottom: 16 }}>
                    🧩 论文-代码对齐
                </h2>

                <div style={{ background: "#f8f9fa", padding: 16, borderRadius: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "#666" }}>📄 arXiv ID:</span>
                        <input
                            value={arxivIdInput}
                            onChange={(e) => setArxivIdInput(e.target.value)}
                            placeholder="例如: 2106.09685"
                            style={{
                                padding: "8px 12px",
                                fontSize: 14,
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                minWidth: 150,
                            }}
                        />
                        <span style={{ fontSize: 13, color: "#666" }}>🔗 GitHub (可选):</span>
                        <input
                            value={repoUrlInput}
                            onChange={(e) => setRepoUrlInput(e.target.value)}
                            placeholder="https://github.com/owner/repo"
                            style={{
                                padding: "8px 12px",
                                fontSize: 14,
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                minWidth: 250,
                            }}
                        />
                        <button
                            onClick={runAlignment}
                            disabled={alignLoading || !arxivIdInput.trim()}
                            style={{
                                padding: "8px 20px",
                                background: alignLoading ? "#ccc" : "#1a73e8",
                                color: "white",
                                border: "none",
                                borderRadius: 6,
                                cursor: alignLoading ? "not-allowed" : "pointer",
                                fontWeight: 600,
                            }}
                        >
                            {alignLoading ? "⏳ 对齐中..." : "▶ 开始对齐"}
                        </button>
                    </div>
                </div>

                {alignError && (
                    <div style={{ marginTop: 16, background: "#fce8e6", color: "#a50e0e", padding: 12, borderRadius: 6 }}>
                        ❌ {alignError}
                    </div>
                )}

                {alignLoading && alignProgress.length > 0 && (
                    <div style={{ marginTop: 16, background: "#e8f0fe", padding: 12, borderRadius: 6 }}>
                        <strong>📊 进度:</strong>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                            {alignProgress.slice(-6).map((p, i) => (
                                <li key={i}><code style={{ background: "#fff", padding: "0 6px", borderRadius: 3 }}>{p.stage}</code> — {p.info}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {alignmentReport && (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                            <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>{alignmentReport.paper.title}</h3>
                            <p style={{ margin: "4px 0", color: "#666", fontSize: 13 }}>
                                📄 <a href={`https://arxiv.org/abs/${alignmentReport.paper.arxivId}`} target="_blank" rel="noreferrer">{alignmentReport.paper.arxivId}</a>
                                {alignmentReport.repo && <> · 🔗 <a href={alignmentReport.repo.url} target="_blank" rel="noreferrer">{alignmentReport.repo.owner}/{alignmentReport.repo.repo}</a></>}
                            </p>
                            <SummaryBadges summary={alignmentReport.summary} />
                            <button
                                onClick={loadAlignmentToChat}
                                style={{
                                    marginTop: 12,
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
                                💬 加载到对话上下文 →
                            </button>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 1fr) minmax(0, 1.4fr)", gap: 12, minHeight: 600 }}>
                            <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "auto", maxHeight: "75vh" }}>
                                {[...alignmentReport.rows].sort((a, b) => {
                                    const ai = a.claim.importance ?? 2;
                                    const bi = b.claim.importance ?? 2;
                                    if (ai !== bi) return bi - ai;
                                    const order: Record<AlignStatus, number> = { match: 0, partial: 1, mismatch: 2, missing: 3 };
                                    return order[a.status] - order[b.status];
                                }).map((row) => {
                                    const originalIndex = alignmentReport.rows.indexOf(row);
                                    return (
                                        <div
                                            key={originalIndex}
                                            onClick={() => setSelectedClaimIndex(originalIndex)}
                                            style={{
                                                padding: "12px 14px",
                                                borderBottom: "1px solid #f1f3f4",
                                                cursor: "pointer",
                                                background: originalIndex === selectedClaimIndex ? "#e8f0fe" : "transparent",
                                                borderLeft: originalIndex === selectedClaimIndex ? "3px solid #1a73e8" : "3px solid transparent",
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                                                <span style={{ background: STATUS_META[row.status].bg, color: STATUS_META[row.status].color, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                                                    {STATUS_META[row.status].icon} {STATUS_META[row.status].label}
                                                </span>
                                                {row.claim.type && (
                                                    <span style={{ color: CLAIM_TYPE_META[row.claim.type].color, fontSize: 11, fontWeight: 600, background: `${CLAIM_TYPE_META[row.claim.type].color}14`, padding: "2px 8px", borderRadius: 10 }}>
                                                        {CLAIM_TYPE_META[row.claim.type].icon} {CLAIM_TYPE_META[row.claim.type].label}
                                                    </span>
                                                )}
                                                <span style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>#{originalIndex + 1} · {row.claim.location}</span>
                                            </div>
                                            <div style={{ fontSize: 14, color: "#202124", marginBottom: 4 }}>{row.claim.description}</div>
                                            {row.matchedFunction && (
                                                <div style={{ fontSize: 12, color: "#5f6368" }}>📍 {row.matchedFunction.file} · {row.matchedFunction.name}</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
                                {alignmentReport.rows[selectedClaimIndex]?.matchedFunction ? (
                                    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 10 }}>
                                        <CodeViewer
                                            code={alignmentReport.rows[selectedClaimIndex].matchedFunction.body}
                                            filePath={alignmentReport.rows[selectedClaimIndex].matchedFunction.file}
                                            language="python"
                                            highlightRange={{
                                                start: alignmentReport.rows[selectedClaimIndex].matchedFunction.startLine,
                                                end: alignmentReport.rows[selectedClaimIndex].matchedFunction.endLine,
                                            }}
                                            focusLine={alignmentReport.rows[selectedClaimIndex].evidenceLine ?? alignmentReport.rows[selectedClaimIndex].matchedFunction.startLine}
                                            lineNumberStart={alignmentReport.rows[selectedClaimIndex].matchedFunction.startLine}
                                            contextWindow={4}
                                            maxHeight={520}
                                        />
                                        <div style={{ marginTop: 8, padding: 12, background: "#f8f9fa", borderRadius: 6 }}>
                                            <div style={{ fontSize: 13, color: "#202124" }}>{alignmentReport.rows[selectedClaimIndex].note}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 24, textAlign: "center", color: "#5f6368", minHeight: 400 }}>
                                        选择左侧的声明以查看对应代码
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* 模块3: 深度对话 */}
            <section>
                <h2 style={{ color: "#1a73e8", borderBottom: "2px solid #1a73e8", paddingBottom: 8, marginBottom: 16 }}>
                    💬 深度对话
                </h2>

                {alignmentReport && (
                    <div style={{ background: "#e8f0fe", padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                        <strong>📚 已加载上下文:</strong> {alignmentReport.paper.title} ({alignmentReport.rows.length} 个声明)
                        {!customContext && (
                            <button
                                onClick={loadAlignmentToChat}
                                style={{
                                    marginLeft: 12,
                                    padding: "4px 12px",
                                    background: "transparent",
                                    border: "1px solid #1a73e8",
                                    color: "#1a73e8",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                }}
                            >
                                加载对齐结果
                            </button>
                        )}
                    </div>
                )}

                <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 16, minHeight: 400, maxHeight: 500, overflowY: "auto", marginBottom: 12 }}>
                    {messages.length === 0 && (
                        <p style={{ color: "#999", textAlign: "center", margin: "40px 0" }}>
                            开始对话，例如："帮我解释这个论文的核心算法"
                        </p>
                    )}
                    {messages.map((m, idx) => {
                        const isLastAssistant = m.role === "assistant" && idx === messages.length - 1;
                        const isStreaming = isLastAssistant && chatLoading;
                        return (
                            <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
                                <div style={{
                                    maxWidth: "75%",
                                    padding: "10px 14px",
                                    borderRadius: 12,
                                    background: m.role === "user" ? "#1a73e8" : "#fff",
                                    color: m.role === "user" ? "white" : "#333",
                                    border: m.role === "user" ? "none" : "1px solid #e0e0e0",
                                    fontSize: 14,
                                    lineHeight: 1.5,
                                }}>
                                    {m.role === "user" ? (
                                        <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                                    ) : isStreaming ? (
                                        <div style={{ whiteSpace: "pre-wrap" }}>
                                            {m.content}
                                            <span style={{ animation: "blink 1s infinite", opacity: 0.5 }}>▊</span>
                                        </div>
                                    ) : m.content ? (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm, remarkMath]}
                                            rehypePlugins={[rehypeHighlight, rehypeKatex]}
                                            components={{
                                                a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" style={{ color: "#1a73e8" }} />,
                                                code: ({ inline, className, children, ...props }: any) =>
                                                    inline ? (
                                                        <code {...props} style={{ background: "#f1f3f4", padding: "2px 5px", borderRadius: 3, fontSize: 13 }}>{children}</code>
                                                    ) : (
                                                        <code {...props} className={className} style={{ display: "block", background: "#f6f8fa", padding: 10, borderRadius: 6, overflowX: "auto", fontSize: 13 }}>{children}</code>
                                                    ),
                                                pre: ({ ...props }) => <pre {...props} style={{ background: "#f6f8fa", padding: 12, borderRadius: 6, overflowX: "auto", fontSize: 13, margin: "8px 0" }} />,
                                            }}
                                        >
                                            {m.content}
                                        </ReactMarkdown>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                    {chatLoading && <div style={{ color: "#999", fontStyle: "italic" }}>🤔 思考中...</div>}
                    <div ref={messagesEndRef} />
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                        placeholder="基于论文和代码提问..."
                        style={{
                            flex: 1,
                            padding: "10px 12px",
                            fontSize: 14,
                            border: "1px solid #ddd",
                            borderRadius: 6,
                        }}
                        disabled={chatLoading}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={chatLoading || !chatInput.trim()}
                        style={{
                            padding: "10px 20px",
                            background: chatLoading ? "#ccc" : "#1a73e8",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: chatLoading ? "not-allowed" : "pointer",
                        }}
                    >
                        发送
                    </button>
                </div>
            </section>

            {/* 模块4: 知识库 Memory */}
            <section style={{ marginBottom: 40 }}>
                <h2 style={{ color: "#1a73e8", borderBottom: "2px solid #1a73e8", paddingBottom: 8, marginBottom: 16 }}>
                    🧠 知识库 (RAG Memory)
                </h2>

                <MemoryPanel apiBase={API_BASE} />
            </section>
        </div>
    );
}

// ───────────── Memory 面板组件 ─────────────

interface MemoryStats { total: number; bySource: Record<string, number>; byType: Record<string, number> }
interface MemoryItem { id: string; content: string; source: string; type: string; title?: string; timestamp: number }

function MemoryPanel({ apiBase }: { apiBase: string }) {
    const [stats, setStats] = useState<MemoryStats | null>(null);
    const [items, setItems] = useState<MemoryItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<{ content: string; metadata: Record<string, unknown>; score: number }[] | null>(null);
    const [loading, setLoading] = useState(false);

    const loadStats = async () => {
        try {
            const res = await fetch(`${apiBase}/memory/stats`);
            setStats(await res.json());
        } catch { /* silently fail */ }
    };

    const loadRecent = async () => {
        try {
            const res = await fetch(`${apiBase}/memory/recent`);
            const data = await res.json();
            setItems(data.items || []);
        } catch { /* silently fail */ }
    };

    const handleSearch = async () => {
        const q = searchQuery.trim();
        if (!q) return;
        setLoading(true);
        try {
            const res = await fetch(`${apiBase}/memory/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: q, k: 5 }),
            });
            const data = await res.json();
            setSearchResults(data.results || []);
        } finally {
            setLoading(false);
        }
    };

    useState(() => { loadStats(); loadRecent(); });

    const sourceColor: Record<string, string> = { paper: "#1a73e8", chat: "#34a853", alignment: "#f9ab00", summary: "#9334e6" };
    const typeIcon: Record<string, string> = { claim: "📄", qa: "💬", function: "🔧", fact: "ℹ️", summary: "📝" };

    return (
        <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: "12px 20px", flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#1a73e8" }}>{stats?.total ?? "—"}</div>
                    <div style={{ fontSize: 13, color: "#666" }}>知识条目</div>
                    {stats && <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                        {Object.entries(stats.bySource).map(([k, v]) => (
                            <span key={k} style={{ marginRight: 10 }}><span style={{ color: sourceColor[k] || "#666" }}>●</span> {k}: {v}</span>
                        ))}
                    </div>}
                </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                    placeholder="🔍 搜索知识库..."
                    style={{ flex: 1, padding: "8px 12px", fontSize: 14, border: "1px solid #ddd", borderRadius: 6 }}
                />
                <button onClick={handleSearch} disabled={loading || !searchQuery.trim()}
                    style={{ padding: "8px 20px", background: loading ? "#ccc" : "#1a73e8", color: "white", border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer" }}>
                    {loading ? "搜索中..." : "搜索"}
                </button>
                <button onClick={() => { loadStats(); loadRecent(); setSearchResults(null); }}
                    style={{ padding: "8px 14px", background: "white", color: "#666", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer" }}>
                    🔄
                </button>
            </div>

            {searchResults !== null ? (
                <div>
                    <h4 style={{ margin: "0 0 8px", color: "#333" }}>搜索结果</h4>
                    {searchResults.map((r, i) => (
                        <div key={i} style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: 10, marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                                <span style={{ color: sourceColor[r.metadata.source as string] || "#666" }}>●</span> {r.metadata.source as string} / {r.metadata.type as string}
                                <span style={{ marginLeft: 8, color: "#999" }}>得分: {(r.score * 100).toFixed(0)}%</span>
                            </div>
                            <div style={{ fontSize: 13, color: "#333" }}>{r.content.slice(0, 200)}{r.content.length > 200 ? "..." : ""}</div>
                        </div>
                    ))}
                    {searchResults.length === 0 && <p style={{ color: "#999" }}>无结果</p>}
                </div>
            ) : (
                <div>
                    <h4 style={{ margin: "0 0 8px", color: "#333" }}>最近条目</h4>
                    {items.map(item => (
                        <div key={item.id} style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: 10, marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                                {typeIcon[item.type] || "📄"}
                                <span style={{ color: sourceColor[item.source] || "#666", marginLeft: 4 }}>●</span> {item.source} / {item.type}
                                {item.title && <span style={{ marginLeft: 8, color: "#1a73e8" }}>{item.title}</span>}
                                <span style={{ marginLeft: 8, color: "#999" }}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}</span>
                            </div>
                            <div style={{ fontSize: 13, color: "#333" }}>{item.content.slice(0, 150)}{item.content.length > 150 ? "..." : ""}</div>
                        </div>
                    ))}
                    {items.length === 0 && <p style={{ color: "#999" }}>知识库为空，开始对话或对齐后会自动填充</p>}
                </div>
            )}
        </div>
    );
}

function SummaryBadges({ summary }: { summary: AlignmentReport["summary"] }) {
    const items: { key: AlignStatus; count: number }[] = [
        { key: "match", count: summary.matched },
        { key: "partial", count: summary.partial },
        { key: "mismatch", count: summary.mismatch },
        { key: "missing", count: summary.missing },
    ];
    return (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {items.map(({ key, count }) => {
                const meta = STATUS_META[key];
                return (
                    <span key={key} style={{ background: meta.bg, color: meta.color, padding: "4px 10px", borderRadius: 14, fontSize: 12, fontWeight: 600 }}>
                        {meta.icon} {meta.label}: {count}
                    </span>
                );
            })}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#5f6368", alignSelf: "center" }}>共 {summary.total} 个声明</span>
        </div>
    );
}