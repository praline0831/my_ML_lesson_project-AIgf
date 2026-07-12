import { useState } from "react";
import { CodeViewer } from "./components/CodeViewer";

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

const CLAIM_TYPE_META: Record<ClaimType, { icon: string; label: string; color: string }> = {
    formula: { icon: "📐", label: "公式", color: "#7b1fa2" },
    loss: { icon: "🧮", label: "损失", color: "#c62828" },
    algorithm: { icon: "⚙️", label: "算法", color: "#1565c0" },
    hyperparam: { icon: "🎛️", label: "超参", color: "#6a1b9a" },
    training: { icon: "🏋️", label: "训练", color: "#2e7d32" },
    data: { icon: "📊", label: "数据", color: "#ef6c00" },
    arch: { icon: "🏛️", label: "结构", color: "#455a64" },
};

const PRIORITY_META: Record<number, { icon: string; label: string; color: string }> = {
    1: { icon: "🔴", label: "核心贡献", color: "#c62828" },
    2: { icon: "🟡", label: "支撑组件", color: "#f9a825" },
    3: { icon: "🔵", label: "实现细节", color: "#1565c0" },
};

// ───────────── 主组件 ─────────────

export function AlignApp() {
    const [arxivId, setArxivId] = useState("2106.09685");
    const [repoUrl, setRepoUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<ProgressEvent[]>([]);
    const [report, setReport] = useState<AlignmentReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [expandedComponents, setExpandedComponents] = useState<Record<string, boolean>>({});

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
                            setSelectedIndex(0);
                            if (payload.report?.components) {
                                const expanded: Record<string, boolean> = {};
                                payload.report.components.forEach((c: ComponentResult) => {
                                    expanded[c.component.name] = true;
                                });
                                setExpandedComponents(expanded);
                            }
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
            {report && (
                <AlignResult
                    report={report}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    expandedComponents={expandedComponents}
                    onToggleComponent={(name) =>
                        setExpandedComponents(prev => ({ ...prev, [name]: !prev[name] }))
                    }
                />
            )}
        </div>
    );
}

// ───────────── 结果展示 ─────────────

