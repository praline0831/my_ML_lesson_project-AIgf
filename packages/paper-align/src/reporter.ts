import type { AlignmentRow, AlignmentReport } from './types.js';

const STATUS_ICON: Record<AlignmentRow['status'], string> = {
    match: '✅',
    partial: '🟡',
    mismatch: '❌',
    missing: '❔',
};

const STATUS_LABEL: Record<AlignmentRow['status'], string> = {
    match: 'match',
    partial: 'partial',
    mismatch: 'mismatch',
    missing: 'missing',
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

    lines.push(`# Paper-Code Alignment Report`);
    lines.push('');
    lines.push(`## Paper`);
    lines.push(`- **Title**: ${input.paper.title}`);
    lines.push(`- **arXiv**: [${input.paper.arxivId}](https://arxiv.org/abs/${input.paper.arxivId})`);
    if (input.repo) {
        lines.push(`- **Repository**: [${input.repo.owner}/${input.repo}](${input.repo.url})`);
    } else if (input.paper.repoUrl) {
        lines.push(`- **Candidate repo**: ${input.paper.repoUrl}`);
    }
    lines.push('');

    lines.push(`## Summary`);
    lines.push(`- Total claims: ${summary.total}`);
    lines.push(`- ✅ match: **${summary.matched}** | 🟡 partial: **${summary.partial}** | ❌ mismatch: **${summary.mismatch}** | ❔ missing: **${summary.missing}**`);

    if (summary.total > 0) {
        const coverage = (summary.matched + summary.partial) / summary.total;
        lines.push(`- **Coverage**: ${(coverage * 100).toFixed(0)}% (match + partial)`);
    }
    lines.push('');

    lines.push(`## Alignment Matrix`);
    lines.push('');
    lines.push(`| # | Status | Paper Claim | Source | Code | Note |`);
    lines.push(`|---|------|---------|---------|---------|------|`);
    input.rows.forEach((row, i) => {
        const icon = STATUS_ICON[row.status];
        const label = STATUS_LABEL[row.status];
        const claim = row.claim.description.replace(/\|/g, '\\|');
        const location = row.claim.location.replace(/\|/g, '\\|');
        const codeRef = row.matchedFunction
            ? `\`${row.matchedFunction.file}\`::\`${row.matchedFunction.name}\` (L${row.matchedFunction.startLine})${row.evidenceLine != null ? ` ← L${row.evidenceLine}` : ''}`
            : '—';
        const note = row.note.replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | ${icon} ${label} | ${claim} | ${location} | ${codeRef} | ${note} |`);
    });
    lines.push('');

    const withCode = input.rows.filter(r => r.matchedFunction);
    if (withCode.length > 0) {
        lines.push(`## Key Code Snippets`);
        lines.push('');
        for (const row of withCode) {
            const f = row.matchedFunction!;
            lines.push(`### ${row.status === 'match' ? '✅' : row.status === 'partial' ? '🟡' : '❌'} ${row.claim.description}`);
            lines.push(`- **File**: \`${f.file}\` L${f.startLine}-${f.endLine}`);
            lines.push(`- **Claim**: ${row.claim.description} (${row.claim.location})`);
            lines.push(`- **Note**: ${row.note} (confidence ${(row.confidence * 100).toFixed(0)}%)`);
            if (row.evidenceLine != null) {
                lines.push(`- **Evidence line**: L${row.evidenceLine}`);
            }
            if (row.evidence) {
                lines.push(`- **Key evidence**: \`${row.evidence}\``);
            }
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
