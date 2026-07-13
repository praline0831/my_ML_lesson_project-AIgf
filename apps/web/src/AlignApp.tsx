import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:4000";

// ───────────── 类型 ─────────────

type AlignStatus = "match" | "partial" | "mismatch" | "missing";
type ClaimType = "formula" | "loss" | "algorithm" | "hyperparam" | "training" | "data" | "arch";

interface PaperClaim {
    description: string;
    location: string;
    quote?: string;
    type?: ClaimType;
    importance?: 1 | 2 | 3;
}

interface VariableMapping {
    formulaVar: string;
    codeVar: string;
    context: string;
}

interface EvidenceSpan {
    startLine: number;
    endLine: number;
    codeSnippet: string;
    formulaContext?: string;
    variableMappings?: VariableMapping[];
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

interface PaperComponent {
    name: string;
    description: string;
    priority: 1 | 2 | 3;
    location: string;
    claims: PaperClaim[];
}

interface AlignmentRow {
    claim: PaperClaim;
    componentName?: string;
    matchedFunction?: CodeFunction;
    matchedFunctions?: CodeFunction[];
    evidenceSpans?: EvidenceSpan[];
    status: AlignStatus;
    note: string;
    confidence: number;
    reasoning?: string;
    evidence?: string;
    evidenceLine?: number;
}

interface ComponentResult {
    component: PaperComponent;
    rows: AlignmentRow[];
}

interface AlignmentReport {
    paper: { arxivId: string; title: string; repoUrl?: string };
    repo?: { owner: string; repo: string; url: string };
    generatedAt: string;
    components?: ComponentResult[];
    rows: AlignmentRow[];
    summary: { total: number; matched: number; partial: number; mismatch: number; missing: number };
    markdown: string;
}

interface ProgressEvent {
    stage: "paper" | "repo" | "functions" | "align";
    info: string;
}

const STATUS_META: Record<AlignStatus, { icon: string; label: string; color: string; bg: string }> = {
    match: { icon: "✅", label: "匹配", color: "#0d652d", bg: "#e6f4ea" },
    partial: { icon: "🟡", label: "部分", color: "#9a6700", bg: "#fef7e0" },
    mismatch: { icon: "❌", label: "偏差", color: "#a50e0e", bg: "#fce8e6" },
    missing: { icon: "❔", label: "缺失", color: "#5f6368", bg: "#f1f3f4" },
};

// ───────────── 主组件 ─────────────

export function AlignApp() {
    const [arxivId, setArxivId] = useState("2106.09685");
    const [repoUrl, setRepoUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<ProgressEvent[]>([]);
    const [report, setReport] = useState<AlignmentReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        if (!arxivId.trim() || loading) return;
        setLoading(true);
        setError(null);
        setReport(null);
        setProgress([]);

        try {
            const res = await fetch(`${API_BASE}/align/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    arxiv_id: arxivId.trim(),
                    repo_url: repoUrl.trim() || undefined,
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
                            setProgress((prev) => [
                                ...prev,
                                { stage: payload.stage, info: payload.info },
                            ]);
                        } else if (payload.type === "done") {
                            setReport(payload.report);
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
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
            {/* 顶部 */}
            <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, color: "#1a73e8" }}>🔬 论文-代码对齐</h1>
                <p style={{ color: "#666", margin: "4px 0 12px" }}>
                    分层对齐：先识别核心组件，再精确定位公式实现的行级代码
                </p>
                <div style={{
                    display: "flex", gap: 8, background: "#f8f9fa", padding: 12, borderRadius: 8, alignItems: "center",
                }}>
                    <span style={{ fontSize: 12, color: "#666" }}>📄 arXiv:</span>
                    <input
                        value={arxivId}
                        onChange={(e) => setArxivId(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && run()}
                        placeholder="2106.09685"
                        disabled={loading}
                        style={inputStyle}
                    />
                    <span style={{ fontSize: 12, color: "#666" }}>🔗 Repo (可选):</span>
                    <input
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo"
                        disabled={loading}
                        style={{ ...inputStyle, flex: 2 }}
                    />
                    <button onClick={run} disabled={loading || !arxivId.trim()} style={runButtonStyle(loading)}>
                        {loading ? "⏳ 对齐中..." : "▶ Run Align"}
                    </button>
                </div>
            </div>

            {/* 错误 */}
            {error && (
                <div style={{ background: "#fce8e6", color: "#a50e0e", padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
                    ❌ {error}
                </div>
            )}

            {/* 进度 */}
            {loading && progress.length > 0 && (
                <div style={{ background: "#e8f0fe", padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
                    <strong>📊 进度：</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                        {progress.slice(-6).map((p, i) => (
                            <li key={i}>
                                <code style={codeTag}>{p.stage}</code> — {p.info}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* 结果 */}
            {report && <AlignResult report={report} />}
        </div>
    );
}

// ───────────── 结果展示 ─────────────

const mdStyle = `
.report-md h1 { font-size: 1.4em; margin-top: 1em; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; }
.report-md h2 { font-size: 1.2em; margin-top: 1em; }
.report-md h3 { font-size: 1.1em; margin-top: 0.8em; }
.report-md code { background: #f1f3f4; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
.report-md pre { background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; }
.report-md table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.report-md th, .report-md td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 0.9em; }
.report-md th { background: #f5f5f5; font-weight: 600; }
.report-md blockquote { border-left: 3px solid #1a73e8; margin: 0.5em 0; padding: 0.5em 1em; background: #f8f9fa; }
.report-md img { max-width: 100%; }
`;

function AlignResult({ report }: { report: AlignmentReport }) {
    return (
        <div>
            {/* 头部信息 */}
            <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>{report.paper.title}</h2>
                        <p style={{ margin: "4px 0", color: "#666", fontSize: 13 }}>
                            📄 <a href={`https://arxiv.org/abs/${report.paper.arxivId}`} target="_blank" rel="noreferrer">
                                {report.paper.arxivId}
                            </a>
                            {report.repo && (
                                <>{" · "}🔗 <a href={report.repo.url} target="_blank" rel="noreferrer">
                                    {report.repo.owner}/{report.repo.repo}
                                </a></>
                            )}
                        </p>
                    </div>
                    <SummaryBadges summary={report.summary} />
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button onClick={() => {
                        fetch(`${API_BASE}/align/export`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ markdown: report.markdown, arxiv_id: report.paper.arxivId }),
                        })
                            .then(res => res.blob())
                            .then(blob => {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `align-${report.paper.arxivId}-${Date.now()}.md`;
                                a.click();
                                URL.revokeObjectURL(url);
                            });
                    }} style={{ padding: "8px 16px", background: "#1a73e8", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                        📥 导出报告 (.md)
                    </button>
                </div>
            </div>

            {/* Markdown 报告预览 */}
            <div className="report-md" style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: "16px 24px", maxHeight: "80vh", overflow: "auto", lineHeight: 1.7, fontSize: 14 }}>
                <style>{mdStyle}</style>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
            </div>
        </div>
    );
}

// ───────────── 小件 ─────────────

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
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#5f6368", alignSelf: "center" }}>
                共 {summary.total} 个声明
            </span>
        </div>
    );
}

// ───────────── 样式 ─────────────

const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "8px 10px",
    fontSize: 13,
    border: "1px solid #ddd",
    borderRadius: 4,
    fontFamily: "Consolas, monospace",
    minWidth: 120,
};

const runButtonStyle = (loading: boolean): React.CSSProperties => ({
    padding: "8px 20px",
    background: loading ? "#ccc" : "#1a73e8",
    color: "white",
    border: "none",
    borderRadius: 4,
    cursor: loading ? "not-allowed" : "pointer",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
});

const paneStyle: React.CSSProperties = {
    background: "white",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    padding: 10,
};

const codeTag: React.CSSProperties = {
    background: "#fff",
    padding: "0 6px",
    borderRadius: 3,
    fontSize: 11,
    color: "#1a73e8",
    border: "1px solid #c8d7f0",
};