function AlignResult({
    report,
    selectedIndex,
    onSelect,
    expandedComponents,
    onToggleComponent,
}: {
    report: AlignmentReport;
    selectedIndex: number;
    onSelect: (i: number) => void;
    expandedComponents: Record<string, boolean>;
    onToggleComponent: (name: string) => void;
}) {
    const components = report.components ?? [];
    const hasComponents = components.length > 0;

    return (
        <div>
            {/* 头部信息 */}
            <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>{report.paper.title}</h2>
                <p style={{ margin: "4px 0", color: "#666", fontSize: 13 }}>
                    📄 <a href={`https://arxiv.org/abs/${report.paper.arxivId}`} target="_blank" rel="noreferrer">
                        {report.paper.arxivId}
                    </a>
                    {report.repo && (
                        <>
                            {" · "}🔗 <a href={report.repo.url} target="_blank" rel="noreferrer">
                                {report.repo.owner}/{report.repo.repo}
                            </a>
                        </>
                    )}
                </p>
                <SummaryBadges summary={report.summary} />
                {hasComponents && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#5f6368", lineHeight: 1.6 }}>
                        <strong>🏗 架构总览：</strong>
                        {components.map(({ component }) => {
                            const pm = PRIORITY_META[component.priority] ?? PRIORITY_META[3];
                            return (
                                <span key={component.name} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
                                    {pm.icon} <strong>{component.name}</strong>
                                    <span style={{ color: "#999" }}> — {component.description.slice(0, 60)}</span>
                                </span>
                            );
                        })}
                    </div>
                )}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <button
                        onClick={() => {
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

            {/* 两栏 */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(380px, 1fr) minmax(0, 1.4fr)",
                gap: 12,
                minHeight: 600,
            }}>
                {/* 左：分层列表 */}
                <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "auto", maxHeight: "75vh" }}>
                    {hasComponents ? (
                        components.map(({ component, rows }) => {
                            const isExpanded = expandedComponents[component.name] ?? true;
                            const pm = PRIORITY_META[component.priority] ?? PRIORITY_META[3];
                            const matchCount = rows.filter(r => r.status === 'match' || r.status === 'partial').length;

                            return (
                                <div key={component.name}>
                                    <div
                                        onClick={() => onToggleComponent(component.name)}
                                        style={{
                                            padding: "10px 14px",
                                            background: "#f8f9fa",
                                            borderBottom: "1px solid #e0e0e0",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            position: "sticky",
                                            top: 0,
                                            zIndex: 1,
                                        }}
                                    >
                                        <span style={{ fontSize: 11, color: "#666" }}>{isExpanded ? "▼" : "▶"}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: pm.color }}>
                                            {pm.icon} {pm.label}
                                        </span>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{component.name}</span>
                                        <span style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>
                                            {matchCount}/{rows.length} 匹配
                                        </span>
                                    </div>
                                    {isExpanded && rows.map(row => {
                                        const originalIndex = report.rows.indexOf(row);
                                        return (
                                            <ClaimCard
                                                key={originalIndex}
                                                index={originalIndex}
                                                row={row}
                                                selected={originalIndex === selectedIndex}
                                                onClick={() => onSelect(originalIndex)}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })
                    ) : (
                        report.rows.map((row, i) => (
                            <ClaimCard key={i} index={i} row={row} selected={i === selectedIndex} onClick={() => onSelect(i)} />
                        ))
                    )}
                </div>

                {/* 右：代码 */}
                <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
                    <RightPane row={report.rows[selectedIndex]} />
                </div>
            </div>

            {/* 论文总结 */}
            <PaperSummary rows={report.rows} />
        </div>
    );
}

// ───────────── Q&A 卡片 ─────────────

function ClaimCard({
    index,
    row,
    selected,
    onClick,
}: {
    index: number;
    row: AlignmentRow;
    selected: boolean;
    onClick: () => void;
}) {
    const meta = STATUS_META[row.status];
    const typeMeta = row.claim.type ? CLAIM_TYPE_META[row.claim.type] : undefined;
    const importance = row.claim.importance ?? 2;
    return (
        <div
            onClick={onClick}
            style={{
                padding: "12px 14px",
                borderBottom: "1px solid #f1f3f4",
                cursor: "pointer",
                background: selected ? "#e8f0fe" : "transparent",
                borderLeft: selected ? "3px solid #1a73e8" : "3px solid transparent",
                transition: "background 0.1s",
            }}
        >
            {/* 顶部徽标 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ background: meta.bg, color: meta.color, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                    {meta.icon} {meta.label}
                </span>
                {typeMeta && (
                    <span style={{ color: typeMeta.color, fontSize: 11, fontWeight: 600, background: `${typeMeta.color}14`, padding: "2px 8px", borderRadius: 10 }}>
                        {typeMeta.icon} {typeMeta.label}
                    </span>
                )}
                <span style={{ fontSize: 11, color: importance === 3 ? "#e37400" : importance === 2 ? "#5f6368" : "#bdc1c6", letterSpacing: 1, fontWeight: 600 }}
                    title={`重要度 ${importance}/3`}
                >
                    {"★".repeat(importance)}
                    <span style={{ color: "#dadce0" }}>{"★".repeat(3 - importance)}</span>
                </span>
                <span style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>
                    #{index + 1} · {row.claim.location}
                </span>
            </div>

            {/* 描述 */}
            <div style={{ fontSize: 14, color: "#202124", fontWeight: importance === 3 ? 600 : 500, marginBottom: 4, lineHeight: 1.4 }}>
                {row.claim.description}
            </div>

            {/* 引用 */}
            {row.claim.quote && (
                <div style={{ fontSize: 12, color: "#5f6368", fontStyle: "italic", borderLeft: "2px solid #dadce0", paddingLeft: 8, margin: "4px 0 6px", lineHeight: 1.5, maxHeight: 50, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                    title={row.claim.quote}
                >
                    "{row.claim.quote}"
                </div>
            )}

            {/* 对齐说明 */}
            <div style={{ fontSize: 12, color: "#5f6368", lineHeight: 1.5 }}>{row.note}</div>

            {/* 证据行预览 */}
            {row.evidenceSpans && row.evidenceSpans.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {row.evidenceSpans.map((s, i) => (
                        <span key={i} style={{ fontSize: 10, background: "#0e639c14", color: "#0e639c", padding: "1px 6px", borderRadius: 3, fontFamily: "monospace" }}>
                            L{s.startLine}-{s.endLine}
                        </span>
                    ))}
                </div>
            )}

            {/* 底部 */}
            {row.matchedFunction && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 11, color: "#5f6368", fontFamily: "monospace" }}>
                    <span>
                        📍 {row.matchedFunction.file} · L{row.matchedFunction.startLine}-{row.matchedFunction.endLine}
                    </span>
                    <span style={{ color: confidenceColor(row.confidence), fontWeight: 600 }}>
                        {(row.confidence * 100).toFixed(0)}%
                    </span>
                </div>
            )}
        </div>
    );
}

