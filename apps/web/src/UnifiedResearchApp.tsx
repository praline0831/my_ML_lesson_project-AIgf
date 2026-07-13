import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";


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

interface ExecStep {
    id: number;
    node: string;
    trace: string;
    time: number;
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

const mdStyle = `
    .report-md h1 { font-size: 22px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; margin: 24px 0 16px; color: #202124; }
    .report-md h2 { font-size: 18px; margin: 20px 0 12px; color: #202124; }
    .report-md h3 { font-size: 15px; margin: 16px 0 8px; color: #202124; }
    .report-md code { background: #f1f3f4; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .report-md pre { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; overflow-x: auto; }
    .report-md pre code { background: none; padding: 0; }
    .report-md table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    .report-md th, .report-md td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; font-size: 13px; }
    .report-md th { background: #f8f9fa; font-weight: 600; }
    .report-md blockquote { border-left: 3px solid #1a73e8; margin: 12px 0; padding: 8px 16px; background: #f8f9fa; color: #5f6368; }
    .report-md ul, .report-md ol { padding-left: 24px; margin: 8px 0; }
    .report-md li { margin: 4px 0; }
    .report-md a { color: #1a73e8; }
`;



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
    const [alignError, setAlignError] = useState<string | null>(null);

    // 模块3: 对话
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [customContext, setCustomContext] = useState("");
    const [execSteps, setExecSteps] = useState<ExecStep[]>([]);
    const [pendingConfirm, setPendingConfirm] = useState<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 交互式对齐
    const [iaSession, setIaSession] = useState<string | null>(null);
    const [iaStep, setIaStep] = useState<string>('');
    const [iaTopic, setIaTopic] = useState('');
    const [iaPapers, setIaPapers] = useState<ArxivPaper[]>([]);
    const [iaMessages, setIaMessages] = useState<string[]>([]);
    const [iaRepoUrl, setIaRepoUrl] = useState('');
    const [iaLoading, setIaLoading] = useState(false);
    const iaEventSourceRef = useRef<EventSource | null>(null);

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
        setExecSteps([]);

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

