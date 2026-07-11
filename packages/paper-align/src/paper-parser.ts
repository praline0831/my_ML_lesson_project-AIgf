import { arxivService } from '@agent/paper';
import { LLMClient } from './llm-client.js';
import type { PaperClaim, PaperComponent, ParsedPaper } from './types.js';

const AR5IV_BASE = 'https://ar5iv.labs.arxiv.org/html/';

export interface PaperParserOptions {
    maxChars?: number;
    llm?: LLMClient;
}

export function normalizeArxivId(input: string): string {
    let id = input.trim();
    id = id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '');
    id = id.replace(/^arXiv:/i, '');
    id = id.replace(/\.pdf$/i, '');
    return id;
}

export class PaperParser {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: PaperParserOptions = {}) {
        this.llm = llm;
        this.options = { maxChars: 25000, ...options };
    }

    async parse(arxivIdOrUrl: string): Promise<ParsedPaper> {
        const arxivId = normalizeArxivId(arxivIdOrUrl);
        const baseId = arxivId.replace(/v\d+$/, '');

        const search = await arxivService.search(baseId, 1);
        const meta = search.papers.find(p => p.id.endsWith(baseId)) || search.papers[0];
        if (!meta) {
            throw new Error(`arXiv paper not found: ${arxivId}`);
        }

        const repoUrl = extractRepoUrl(`${meta.abstract}\n${meta.comment ?? ''}`);
        const bodyText = await this.fetchBody(arxivId);

        const components = await this.extractComponents(meta.title, meta.abstract, bodyText);

        return {
            arxivId: baseId,
            title: meta.title,
            authors: meta.authors,
            abstract: meta.abstract,
            repoUrl,
            bodyText,
            components,
        };
    }

    private async fetchBody(arxivId: string): Promise<string> {
        const url = `${AR5IV_BASE}${arxivId}`;
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'paper-align-agent/0.1' },
            });
            if (!resp.ok) {
                console.warn(`[paper-parser] ar5iv returned ${resp.status}, falling back to abstract only`);
                return '';
            }
            const html = await resp.text();
            return htmlToText(html);
        } catch (err) {
            console.warn(`[paper-parser] ar5iv fetch failed: ${(err as Error).message}`);
            return '';
        }
    }

    private async extractComponents(title: string, abstract: string, bodyText: string): Promise<PaperComponent[]> {
        if (!bodyText || bodyText.trim().length < 100) {
            return [{
                name: '(paper body not available)',
                description: 'abstract only — no detailed claims',
                priority: 3,
                location: 'abstract',
                claims: [{
                    description: '(paper body not available, abstract only)',
                    location: 'abstract',
                }],
            }];
        }

        const maxChars = this.options.maxChars ?? 25000;
        const truncated = bodyText.length > maxChars
            ? smartTruncate(bodyText, maxChars)
            : bodyText;

        const components = await this.phase1ExtractComponents(title, abstract, truncated);

        let resultComponents: PaperComponent[];

        if (components.length === 0) {
            console.warn('[paper-parser] Phase 1 returned no components, using fallback');
            const claims = await this.phase2ExtractClaims(title, truncated, undefined);
            resultComponents = [{
                name: '(paper components)',
                description: 'treating whole paper method as one component',
                priority: 3,
                location: 'body',
                claims,
            }];
        } else {
            resultComponents = [];
            for (const comp of components) {
                const claims = await this.phase2ExtractClaims(title, truncated, comp);
                console.log(`[paper-parser] Component "${comp.name}": ${claims.length} claims extracted`);
                resultComponents.push({ ...comp, claims });
            }
        }

        const totalClaims = resultComponents.reduce((s, c) => s + c.claims.length, 0);
        console.log(`[paper-parser] Total: ${resultComponents.length} components, ${totalClaims} claims`);

        return resultComponents;
    }

    private async phase1ExtractComponents(title: string, abstract: string, bodyText: string): Promise<PaperComponent[]> {
        const systemPrompt = `You are analyzing an ML paper. Identify the core technical contributions.

Focus ONLY on what is NEW in this paper — the novel architecture, new formulas, original algorithms, or key design innovations that define this work.

Exclude standard ML practices (Adam optimizer, standard batch norm, ReLU activation, basic cross-entropy loss, etc.) — focus on what makes this paper unique.

## Priority guidelines
- priority=1: Primary contribution — the paper's main idea, directly relates to the title, the core new method
- priority=2: Supporting contribution — key architectural components, important formulas or loss terms
- priority=3: Minor detail — specific parameter choices, implementation notes, training details

Output at most 5 components, minimum 1.

## Output format (strict JSON)
{"components":[
  {"name": "Component Name", "description": "What it does", "priority": 1, "location": "§3.1"}
]}

IMPORTANT: Output an OBJECT with a "components" array, NOT a bare array.`;

        const userPrompt = `Title: ${title}

Abstract: ${abstract}

Paper body (first portion, focusing on method):
"""
${bodyText.slice(0, Math.floor(bodyText.length * 0.45))}
"""

Output JSON with the components that represent this paper's core technical innovations.`;

        interface Phase1Result { components?: { name: string; description: string; priority: 1 | 2 | 3; location: string }[] }
        interface Phase1ArrayResult extends Array<{ name: string; description: string; priority: 1 | 2 | 3; location: string }> {}

        let components: { name: string; description: string; priority: 1 | 2 | 3; location: string }[] = [];

        try {
            const result = await this.llm.chatJson<Phase1Result | Phase1ArrayResult>([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ]);

            if (Array.isArray(result)) {
                components = result;
            } else if (result && Array.isArray((result as Phase1Result).components)) {
                components = (result as Phase1Result).components!;
            }
        } catch (e) {
            console.warn(`[paper-parser] Phase 1 component extraction failed: ${(e as Error).message}`);
            return [];
        }

        return components.map(c => ({
            name: c.name,
            description: c.description,
            priority: c.priority ?? 3,
            location: c.location || 'body',
            claims: [],
        }));
    }

    private async phase2ExtractClaims(title: string, bodyText: string, component?: PaperComponent): Promise<PaperClaim[]> {
        const truncated = bodyText;

        const systemPrompt = `You are an ML paper reproduction expert. Extract technically critical claims that are essential for understanding and reproducing the method.

## What counts as "reproduction-critical"
Concrete technical details that can be found in code: mathematical formulas, algorithm steps, loss functions, training tricks, model architecture, data processing logic.
**Not**: experimental results ("achieved 89.2 on GLUE"), citations, conceptual discussion, motivation, related work.

## Required type labels
- \`formula\`    Mathematical formula or derivation
- \`algorithm\`  Algorithm steps, pseudocode, or procedure
- \`loss\`       Loss function definition
- \`hyperparam\` Key hyperparameters (only if unusual/paper-specific)
- \`training\`   Training strategy
- \`data\`       Data preprocessing, augmentation, or dataset construction
- \`arch\`       Model architecture (layer types, hidden size, activation, normalization)

## Importance (1-3)
- 3 = Core method directly corresponds to main contribution
- 2 = Key technical detail significantly impacts results
- 1 = Optional minor detail

## Extraction rules
1. Each claim must be a single specific point
2. Always provide location (\`§3.2\`, \`Eq.5\`, \`Algorithm 1\`)
3. The quote field must contain exact text with key formula symbols (<= 250 chars)
4. For formulas: preserve variable names as they appear in the paper

## Output format (strict JSON)
{"claims":[
  {"description":"technical claim","type":"formula","importance":3,"location":"§3.2","quote":"exact text"}
]}`;

        const componentContext = component
            ? `Focus on the following paper component:
- Component: ${component.name}
- Description: ${component.description}
- Priority: ${component.priority}/3

Extract 2-4 specific technical claims for THIS component only.`

            : 'Extract 5-10 key claims from the paper as a whole.';

        const userPrompt = `Paper title: ${title}

${componentContext}

Paper body:
"""
${truncated}
"""

Output JSON with "claims" array.`;

        interface Phase2Result { claims?: PaperClaim[] }
        try {
            const result = await this.llm.chatJson<Phase2Result>([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ]);
            const claims = result.claims || [];
            console.log(`[paper-parser] Phase 2 extracted ${claims.length} claims for ${component ? component.name : 'paper'}`);
            return claims.slice(0, 4);
        } catch (e) {
            console.warn(`[paper-parser] Phase 2 claim extraction failed: ${(e as Error).message}`);
            return [];
        }
    }
}