function confidenceColor(c: number): string {
    if (c >= 0.85) return "#0d652d";
    if (c >= 0.65) return "#9a6700";
    if (c >= 0.4) return "#e37400";
    return "#a50e0e";
}

// ───────────── 右侧代码面板 ─────────────

function RightPane({ row }: { row: AlignmentRow | undefined }) {
    if (!row) {
        return <EmptyPane text="选择左侧的 claim 以查看对应代码" />;
    }

    const meta = STATUS_META[row.status];

    if (!row.matchedFunction) {
        return (
            <div style={paneStyle}>
                <div style={{ padding: 24, textAlign: "center", color: "#5f6368" }}>
                    <div style={{ fontSize: 48, marginBottom: 8 }}>{meta.icon}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: meta.color }}>
                        {row.claim.description}
                    </div>
                    <div style={{ fontSize: 13, color: "#5f6368", marginTop: 8 }}>
                        {row.status === "missing"
                            ? "代码中未找到对应的实现"
                            : row.note}
                    </div>
                    <ReasoningPanel reasoning={row.reasoning} />
                </div>
            </div>
        );
    }

    const focusLine = row.evidenceLine ?? row.matchedFunction.startLine;

    return (
        <div style={paneStyle}>
            <CodeViewer
                code={row.matchedFunction.body}
                filePath={row.matchedFunction.file}
                language="python"
                highlightRange={{
                    start: row.matchedFunction.startLine,
                    end: row.matchedFunction.endLine,
                }}
                focusLine={focusLine}
                lineNumberStart={row.matchedFunction.startLine}
                contextWindow={4}
                maxHeight={520}
            />

            <div style={{ marginTop: 8, padding: 12, background: "#f8f9fa", borderRadius: 6, fontSize: 13, lineHeight: 1.6 }}>
                {/* 状态 */}
                <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ background: meta.bg, color: meta.color, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                        {meta.icon} {meta.label}
                    </span>
                    <span style={{ color: "#666", fontSize: 12 }}>
                        置信度 <strong style={{ color: confidenceColor(row.confidence) }}>{(row.confidence * 100).toFixed(0)}%</strong>
                    </span>
                </div>
                <div style={{ color: "#202124" }}>{row.note}</div>

                {/* Evidence 行范围 */}
                {row.evidenceSpans && row.evidenceSpans.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: "#5f6368", marginBottom: 4 }}>📐 公式-代码对应：</div>
                        {row.evidenceSpans.map((span, i) => (
                            <div key={i} style={{
                                marginBottom: 6,
                                padding: "6px 10px",
                                background: "#0e639c08",
                                borderLeft: "3px solid #0e639c",
                                borderRadius: 3,
                                fontSize: 12,
                            }}>
                                <div style={{ fontFamily: "monospace", color: "#0e639c", marginBottom: 2 }}>
                                    L{span.startLine}-{span.endLine}
                                    {span.formulaContext && <span style={{ color: "#666", marginLeft: 8 }}>← {span.formulaContext}</span>}
                                </div>
                                {span.variableMappings && span.variableMappings.length > 0 && (
                                    <div style={{ marginTop: 2, fontSize: 11, color: "#5f6368" }}>
                                        {span.variableMappings.map((vm, j) => (
                                            <span key={j} style={{ marginRight: 8 }}>
                                                <strong>{vm.formulaVar}</strong> → <code>{vm.codeVar}</code>
                                                {vm.context ? <span style={{ color: "#999" }}> ({vm.context})</span> : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, color: "#202124", whiteSpace: "pre-wrap", maxHeight: 80, overflow: "hidden" }}>
                                    {span.codeSnippet.slice(0, 200)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 旧版 evidence */}
                {row.evidence && (!row.evidenceSpans || row.evidenceSpans.length === 0) && (
                    <div style={{ marginTop: 8, padding: "6px 10px", background: "#0e639c14", borderLeft: "3px solid #0e639c", borderRadius: 3, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", color: "#0e639c" }}>
                        <span style={{ fontWeight: 600, color: "#5f6368" }}>🔍 证据：</span>
                        {row.evidence}
                    </div>
                )}

                <ReasoningPanel reasoning={row.reasoning} />
            </div>
        </div>
    );
}

/** 可展开的推理过程面板 */
function ReasoningPanel({ reasoning }: { reasoning?: string }) {
    const [open, setOpen] = useState(false);
    if (!reasoning) return null;
    return (
        <div style={{ marginTop: 8 }}>
            <button
                onClick={() => setOpen((o) => !o)}
                style={{ background: "transparent", border: "none", color: "#1a73e8", fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}
            >
                {open ? "▼" : "▶"} 💡 {open ? "隐藏推理" : "显示推理"}
            </button>
            {open && (
                <div style={{ marginTop: 4, padding: 8, background: "white", border: "1px solid #e0e0e0", borderRadius: 4, fontSize: 12, color: "#5f6368", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {reasoning}
                </div>
            )}
        </div>
    );
}

/** 论文总结组件：按重要度分条展示论文核心声明 */
function PaperSummary({ rows }: { rows: AlignmentReport["rows"] }) {
    const [collapsed, setCollapsed] = useState(true);
    const coreClaims = rows.filter(r => (r.claim.importance ?? 2) === 1);
    const supportClaims = rows.filter(r => (r.claim.importance ?? 2) === 2);
    const detailClaims = rows.filter(r => (r.claim.importance ?? 2) === 3);

    return (
        <div style={{ marginTop: 16, background: "white", border: "1px solid #e0e0e0", borderRadius: 8 }}>
            <div
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    userSelect: "none",
                    borderBottom: collapsed ? "none" : "1px solid #e0e0e0",
                }}
            >
                <span style={{ fontSize: 14, color: "#666" }}>{collapsed ? "▶" : "▼"}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: "#202124" }}>📝 论文总结</span>
                <span style={{ fontSize: 12, color: "#999" }}>{rows.length} 个声明</span>
            </div>
            {!collapsed && (
                <div style={{ padding: "8px 16px 16px" }}>
                    {coreClaims.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#c62828", marginBottom: 6 }}>🔴 核心贡献</div>
                            {coreClaims.map((r, i) => (
                                <div key={i} style={{ fontSize: 13, color: "#333", padding: "3px 0 3px 16px", lineHeight: 1.5 }}>
                                  • {r.claim.description}
                                </div>
                            ))}
                        </div>
                    )}
                    {supportClaims.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#f9a825", marginBottom: 6 }}>🟡 支撑组件</div>
                            {supportClaims.map((r, i) => (
                                <div key={i} style={{ fontSize: 13, color: "#333", padding: "3px 0 3px 16px", lineHeight: 1.5 }}>
                                  • {r.claim.description}
                                </div>
                            ))}
                        </div>
                    )}
                    {detailClaims.length > 0 && (
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1565c0", marginBottom: 6 }}>🔵 实现细节</div>
                            {detailClaims.map((r, i) => (
                                <div key={i} style={{ fontSize: 13, color: "#333", padding: "3px 0 3px 16px", lineHeight: 1.5 }}>
                                  • {r.claim.description}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function EmptyPane({ text }: { text: string }) {
    return (
        <div style={{ ...paneStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, minHeight: 400 }}>
            {text}
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
