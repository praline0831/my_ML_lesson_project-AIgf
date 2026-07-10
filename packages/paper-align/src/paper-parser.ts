import { arxivService } from '@agent/paper';
import { LLMClient } from './llm-client.js';
import type { PaperClaim, ParsedPaper } from './types.js';

const AR5IV_BASE = 'https://ar5iv.labs.arxiv.org/html/';

export interface PaperParserOptions {
    claimCount?: number;
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
        this.options = { claimCount: 15, maxChars: 15000, ...options };
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
        const claims = await this.extractClaims(meta.title, bodyText);

        return {
            arxivId: baseId,
            title: meta.title,
            authors: meta.authors,
            abstract: meta.abstract,
            repoUrl,
            bodyText,
            claims,
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

    private async extractClaims(title: string, bodyText: string): Promise<PaperClaim[]> {
        const maxChars = this.options.maxChars ?? 15000;
        const truncated = bodyText.length > maxChars
            ? smartTruncate(bodyText, maxChars)
            : bodyText;

        if (!truncated || truncated.trim().length < 100) {
            return [{
                description: '(paper body not available, abstract only)',
                location: 'abstract',
            }];
        }

        const systemPrompt = `You are an ML paper reproduction expert. Extract technically critical claims from the paper body that are essential for reproducing the method.

## What counts as "reproduction-critical"
Concrete technical details that can be found in code: mathematical formulas, algorithm steps, loss functions, training tricks, model architecture, data processing logic.
**Not**: experimental results ("achieved 89.2 on GLUE"), citations, conceptual discussion, motivation, related work.

## Required type labels
- \`formula\`    Mathematical formula or derivation (e.g., LoRA: W + ΔW = W + BA)
- \`algorithm\`  Algorithm steps, pseudocode, or procedure
- \`loss\`       Loss function definition (cross-entropy, contrastive loss, etc.)
- \`hyperparam\` Key hyperparameters (learning rate, batch size, rank r, warmup steps, optimizer betas)
- \`training\`   Training strategy (optimizer choice, gradient clipping, EMA, mixed precision, scheduling)
- \`data\`       Data preprocessing, augmentation, or dataset construction
- \`arch\`       Model architecture (layer types, hidden size, activation, normalization, dropout)

## Importance (1-3)
- 3 = Core method — directly corresponds to paper title or main contribution
- 2 = Key technical detail — significantly impacts reproduction results
- 1 = Optional detail — "can also use X instead" or minor variant

## Extraction rules
1. Each claim must be a single specific point — do not merge multiple items into one claim
2. Always provide location (\`§3.2\`, \`Eq.5\`, \`Table 1\`, \`Algorithm 1\`, \`§4.1\`) for cross-referencing
3. The quote field must contain the exact text with key formula symbols or terms (<= 250 chars) for later code search
4. Extract at least 5 claims, maximum \`${this.options.claimCount}\` claims — prefer more over fewer
5. Priority: formula > loss > algorithm > training > arch > data > hyperparam
6. For formulas: preserve variable names as they appear in the paper (e.g., W_q, h, z_t, α)
7. For hyperparameters: always include the exact numeric value and unit where given

## Output format (strict JSON array)
{
  "claims": [
    {
      "description": "One-sentence technical description in English",
      "type": "formula|loss|algorithm|hyperparam|training|data|arch",
      "importance": 1|2|3,
      "location": "§3.2 / Eq.5 / Table 1 / Algorithm 1",
      "quote": "Exact excerpt with key formula or term"
    }
  ]
}`;

        const userPrompt = `Paper title: ${title}

Paper body:
"""
${truncated}
"""

Extract ${this.options.claimCount} technically critical claims as JSON.`;

        interface ExtractResult {
            claims: PaperClaim[];
        }

        const result = await this.llm.chatJson<ExtractResult>([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ]);

        return result.claims || [];
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
    const headEnd = Math.floor(maxChars * 0.6);
    const tailStart = text.length - Math.floor(maxChars * 0.35);
    return text.slice(0, headEnd) +
        '\n\n[... TRUNCATED: middle ' + (tailStart - headEnd) + ' chars omitted ...]\n\n' +
        text.slice(tailStart);
}