export function extractRepoUrl(text: string): string | undefined {
    const match = text.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
    if (!match) return undefined;
    let url = match[0];
    url = url.replace(/\.git$/, '');
    url = url.replace(/\/$/, '');
    url = url.replace(/[.,;:!?'")\]}>]+$/, '');
    return url;
}

function htmlToText(html: string): string {
    let text = html;
    text = text.replace(/<(script|style|nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<math[^>]*>[\s\S]*?<\/math>/gi, (match) => {
        const annotation = match.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/i);
        if (annotation) return ` {math: ${annotation[1].trim()}} `;
        const tex = match
            .replace(/<mi[^>]*>([\s\S]*?)<\/mi>/gi, '$1')
            .replace(/<mo[^>]*>([\s\S]*?)<\/mo>/gi, '$1')
            .replace(/<mn[^>]*>([\s\S]*?)<\/mn>/gi, '$1')
            .replace(/<msub[^>]*>([\s\S]*?)<\/msub>/gi, '$1_')
            .replace(/<msup[^>]*>([\s\S]*?)<\/msup>/gi, '$1^')
            .replace(/<mfrac[^>]*>([\s\S]*?)<\/mfrac>/gi, '($1)')
            .replace(/<mrow[^>]*>([\s\S]*?)<\/mrow>/gi, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (tex) return ` {math: ${tex}} `;
        return ' {math} ';
    });
    text = text.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, (match) => {
        const code = match
            .replace(/<code[^>]*>/gi, '')
            .replace(/<\/code>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
        return `\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`;
    });
    text = text.replace(/<(h[1-6])[^>]*>/gi, '\n\n### ');
    text = text.replace(/<\/(h[1-6])>/gi, '\n\n');
    text = text.replace(/<\/(p|div|li|blockquote)>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<li[^>]*>/gi, '- ');
    text = text.replace(/<dt[^>]*>/gi, '\n**');
    text = text.replace(/<\/dt>/gi, '** ');
    text = text.replace(/<dd[^>]*>/gi, ': ');
    text = text.replace(/<\/dd>/gi, '\n');
    text = text.replace(/<table[^>]*>/gi, '\n\n');
    text = text.replace(/<\/table>/gi, '\n\n');
    text = text.replace(/<tr[^>]*>/gi, '\n| ');
    text = text.replace(/<\/tr>/gi, ' |');
    text = text.replace(/<t[dh][^>]*>/gi, '');
    text = text.replace(/<\/t[dh]>/gi, ' | ');
    text = text.replace(/<[^>]+>/g, '');
    text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&times;/g, '×')
        .replace(/&minus;/g, '−')
        .replace(/&infty;/g, '∞')
        .replace(/&alpha;/g, 'α')
        .replace(/&beta;/g, 'β')
        .replace(/&theta;/g, 'θ')
        .replace(/&mu;/g, 'μ')
        .replace(/&sigma;/g, 'σ')
        .replace(/&phi;/g, 'φ')
        .replace(/&nabla;/g, '∇')
        .replace(/&part;/g, '∂');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{4,}/g, '\n\n');
    return text.trim();
}

function smartTruncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const len = text.length;
    const headChars = Math.floor(maxChars * 0.35);
    const midChars = Math.floor(maxChars * 0.40);
    const tailChars = maxChars - headChars - midChars;
    const head = text.slice(0, headChars);
    const midStart = Math.floor(len * 0.20);
    const mid = text.slice(midStart, midStart + midChars);
    const tail = text.slice(len - tailChars);
    return head +
        '\n\n[... TRUNCATED: middle & end sections compressed ...]\n\n' +
        mid +
        '\n\n[... TRUNCATED: end sections compressed ...]\n\n' +
        tail;
}
