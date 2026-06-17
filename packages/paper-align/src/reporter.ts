/**
 * 对齐报告生成器
 *
 * 输出 Markdown 表格 + 总结
 */

import type { AlignmentRow, AlignmentReport } from './types.js';

const STATUS_ICON: Record<AlignmentRow['status'], string> = {
    match: '✅',
    partial: '🟡',
    mismatch: '❌',
    missing: '❔',
};

const STATUS_LABEL: Record<AlignmentRow['status'], string> = {
    match: '匹配',
    partial: '部分',
    mismatch: '偏差',
    missing: '缺失',
};

export function buildReport(input: {
    paper: { arxivId: string; title: string; repoUrl?: string };
    repo?: { owner: string; repo: string; url: string };
    rows: AlignmentRow[];
}): AlignmentReport {
    const summary = {
        total: input.rows.length,
        matched: input.rows.filter(r => r.status === 'match').length,
        partial: input.rows.filter(r => r.status === 'partial').length,
        mismatch: input.rows.filter(r => r.status === 'mismatch').length,
        missing: input.rows.filter(r => r.status === 'missing').length,
    };

    const markdown = renderMarkdown(input, summary);

    return {
        paper: input.paper,
        repo: input.repo,
        generatedAt: new Date().toISOString(),
        rows: input.rows,
        summary,
        markdown,
    };
}

function renderMarkdown(
    input: {
        paper: { arxivId: string; title: string; repoUrl?: string };
        repo?: { owner: string; repo: string; url: string };
        rows: AlignmentRow[];
    },
    summary: AlignmentReport['summary']
): string {
    const lines: string[] = [];

    lines.push(`# 论文-代码对齐报告`);
    lines.push('');
    lines.push(`## 论文`);
    lines.push(`- **标题**: ${input.paper.title}`);
    lines.push(`- **arXiv**: [${input.paper.arxivId}](https://arxiv.org/abs/${input.paper.arxivId})`);
    if (input.repo) {
        lines.push(`- **仓库**: [${input.repo.owner}/${input.repo}](${input.repo.url})`);
    } else if (input.paper.repoUrl) {
        lines.push(`- **候选仓库**: ${input.paper.repoUrl}`);
    }
    lines.push('');

    lines.push(`## 总结`);
    lines.push(`- 共 ${summary.total} 个声明`);
    lines.push(`- ✅ 匹配: **${summary.matched}** | 🟡 部分: **${summary.partial}** | ❌ 偏差: **${summary.mismatch}** | ❔ 缺失: **${summary.missing}**`);

    if (summary.total > 0) {
        const coverage = (summary.matched + summary.partial) / summary.total;
        lines.push(`- **覆盖率**: ${(coverage * 100).toFixed(0)}%（match + partial）`);
    }
    lines.push('');

    lines.push(`## 对齐矩阵`);
    lines.push('');
    lines.push(`| # | 状态 | 论文声明 | 论文出处 | 对应代码 | 说明 |`);
    lines.push(`|---|------|---------|---------|---------|------|`);
    input.rows.forEach((row, i) => {
        const icon = STATUS_ICON[row.status];
        const label = STATUS_LABEL[row.status];
        const claim = row.claim.description.replace(/\|/g, '\\|');
        const location = row.claim.location.replace(/\|/g, '\\|');
        const codeRef = row.matchedFunction
            ? `\`${row.matchedFunction.file}\`::\`${row.matchedFunction.name}\` (L${row.matchedFunction.startLine})`
            : '—';
        const note = row.note.replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | ${icon} ${label} | ${claim} | ${location} | ${codeRef} | ${note} |`);
    });
    lines.push('');

    // 详细代码片段
    const withCode = input.rows.filter(r => r.matchedFunction);
    if (withCode.length > 0) {
        lines.push(`## 关键代码片段`);
        lines.push('');
        for (const row of withCode) {
            const f = row.matchedFunction!;
            lines.push(`### ${row.status === 'match' ? '✅' : row.status === 'partial' ? '🟡' : '❌'} ${row.claim.description}`);
            lines.push(`- **文件**: \`${f.file}\` L${f.startLine}-${f.endLine}`);
            lines.push(`- **声明**: ${row.claim.description}（${row.claim.location}）`);
            lines.push(`- **说明**: ${row.note}（置信度 ${(row.confidence * 100).toFixed(0)}%）`);
            lines.push('');
            lines.push('```python');
            const snippet = f.body.length > 2000 ? f.body.slice(0, 2000) + '\n# ...' : f.body;
            lines.push(snippet);
            lines.push('```');
            lines.push('');
        }
    }

    return lines.join('\n');
}
