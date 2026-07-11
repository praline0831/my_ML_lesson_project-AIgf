import { LLMClient } from './llm-client.js';
import type { AlignmentRow, CodeFunction, EvidenceSpan, PaperClaim, PaperComponent } from './types.js';

export interface AlignerOptions {
    batchSize?: number;
    llm?: LLMClient;
}

function getBodyPreview(fn: CodeFunction, maxChars: number = 2500): string {
    if (fn.body.length <= maxChars) return fn.body;
    // keep head (signature + setup) and tail (computation + return), skip middle boilerplate
    const head = Math.floor(maxChars * 0.6);
    const tail = maxChars - head;
    return fn.body.slice(0, head) + '\n    # ... (truncated) ...\n' + fn.body.slice(-tail);
}

function makeFnDescription(fn: CodeFunction): string {
    const preview = getBodyPreview(fn, 2500);
    return `[FILE] ${fn.file}
[FUNC] ${fn.name} (L${fn.startLine}-${fn.endLine})
[SIG] ${fn.signature}
[BODY]
${preview}
[END]`;
}

function extractClaimKeywords(claim: PaperClaim): string[] {
    const text = `${claim.description} ${claim.quote || ''} ${claim.location}`.toLowerCase();
    const words = text.split(/[\s,;:()\[\]{}=+\-*/\\'"`<>!?|.…、，。；：（）【】"「」『』《》]+/);
    const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'this', 'that', 'these',
        'those', 'with', 'from', 'for', 'over', 'under', 'between', 'through',
        'during', 'before', 'after', 'above', 'below', 'up', 'down', 'in', 'out',
        'on', 'off', 'of', 'to', 'by', 'at', 'and', 'or', 'not', 'no', 'but',
        'each', 'every', 'all', 'both', 'few', 'more', 'most', 'other', 'some',
        'such', 'than', 'then', 'also', 'very', 'just', 'about', 'into', 'upon',
        'via', 'per', 'its', 'their', 'our', 'your', 'his', 'her', 'use', 'used',
        'using', 'based', 'shown', 'method', 'approach', 'propose', 'proposed',
        'new', 'novel', 'paper', 'section', 'figure', 'table', 'equation', 'eq']);
    return words.filter(w => w.length >= 3 && !/^\d+$/.test(w) && !stopwords.has(w));
}

