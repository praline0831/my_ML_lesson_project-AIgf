/**
 * VSCode 风格代码块
 *
 * - 顶部文件路径 tab（带语言标识）
 * - 左侧行号
 * - prism-react-renderer 语法高亮（vsDark 主题）
 * - 支持高亮一段行号范围（matched function）
 * - 支持聚焦到某一行（外层传 highlightLine）
 */

import { Highlight, themes } from "prism-react-renderer";
import { useEffect, useMemo, useRef } from "react";

export interface CodeViewerProps {
    /** 源代码 */
    code: string;
    /** 文件路径（显示在 tab 头部） */
    filePath: string;
    /** 语言（python / javascript / ...），默认 python */
    language?: string;
    /** 高亮行范围（1-based，含端点） */
    highlightRange?: { start: number; end: number };
    /** 当前聚焦行（会高亮 + 滚动到位） */
    focusLine?: number;
    /**
     * 显示的第 1 行 = 文件的第几行
     * 比如函数体在文件的第 42 行开始，这里传 42
     * 不传则默认从 1 开始
     */
    lineNumberStart?: number;
    /**
     * 上下文窗大小（focusLine 上下多少行高亮）
     * 默认 3，即 focusLine ±3 行（共 7 行）用浅蓝高亮
     */
    contextWindow?: number;
    /** 最大高度（不传则自适应） */
    maxHeight?: number;
}

export function CodeViewer({
    code,
    filePath,
    language = "python",
    highlightRange,
    focusLine,
    lineNumberStart = 1,
    contextWindow = 3,
    maxHeight = 600,
}: CodeViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    // 当 focusLine 变化时滚动到对应行
    useEffect(() => {
        if (focusLine == null) return;
        // focusLine 是文件绝对行号，要换算到显示行号再从 ref 找
        const displayedLine = focusLine - lineNumberStart + 1;
        const el = lineRefs.current.get(displayedLine);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [focusLine, lineNumberStart]);

    // 文件名 + 扩展名
    const fileName = useMemo(() => {
        const parts = filePath.split("/");
        return parts[parts.length - 1] || filePath;
    }, [filePath]);

    const langLabel = useMemo(() => {
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
        const map: Record<string, string> = {
            py: "Python",
            ipynb: "Jupyter",
            js: "JavaScript",
            ts: "TypeScript",
            tsx: "TSX",
            jsx: "JSX",
            json: "JSON",
            md: "Markdown",
            yaml: "YAML",
            yml: "YAML",
        };
        return map[ext] ?? language;
    }, [fileName, language]);

    return (
        <div
            style={{
                background: "#1e1e1e",
                borderRadius: 6,
                overflow: "hidden",
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 13,
                border: "1px solid #333",
            }}
        >
            {/* 顶部 tab bar（VSCode 风格） */}
            <div
                style={{
                    background: "#252526",
                    padding: "6px 12px",
                    borderBottom: "1px solid #1e1e1e",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    color: "#cccccc",
                }}
            >
                <span style={{ fontSize: 14 }}>{getFileIcon(fileName)}</span>
                <span style={{ flex: 1, fontFamily: "Consolas, monospace" }}>{filePath}</span>
                <span
                    style={{
                        background: "#0e639c",
                        color: "#fff",
                        padding: "1px 6px",
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 600,
                    }}
                >
                    {langLabel}
                </span>
            </div>

            {/* 上下文省略提示：上面还有 N 行被隐藏了 */}
            {lineNumberStart > 1 && (
                <div
                    style={{
                        background: "#2a2d2e",
                        color: "#858585",
                        padding: "3px 12px",
                        fontSize: 11,
                        textAlign: "center",
                        fontFamily: "ui-monospace, Menlo, monospace",
                        borderBottom: "1px solid #1e1e1e",
                    }}
                >
                    ⋮ 上方省略 {lineNumberStart - 1} 行
                </div>
            )}

            {/* 代码区 */}
            <div
                ref={containerRef}
                style={{
                    maxHeight,
                    overflow: "auto",
                    background: "#1e1e1e",
                }}
            >
                <Highlight theme={themes.vsDark} code={code.trimEnd()} language={language}>
                    {({ className, style, tokens, getLineProps, getTokenProps }) => (
                        <pre
                            className={className}
                            style={{
                                ...style,
                                background: "transparent",
                                margin: 0,
                                padding: "10px 0",
                                fontSize: 13,
                                lineHeight: 1.55,
                            }}
                        >
                            {tokens.map((line, i) => {
                                const displayedLine = i + 1;             // 显示行号（body 内的行号）
                                const fileLine = displayedLine + lineNumberStart - 1;  // 实际文件行号
                                const isInRange =
                                    highlightRange &&
                                    fileLine >= highlightRange.start &&
                                    fileLine <= highlightRange.end;

                                // 上下文窗：focusLine ± contextWindow 行
                                const inContext =
                                    focusLine != null &&
                                    Math.abs(fileLine - focusLine) <= contextWindow;
                                const isFocused = focusLine === fileLine;
                                // 优先级：focused > inContext > inRange
                                const highlightLevel = isFocused
                                    ? 'focused'
                                    : inContext
                                        ? 'context'
                                        : isInRange
                                            ? 'range'
                                            : 'none';

                                return (
                                    <div
                                        key={i}
                                        ref={(el) => {
                                            if (el) lineRefs.current.set(displayedLine, el);
                                            else lineRefs.current.delete(displayedLine);
                                        }}
                                        {...getLineProps({ line })}
                                        style={{
                                            display: "flex",
                                            background:
                                                highlightLevel === 'focused' ? "#04395e" :
                                                    highlightLevel === 'context' ? "#1a3a5c" :
                                                        highlightLevel === 'range' ? "#2a2d2e" :
                                                            "transparent",
                                            borderLeft:
                                                highlightLevel === 'focused' ? "3px solid #1a73e8" :
                                                    highlightLevel === 'context' ? "3px solid #4a9eff" :
                                                        highlightLevel === 'range' ? "3px solid #0e639c" :
                                                            "3px solid transparent",
                                            transition: "background 0.15s",
                                        }}
                                    >
                                        {/* 行号（显示文件绝对行号） */}
                                        <span
                                            style={{
                                                display: "inline-block",
                                                width: 50,
                                                paddingRight: 12,
                                                textAlign: "right",
                                                color: highlightLevel === 'none' ? "#6a6a6a" : "#e0e0e0",
                                                userSelect: "none",
                                                flexShrink: 0,
                                                fontWeight: highlightLevel === 'focused' ? 700 : 400,
                                            }}
                                        >
                                            {fileLine}
                                            {isFocused && (
                                                <span
                                                    style={{
                                                        marginLeft: 6,
                                                        color: "#4a9eff",
                                                        fontSize: 10,
                                                    }}
                                                >
                                                    ◀
                                                </span>
                                            )}
                                        </span>
                                        {/* 代码 */}
                                        <span style={{ flex: 1, paddingRight: 12 }}>
                                            {line.map((token, key) => (
                                                <span key={key} {...getTokenProps({ token })} />
                                            ))}
                                        </span>
                                    </div>
                                );
                            })}
                        </pre>
                    )}
                </Highlight>
            </div>
        </div>
    );
}

function getFileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "py") return "🐍";
    if (ext === "ipynb") return "📓";
    if (["js", "jsx"].includes(ext)) return "📜";
    if (["ts", "tsx"].includes(ext)) return "📘";
    if (["json", "yaml", "yml"].includes(ext)) return "⚙️";
    if (["md", "markdown"].includes(ext)) return "📝";
    return "📄";
}