            let stepCounter = 0;
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
                        } else if (payload.type === "node") {
                            const step: ExecStep = {
                                id: stepCounter++,
                                node: payload.name || "unknown",
                                trace: payload.trace || "",
                                time: Date.now(),
                            };
                            setExecSteps((prev) => [...prev, step]);
                        } else if (payload.type === "confirm") {
                            // 交互式对齐 → 自动确认 + 启动交互面板
                            if (payload.name === 'interactive_align') {
                                const topic = typeof payload.args?.topic === 'string' ? payload.args.topic : '';
                                fetch(`${API_BASE}/chat/confirm`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ id: payload.id, decision: true }),
                                }).catch(() => {});
                                setExecSteps((prev) => [...prev, {
                                    id: stepCounter++, node: "interactive_align",
                                    trace: `启动交互式对齐: ${topic || '未知主题'}`,
                                    time: Date.now(),
                                }]);
                                if (topic) startInteractiveAlign(topic);
                            } else {
                                setPendingConfirm({
                                    id: payload.id,
                                    name: payload.name,
                                    args: payload.args,
                                });
                            }
                        } else if (payload.type === "done") {
                            // chat 完成 → 检查是否有新的对齐报告供对齐模块展示
                            fetch(`${API_BASE}/align/last-result`)
                                .then(r => r.json())
                                .then(data => {
                                    if (data.report) {
                                        setAlignmentReport(data.report);
                                        setArxivIdInput(data.report.paper.arxivId);
                                    }
                                })
                                .catch(() => {});
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

    const handleConfirm = async (decision: boolean) => {
        if (!pendingConfirm) return;
        try {
            await fetch(`${API_BASE}/chat/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: pendingConfirm.id, decision }),
            });
        } catch (e) {
            console.error("Confirm failed:", e);
        }
        setPendingConfirm(null);
    };

    // ───────────── 交互式对齐 ─────────────

    const startInteractiveAlign = async (topic?: string) => {
        const query = (topic || chatInput.trim() || "").replace(/^(帮我对齐|帮我|对齐|align|search|搜索)/i, '').trim();
        if (!query) return;

        setIaSession(null);
        setIaStep('starting');
        setIaTopic(query);
        setIaPapers([]);
        setIaMessages(['正在启动交互式对齐...']);
        setIaLoading(true);

        try {
            const res = await fetch(`${API_BASE}/align/interactive/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: query }),
            });
            if (!res.body) throw new Error("无响应流");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let iaStepCounter = 0;

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
                        const sessionId = payload.sessionId;
                        if (sessionId) setIaSession(sessionId);

                        // ia_node → 注入到执行轨迹
                        if (payload.type === "ia_node") {
                            const step: ExecStep = {
                                id: iaStepCounter++,
                                node: payload.name || "unknown",
                                trace: payload.trace || "",
                                time: Date.now(),
                            };
                            setExecSteps((prev) => [...prev, step]);
                        }

                        switch (payload.type) {
                            case "ia_ask_confirm":
                                setIaStep('confirm_search');
                                setIaMessages([`是否搜索 arXiv 上关于「${payload.topic}」的论文？`]);
                                setIaLoading(false);
                                break;
                            case "ia_progress":
                                setIaMessages(prev => [...prev, payload.message]);
                                setIaStep('progress');
                                break;
                            case "ia_show_papers":
                                setIaStep('showing_results');
                                setIaPapers(payload.papers || []);
                                setIaMessages([`搜索到 ${(payload.papers || []).length} 篇论文，请选择要对齐的论文：`]);
                                setIaLoading(false);
                                break;
                            case "ia_found_repo":
                                setIaMessages(prev => [...prev, `自动检测到 GitHub 仓库: ${payload.repoUrl}`]);
                                break;
                            case "ia_ask_repo":
                                setIaStep('asking_repo');
                                setIaRepoUrl('');
                                setIaMessages([`未检测到 GitHub 仓库，请手动输入「${payload.paperTitle}」的仓库地址：`]);
                                setIaLoading(false);
                                break;
                            case "ia_done":
                                setIaStep('done');
                                setAlignmentReport(payload.report);
                                if (payload.report?.paper?.arxivId) {
                                    setArxivIdInput(payload.report.paper.arxivId);
                                }
                                setIaMessages(prev => [...prev, `✅ 对齐完成！共 ${payload.report?.summary?.total || 0} 个声明，匹配率 ${payload.report?.summary ? ((payload.report.summary.matched + payload.report.summary.partial) / payload.report.summary.total * 100).toFixed(0) : '?'}%`]);
                                setIaLoading(false);
                                break;
                            case "ia_error":
                                setIaMessages(prev => [...prev, `❌ ${payload.message}`]);
                                setIaLoading(false);
                                break;
                            case "ia_cancelled":
                                setIaStep('cancelled');
                                setIaMessages(prev => [...prev, '已取消']);
                                setIaLoading(false);
                                break;
                        }
                    } catch (e) {
                        console.error("Parse IA event error:", e);
                    }
                }
            }
        } catch (e) {
            setIaMessages(prev => [...prev, `❌ 错误: ${e instanceof Error ? e.message : String(e)}`]);
            setIaLoading(false);
        }
    };

    const respondInteractiveAlign = async (action: string, value?: unknown) => {
        if (!iaSession) return;
        setIaLoading(true);
        setIaMessages(prev => [...prev, action === 'confirm_search' ? '✅ 确认搜索' : action === 'cancel' ? '⏹️ 取消' : '']);
        try {
            const res = await fetch(`${API_BASE}/align/interactive/respond`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: iaSession, action, value }),
            });
            const data = await res.json();
            if (!data.ok) {
                setIaMessages(prev => [...prev, `❌ 响应失败: ${data.error || 'unknown'}`]);
            }
        } catch (e) {
            setIaMessages(prev => [...prev, `❌ 响应错误: ${e instanceof Error ? e.message : String(e)}`]);
        } finally {
            setIaLoading(false);
        }
    };

    const cancelInteractiveAlign = () => {
        respondInteractiveAlign('cancel');
        setIaStep('cancelled');
    };

    const submitRepoUrl = () => {
        const url = iaRepoUrl.trim();
        if (!url) return;
        respondInteractiveAlign('input_repo', url);
    };

    const selectPaper = (paper: ArxivPaper) => {
        const arxivId = paper.id.replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "");
        respondInteractiveAlign('select_paper', arxivId);
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
                <p style={{ color: "#666", margin: "4px 0 0" }}>论文搜索 · 深度对话 · 代码对齐</p>
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

            {/* 模块2: 深度对话 */}
            <section style={{ marginBottom: 40 }}>
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

                {/* 执行轨迹 Timeline */}
                {execSteps.length > 0 && (
                    <ExecTimeline steps={execSteps} />
                )}

                {/* Human-in-the-loop 确认对话框 */}
                {pendingConfirm && (
                    <ConfirmDialog
                        name={pendingConfirm.name}
                        args={pendingConfirm.args}
                        onAllow={() => handleConfirm(true)}
                        onReject={() => handleConfirm(false)}
                    />
                )}

                {/* 交互式对齐面板 */}
                {iaSession && iaStep !== 'done' && iaStep !== 'cancelled' && iaStep !== '' && (
                    <InteractiveAlignPanel
                        step={iaStep}
                        topic={iaTopic}
                        papers={iaPapers}
                        messages={iaMessages}
                        loading={iaLoading}
                        repoUrl={iaRepoUrl}
                        onRepoUrlChange={setIaRepoUrl}
                        onConfirmSearch={() => respondInteractiveAlign('confirm_search')}
                        onSelectPaper={selectPaper}
                        onSubmitRepo={submitRepoUrl}
                        onCancel={cancelInteractiveAlign}
                    />
                )}

                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !chatLoading) sendMessage();
                        }}
                        placeholder="输入消息，AI 会自动判断是否需要搜索论文和代码对齐..."
                        style={{
                            flex: 1,
                            padding: "10px 12px",
                            fontSize: 14,
                            border: "1px solid #ddd",
                            borderRadius: 6,
                        }}
                        disabled={chatLoading || iaLoading}
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
                    <button
                        onClick={() => startInteractiveAlign()}
                        disabled={chatLoading || iaLoading || !chatInput.trim()}
                        title="启动交互式对齐"
                        style={{
                            padding: "10px 14px",
                            background: "#34a853",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: chatLoading || iaLoading || !chatInput.trim() ? "not-allowed" : "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                        }}
                    >
                        🧩 对齐
                    </button>
                </div>
            </section>

            {/* 模块3: 论文-代码对齐 */}
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
                            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                                <button
                                    onClick={loadAlignmentToChat}
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
                                    💬 加载到对话上下文 →
                                </button>
                                <button
                                    onClick={() => {
                                        fetch(`${API_BASE}/align/export`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ markdown: alignmentReport.markdown, arxiv_id: alignmentReport.paper.arxivId }),
                                        })
                                            .then(res => res.blob())
                                            .then(blob => {
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = url;
                                                a.download = `align-${alignmentReport.paper.arxivId}-${Date.now()}.md`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            });
                                    }}
                                    style={{
                                        padding: "8px 16px",
                                        background: "white",
                                        color: "#1a73e8",
                                        border: "1px solid #1a73e8",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        fontSize: 13,
                                        fontWeight: 500,
                                    }}
                                >
                                    📥 导出报告 (.md)
                                </button>
                            </div>
                        </div>

                        {/* Markdown 报告预览 */}
                        <div className="report-md" style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: "16px 24px", maxHeight: "80vh", overflow: "auto", lineHeight: 1.7, fontSize: 14 }}>
                            <style>{mdStyle}</style>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{alignmentReport.markdown}</ReactMarkdown>
                        </div>
                    </div>
                )}
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

