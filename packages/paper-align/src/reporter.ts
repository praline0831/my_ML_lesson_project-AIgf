import type { AlignmentRow, AlignmentReport, EvidenceSpan, PaperComponent, VariableMapping } from './types.js';

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
    components: { component: PaperComponent; rows: AlignmentRow[] }[];
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
        components: input.components,
        rows: input.rows,
        summary,
        markdown,
    };
}

function renderVariableMappings(mappings?: VariableMapping[]): string {
    if (!mappings || mappings.length === 0) return '';
    return mappings.map(m =>
        `    - **${m.formulaVar}** → \`${m.codeVar}\` ${m.context ? `(${m.context})` : ''}`
    ).join('\n');
}

function renderEvidenceSpan(span: EvidenceSpan): string {
    const lines: string[] = [];
    lines.push(`    **Lines ${span.startLine}-${span.endLine}**`);
    if (span.formulaContext) {
        lines.push(`    Formula part: \`${span.formulaContext}\``);
    }
    if (span.variableMappings && span.variableMappings.length > 0) {
        lines.push(renderVariableMappings(span.variableMappings));
    }
    lines.push('');
    lines.push('    ```python');
    const code = span.codeSnippet.length > 500
        ? span.codeSnippet.slice(0, 500) + '\n    # ...'
        : span.codeSnippet;
    lines.push(code);
    lines.push('    ```');
    return lines.join('\n');
}

function renderComponentSection(component: PaperComponent, rows: AlignmentRow[]): string {
    const lines: string[] = [];

    const priorityLabel = component.priority === 1 ? '🔴 Core' : component.priority === 2 ? '🟡 Supporting' : '🔵 Detail';
    const matchCount = rows.filter(r => r.status === 'match' || r.status === 'partial').length;

    lines.push(`### ${priorityLabel}: ${component.name}`);
    lines.push('');
    lines.push(`${component.description}`);
    lines.push('');
    lines.push(`- **Location**: ${component.location}`);
    lines.push(`- **Claims**: ${rows.length} (${matchCount} matched)`);
    lines.push('');

    for (const row of rows) {
        const icon = STATUS_ICON[row.status];
        const label = STATUS_LABEL[row.status];

        lines.push(`#### ${icon} ${row.claim.description}`);
        lines.push('');
        lines.push(`| | |`);
        lines.push(`|---|---|`);
        lines.push(`| **Status** | ${icon} ${label} (${(row.confidence * 100).toFixed(0)}%) |`);
        lines.push(`| **Location** | ${row.claim.location} |`);
        if (row.claim.quote) {
            lines.push(`| **Quote** | "${row.claim.quote.slice(0, 200)}" |`);
        }
        lines.push(`| **Note** | ${row.note} |`);

        if (row.matchedFunctions && row.matchedFunctions.length > 0) {
            const fns = row.matchedFunctions.map(f =>
                `\`${f.file}\`::\`${f.name}\` (L${f.startLine}-${f.endLine})`
            ).join(', ');
            lines.push(`| **Code** | ${fns} |`);
        } else if (row.matchedFunction) {
            lines.push(`| **Code** | \`${row.matchedFunction.file}\`::\`${row.matchedFunction.name}\` (L${row.matchedFunction.startLine})${row.evidenceLine != null ? ` ← L${row.evidenceLine}` : ''} |`);
        } else {
            lines.push(`| **Code** | — |`);
        }

        if (row.reasoning) {
            lines.push(`| **Reasoning** | ${row.reasoning.slice(0, 200)} |`);
        }
        lines.push('');

        if (row.evidenceSpans && row.evidenceSpans.length > 0) {
            lines.push('**Evidence:**');
            lines.push('');
            for (const span of row.evidenceSpans) {
                lines.push(renderEvidenceSpan(span));
                lines.push('');
            }
        } else if (row.evidence) {
            lines.push('**Evidence:**');
            lines.push('');
            lines.push(`    \`${row.evidence}\``);
            lines.push('');
        }
    }

    return lines.join('\n');
}

function renderMarkdown(
    input: {
        paper: { arxivId: string; title: string; repoUrl?: string };
        repo?: { owner: string; repo: string; url: string };
        components: { component: PaperComponent; rows: AlignmentRow[] }[];
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

    const coreMatched = input.components
        .filter(c => c.component.priority === 1)
        .every(c => c.rows.some(r => r.status === 'match' || r.status === 'partial'));
    lines.push(`- **Core components matched**: ${coreMatched ? '✅ Yes' : '⚠️ Partial'}`);
    lines.push('');

    lines.push(`## Architecture Overview`);
    lines.push('');
    for (const { component } of input.components) {
        const priorityLabel = component.priority === 1 ? '🔴' : component.priority === 2 ? '🟡' : '🔵';
        lines.push(`- ${priorityLabel} **${component.name}**: ${component.description} _(§${component.location})_`);
    }
    lines.push('');

    lines.push(`## Component Details`);
    lines.push('');

    const sortedComponents = [...input.components].sort((a, b) => a.component.priority - b.component.priority);
    for (const { component, rows } of sortedComponents) {
        lines.push(renderComponentSection(component, rows));
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    lines.push('## 论文总结');
    lines.push('');

    const coreComponents = input.components.filter(c => c.component.priority === 1);
    const supportComponents = input.components.filter(c => c.component.priority === 2);
    const detailComponents = input.components.filter(c => c.component.priority === 3);

    if (coreComponents.length > 0) {
        lines.push('### 🔴 核心贡献');
        for (const { component, rows } of coreComponents) {
            lines.push(`- **${component.name}**: ${component.description}`);
            for (const row of rows) {
                const icon = STATUS_ICON[row.status];
                lines.push(`  - ${icon} ${row.claim.description}`);
            }
        }
        lines.push('');
    }

    if (supportComponents.length > 0) {
        lines.push('### 🟡 支撑组件');
        for (const { component } of supportComponents) {
            lines.push(`- **${component.name}**: ${component.description}`);
        }
        lines.push('');
    }

    if (detailComponents.length > 0) {
        lines.push('### 🔵 实现细节');
        for (const { component } of detailComponents) {
            const claimList = component.claims.map(c => c.description).join('; ');
            lines.push(`- **${component.name}**: ${claimList}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