function retrieveRelevant(claim: PaperClaim, functions: CodeFunction[], topK: number = 5): CodeFunction[] {
    const keywords = extractClaimKeywords(claim);
    if (keywords.length === 0) return functions.slice(0, topK);

    const scored = functions.map(fn => {
        let score = 0;
        const name = `${fn.file}::${fn.name}`.toLowerCase();
        const sig = fn.signature.toLowerCase();
        const body = fn.body.toLowerCase();

        for (const kw of keywords) {
            if (name.includes(kw)) score += 10;
            else if (sig.includes(kw)) score += 6;
            else if (body.includes(kw)) score += 3;
        }

        if (fn.name === 'forward') score += 2;
        if (fn.name === '__init__') score += 1;

        return { fn, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);
    return top.map(s => s.fn);
}

function shortSummary(fn: CodeFunction): string {
    const preview = getBodyPreview(fn, 400);
    return `[${fn.file}::${fn.name}](L${fn.startLine}-${fn.endLine}) ${fn.signature.replace(/\s+/g, ' ').slice(0, 120)}\n| ${preview.slice(0, 300).replace(/\n/g, '\\n')}`;
}

export class Aligner {
    private llm: LLMClient;

    constructor(llm: LLMClient, _options: AlignerOptions = {}) {
        this.llm = llm;
    }

    async alignByComponents(
        components: PaperComponent[],
        functions: CodeFunction[],
        paperTitle?: string
    ): Promise<AlignmentRow[]> {
        // Pass 1: retrieval-based per-claim matching with full body context
        const rows: AlignmentRow[] = [];
        const missingClaims: { comp: PaperComponent; claim: PaperClaim }[] = [];

        for (const comp of components) {
            for (const claim of comp.claims) {
                const relevant = retrieveRelevant(claim, functions, 5);

                if (relevant.length === 0) {
                    missingClaims.push({ comp, claim });
                    continue;
                }

                const fnTexts = relevant.map(fn => makeFnDescription(fn)).join('\n\n');

                const systemPrompt = `You are matching a paper claim to the most relevant code function. Match by operations in the FUNCTION BODY, not just function names.

## How to match
- "attention" → look for matmul + softmax + scaling
- "QKV" → look for 3 linear projections (query, key, value)
- "LoRA" → look for low-rank decomposition (A @ B)
- "pooling" → look for reduce operations (mean, max, avg)
- "upsampling" → look for interpolate, resize, nearest
- "normalization" → look for norm, layer_norm, batch_norm
- "loss" → look for loss function computation

## Output JSON
{"functionIndex": 2, "status": "match", "note": "short explanation", "confidence": 0.9, "evidence": "key code snippet", "evidenceLine": 15}

- functionIndex: index of best matching function (0-based, or null if none)
- status: "match" | "partial" | "missing"
- evidence: key variable/operation that supports the match (<=120 chars)
- evidenceLine: 1-based line within the function (1 = first line)`;

                const userPrompt = `Paper: ${paperTitle || '(unknown)'}
Claim: ${claim.description}
${claim.quote ? `Quote: "${claim.quote}"` : ''}
Location: ${claim.location}

Candidate functions (${relevant.length}):
${fnTexts}

Output JSON with best matching function.`;

                interface SingleResult {
                    functionIndex: number | null;
                    status: 'match' | 'partial' | 'mismatch' | 'missing';
                    note: string;
                    confidence: number;
                    evidence?: string;
                    evidenceLine?: number;
                }

                try {
                    const result = await this.llm.chatJson<SingleResult>([
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ]);

                    const idx = result.functionIndex != null && result.functionIndex >= 0 && result.functionIndex < relevant.length
                        ? result.functionIndex : null;
                    const matchedFn = idx != null ? relevant[idx] : undefined;
                    const evidenceLine = matchedFn && result.evidenceLine != null
                        ? matchedFn.startLine + result.evidenceLine - 1
                        : undefined;

                    const row: AlignmentRow = {
                        claim, componentName: comp.name,
                        matchedFunction: matchedFn,
                        matchedFunctions: matchedFn ? [matchedFn] : undefined,
                        status: result.status || 'missing',
                        note: result.note || '',
                        confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0,
                        evidence: result.evidence,
                        evidenceLine,
                    };

                    if (matchedFn && (result.status === 'match' || result.status === 'partial')) {
                        const spans = await this.formulaAlign(claim, [matchedFn]);
                        if (spans.length > 0) {
                            row.evidenceSpans = spans;
                            row.evidence = spans[0].codeSnippet.slice(0, 120);
                            row.evidenceLine = spans[0].startLine;
                        }
                    }

                    rows.push(row);
                    if (result.status === 'missing' || result.status === 'mismatch') {
                        missingClaims.push({ comp, claim });
                    }
                } catch (e) {
                    console.warn(`[aligner] claim failed: ${(e as Error).message}`);
                    missingClaims.push({ comp, claim });
                }
            }
        }

        // Pass 2: flat batch fallback for claims that are still missing
        if (missingClaims.length > 0 && functions.length > 0) {
            console.log(`[aligner] fallback: trying flat alignment for ${missingClaims.length} missing claims`);
            const fallbackRows = await this.flatFallback(missingClaims, functions, paperTitle);

            for (const fbRow of fallbackRows) {
                const existing = rows.find(r => r.claim === fbRow.claim);
                if (existing && (existing.status === 'missing' || existing.status === 'mismatch')) {
                    Object.assign(existing, fbRow);
                }
            }
        }

        return rows;
    }

    private async flatFallback(
        missingClaims: { comp: PaperComponent; claim: PaperClaim }[],
        functions: CodeFunction[],
        paperTitle?: string
    ): Promise<AlignmentRow[]> {
        const results: AlignmentRow[] = [];
        const batchSize = 5;

        for (let i = 0; i < missingClaims.length; i += batchSize) {
            const batch = missingClaims.slice(i, i + batchSize);
            const claimLines = batch.map(({ claim }, j) => {
                const imp = claim.importance ? ` [imp=${claim.importance}]` : '';
                return `[${j}]${imp} ${claim.description} (${claim.location})`;
            }).join('\n');

            const fnLines = functions.map((f, j) => `[${j}] ${shortSummary(f)}`).join('\n');

            const systemPrompt = `You are an ML paper-code alignment expert. For each claim, find the best-matching function from the list.

Each function entry: [ID] file::name(Lstart-Lend) | signature | body preview

## Rules
- Match by function name, file name, AND operations in the body preview
- A function may implement the claim even if names differ — look at what it computes
- If a function clearly implements the claim → set functionIndex, status "match"
- If the core idea is present but details differ → status "partial"
- If no function matches → set functionIndex null, status "missing"
- Be concise in note (<=50 chars)

## Output JSON
{"alignments":[
  {"claimIndex":0,"functionIndex":3,"status":"match","note":"QKV attention projection","confidence":0.9,"evidence":"q, k, v linear projections","evidenceLine":15},
  {"claimIndex":1,"functionIndex":null,"status":"missing","note":"no match found","confidence":0.2}
]}`;

            const userPrompt = `Paper: ${paperTitle || '(unknown)'}

Claims (${batch.length}):
${claimLines}

Function List (${functions.length} total):
${fnLines}

Output JSON with alignments.`;

            interface FlatResult {
                alignments: {
                    claimIndex: number; functionIndex: number | null;
                    status: 'match' | 'partial' | 'mismatch' | 'missing';
                    note: string; confidence: number;
                    evidence?: string; evidenceLine?: number;
                }[];
            }

            try {
                const result = await this.llm.chatJson<FlatResult>([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ]);

                for (const a of (result.alignments || [])) {
                    const item = batch[a.claimIndex];
                    if (!item) continue;
                    const idx = a.functionIndex != null && a.functionIndex >= 0 && a.functionIndex < functions.length
                        ? a.functionIndex : null;
                    const matchedFn = idx != null ? functions[idx] : undefined;
                    results.push({
                        claim: item.claim,
                        componentName: item.comp.name,
                        matchedFunction: matchedFn,
                        status: a.status || 'missing',
                        note: a.note || '',
                        confidence: typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : 0,
                        evidence: a.evidence,
                        evidenceLine: matchedFn && a.evidenceLine != null
                            ? matchedFn.startLine + a.evidenceLine - 1 : undefined,
                    });
                }
            } catch (e) {
                console.warn(`[aligner] flat fallback batch failed: ${(e as Error).message}`);
                for (const item of batch) {
                    results.push({
                        claim: item.claim, componentName: item.comp.name,
                        status: 'missing', note: 'fallback failed', confidence: 0,
                    });
                }
            }
        }

        return results;
    }

    async formulaAlign(claim: PaperClaim, matchedFunctions: CodeFunction[]): Promise<EvidenceSpan[]> {
        if (matchedFunctions.length === 0) return [];

        const funcsText = matchedFunctions.map((f, i) =>
            `--- Function ${i + 1}: ${f.file} :: ${f.name} (L${f.startLine}-${f.endLine}) ---
${f.body}
---`).join('\n\n');

        const systemPrompt = `Given a paper claim and its matching code function, find the EXACT lines where the formula is implemented.

## Output format
{"spans":[
  {"startLine":45,"endLine":48,"codeSnippet":"result = F.linear(x, self.weight)\\n...","formulaContext":"W₀x + BAx","variableMappings":[
    {"formulaVar":"W₀","codeVar":"self.weight","context":"base weight"}
  ]}
]}

- startLine: 1-based line number in the function (1 = first line)
- endLine: last line of the code block
- codeSnippet: the actual code lines (2-15 lines)
- formulaContext: which part of the formula this implements
- variableMappings: map paper variables to code variables`;

        const userPrompt = `Paper claim: ${claim.description}
${claim.quote ? `Formula: ${claim.quote}` : ''}

Code function:
${funcsText}

Find the exact lines implementing this formula. Output evidence spans.`;

        interface FormulaResult {
            spans: {
                startLine: number;
                endLine: number;
                codeSnippet: string;
                formulaContext?: string;
                variableMappings?: { formulaVar: string; codeVar: string; context: string }[];
            }[];
        }

        try {
            const result = await this.llm.chatJson<FormulaResult>([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ]);

            return (result.spans || []).map(s => ({
                startLine: s.startLine,
                endLine: s.endLine,
                codeSnippet: s.codeSnippet,
                formulaContext: s.formulaContext,
                variableMappings: (s.variableMappings || []).map(m => ({
                    formulaVar: m.formulaVar,
                    codeVar: m.codeVar,
                    context: m.context || '',
                })),
            }));
        } catch {
            return [];
        }
    }
}