// ───────────── Human-in-the-loop 确认对话框 ─────────────

function ConfirmDialog({
    name,
    args,
    onAllow,
    onReject,
}: {
    name: string;
    args: Record<string, unknown>;
    onAllow: () => void;
    onReject: () => void;
}) {
    const [allowing, setAllowing] = useState(false);
    const [rejecting, setRejecting] = useState(false);

    return (
        <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
        }}>
            <div style={{
                background: "white", borderRadius: 12, padding: 24,
                maxWidth: 480, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}>
                <div style={{ fontSize: 20, marginBottom: 12 }}>🤔 Agent 请求执行工具</div>
                <div style={{ background: "#f8f9fa", borderRadius: 8, padding: 14, marginBottom: 16 }}>
                    <div style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>工具</span>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "#1a73e8", marginTop: 2 }}>{name}</div>
                    </div>
                    <div>
                        <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>参数</span>
                        <pre style={{
                            background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6,
                            padding: 10, fontSize: 13, margin: "4px 0 0", overflowX: "auto",
                            whiteSpace: "pre-wrap", wordBreak: "break-all",
                        }}>{JSON.stringify(args, null, 2)}</pre>
                    </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                        onClick={() => { setRejecting(true); onReject(); }}
                        disabled={allowing || rejecting}
                        style={{
                            padding: "10px 20px", borderRadius: 8, fontSize: 14,
                            background: rejecting ? "#e8eaed" : "white",
                            color: rejecting ? "#999" : "#a50e0e",
                            border: rejecting ? "1px solid #e8eaed" : "1px solid #a50e0e",
                            cursor: allowing || rejecting ? "not-allowed" : "pointer",
                        }}
                    >
                        {rejecting ? "已拒绝" : "❌ 拒绝"}
                    </button>
                    <button
                        onClick={() => { setAllowing(true); onAllow(); }}
                        disabled={allowing || rejecting}
                        style={{
                            padding: "10px 20px", borderRadius: 8, fontSize: 14,
                            background: allowing ? "#e8eaed" : "#1a73e8",
                            color: allowing ? "#999" : "white",
                            border: "none",
                            cursor: allowing || rejecting ? "not-allowed" : "pointer",
                        }}
                    >
                        {allowing ? "已允许" : "✅ 允许"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ───────────── 执行轨迹 Timeline ─────────────

const NODE_META: Record<string, { icon: string; label: string; color: string }> = {
    retrieve: { icon: "🔍", label: "检索", color: "#1a73e8" },
    think: { icon: "🤖", label: "推理", color: "#9334e6" },
    act: { icon: "🔧", label: "工具", color: "#e37400" },
    invoke_skill: { icon: "🎯", label: "Skill", color: "#0d652d" },
    summarize: { icon: "📝", label: "总结", color: "#5f6368" },
    // 交互式对齐节点
    interactive_align: { icon: "🧩", label: "交互对齐", color: "#34a853" },
    search_arxiv: { icon: "📄", label: "搜索 arXiv", color: "#1a73e8" },
    detect_repo: { icon: "🔗", label: "检测仓库", color: "#34a853" },
    align_paper: { icon: "🧩", label: "代码对齐", color: "#f9ab00" },
    paper: { icon: "📑", label: "解析论文", color: "#7b1fa2" },
    repo: { icon: "📂", label: "获取仓库", color: "#34a853" },
    functions: { icon: "🔧", label: "提取函数", color: "#e37400" },
    align: { icon: "🎯", label: "逐条对齐", color: "#c62828" },
};

function ExecTimeline({ steps }: { steps: ExecStep[] }) {
    const [collapsed, setCollapsed] = useState(true);
    return (
        <div style={{ margin: "8px 0", background: "#f8f9fa", borderRadius: 8, border: "1px solid #e8eaed" }}>
            <div
                onClick={() => setCollapsed(!collapsed)}
                style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5f6368", userSelect: "none" }}
            >
                <span>{collapsed ? "▶" : "▼"}</span>
                <span>⚡ Agent 执行轨迹</span>
                <span style={{ fontSize: 11, color: "#999" }}>{steps.length} 步</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {Array.from(new Set(steps.map(s => s.node))).slice(0, 5).map(n => (
                        <span key={n} style={{
                            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                            background: NODE_META[n]?.color || "#999",
                        }} />
                    ))}
                </span>
            </div>
            {!collapsed && (
                <div style={{ padding: "0 12px 12px", maxHeight: 300, overflowY: "auto" }}>
                    {steps.map((step, i) => {
                        const meta = NODE_META[step.node] || { icon: "⚙️", label: step.node, color: "#999" };
                        const isLatest = i === steps.length - 1;
                        return (
                            <div key={step.id} style={{ display: "flex", gap: 10, padding: "4px 0", alignItems: "flex-start" }}>
                                {/* 连接线 */}
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 20 }}>
                                    <div style={{
                                        width: 20, height: 20, borderRadius: "50%",
                                        background: isLatest ? meta.color : "#e8eaed",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 11, color: isLatest ? "#fff" : "#999",
                                    }}>{meta.icon}</div>
                                    {i < steps.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 8, background: "#e8eaed" }} />}
                                </div>
                                {/* 内容 */}
                                <div style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 8 : 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: "#333", marginBottom: 2 }}>
                                        {meta.label}
                                        <span style={{ fontWeight: 400, color: "#999", marginLeft: 8, fontSize: 11 }}>{step.node}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: "#5f6368", lineHeight: 1.4 }}>{step.trace}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/** 交互式对齐面板 */
function InteractiveAlignPanel({
    step, topic, papers, messages, loading, repoUrl,
    onRepoUrlChange, onConfirmSearch, onSelectPaper, onSubmitRepo, onCancel,
}: {
    step: string; topic: string; papers: ArxivPaper[]; messages: string[]; loading: boolean;
    repoUrl: string; onRepoUrlChange: (v: string) => void;
    onConfirmSearch: () => void; onSelectPaper: (p: ArxivPaper) => void;
    onSubmitRepo: () => void; onCancel: () => void;
}) {
    return (
        <div style={{ margin: "12px 0", background: "white", border: "2px solid #34a853", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>🧩</span>
                <span style={{ fontWeight: 600, fontSize: 15, color: "#202124" }}>交互式对齐</span>
                <span style={{ fontSize: 12, color: "#999" }}>主题: {topic}</span>
                {loading && <span style={{ fontSize: 12, color: "#34a853", marginLeft: "auto" }}>⏳ 处理中...</span>}
            </div>

            {/* 消息列表 */}
            {messages.map((msg, i) => (
                <div key={i} style={{ fontSize: 13, color: "#333", marginBottom: 6, lineHeight: 1.5 }}>{msg}</div>
            ))}

            {/* 确认搜索 */}
            {step === 'confirm_search' && !loading && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={onConfirmSearch} style={iaBtnStyle("#34a853")}>✅ 搜索 arXiv</button>
                    <button onClick={onCancel} style={iaBtnStyle("#a50e0e")}>❌ 取消</button>
                </div>
            )}

            {/* 搜索结果 */}
            {step === 'showing_results' && papers.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                    {papers.map((paper, i) => (
                        <div
                            key={paper.id}
                            onClick={() => onSelectPaper(paper)}
                            style={{
                                padding: "10px 12px",
                                border: "1px solid #e0e0e0",
                                borderRadius: 8,
                                marginBottom: 8,
                                cursor: "pointer",
                                background: "white",
                                transition: "box-shadow 0.15s",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)")}
                            onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                        >
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a73e8", marginBottom: 4 }}>{paper.title}</div>
                            <div style={{ fontSize: 11, color: "#666" }}>
                                👤 {paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " et al." : ""} · 📅 {paper.published?.slice(0, 10)}
                            </div>
                            <div style={{ fontSize: 12, color: "#5f6368", marginTop: 4, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                {paper.abstract?.slice(0, 200)}{paper.abstract && paper.abstract.length > 200 ? "..." : ""}
                            </div>
                            <div style={{ fontSize: 11, color: "#34a853", marginTop: 4 }}>👆 点击选择此论文</div>
                        </div>
                    ))}
                </div>
            )}

            {/* 手动输入仓库 */}
            {step === 'asking_repo' && !loading && (
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <input
                        value={repoUrl}
                        onChange={e => onRepoUrlChange(e.target.value)}
                        placeholder="https://github.com/owner/repo"
                        style={{
                            flex: 1, padding: "8px 12px", fontSize: 13,
                            border: "1px solid #ddd", borderRadius: 6,
                        }}
                        onKeyDown={e => e.key === "Enter" && onSubmitRepo()}
                    />
                    <button onClick={onSubmitRepo} disabled={!repoUrl.trim()} style={iaBtnStyle("#1a73e8")}>确定</button>
                    <button onClick={onCancel} style={iaBtnStyle("#a50e0e")}>取消</button>
                </div>
            )}
        </div>
    );
}

const iaBtnStyle = (color: string): React.CSSProperties => ({
    padding: "8px 16px",
    background: color,
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
});

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