import { LLMClient } from './llm-client.js';
import type { AlignmentRow, CodeFunction, PaperClaim } from './types.js';

export interface AlignerOptions {
    batchSize?: number;
    llm?: LLMClient;
}

interface AlignedItem {
    claimIndex: number;
    functionIndex: number | null;
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    note: string;
    confidence: number;
    reasoning?: string;
    evidence?: string;
    evidenceLine?: number;
}

interface AlignResult {
    alignments: {
        claimIndex: number;
        functionIndex: number | null;
        status: 'match' | 'partial' | 'mismatch' | 'missing';
        note: string;
        confidence: number;
        reasoning?: string;
        evidence?: string;
        evidenceLine?: number;
    }[];
}

function summarizeFunction(fn: CodeFunction): string {
    const docstring = fn.body.match(/"""(.*?)"""/s) || fn.body.match(/'''(.*?)'''/s);
    let desc = '';
    if (docstring) {
        const first = docstring[1].split('\n').map(l => l.trim()).filter(Boolean)[0];
        if (first) desc = first.slice(0, 100);
    }
    if (!desc) {
        desc = fn.signature.replace(/\s+/g, ' ').slice(0, 100);
    }
    return `${fn.file} :: ${fn.name}(L${fn.startLine}-${fn.endLine}) | ${desc}`;
}

export class Aligner {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: AlignerOptions = {}) {
        this.llm = llm;
        this.options = { batchSize: 6, ...options };
    }

    async align(claims: PaperClaim[], functions: CodeFunction[], paperTitle?: string): Promise<AlignmentRow[]> {
        if (claims.length === 0) return [];
        if (functions.length === 0) {
            return claims.map(c => ({
                claim: c, status: 'missing' as const,
                note: 'no Python functions found', confidence: 1.0,
            }));
        }

        const results: AlignmentRow[] = [];
        for (let i = 0; i < claims.length; i += this.options.batchSize!) {
            const batch = claims.slice(i, i + this.options.batchSize!);
            const batchResults = await this.alignBatch(batch, functions, paperTitle);
            for (let j = 0; j < batch.length; j++) {
                const claim = batch[j];
                const aligned = batchResults.alignments.find(a => a.claimIndex === j);
                if (!aligned) {
                    results.push({ claim, status: 'missing', note: 'alignment failed', confidence: 0 });
                    continue;
                }
                const fn = aligned.functionIndex != null ? functions[aligned.functionIndex] : undefined;
                const evidenceLine = (fn && aligned.evidenceLine != null)
                    ? fn.startLine + aligned.evidenceLine - 1
                    : undefined;
                results.push({
                    claim,
                    matchedFunction: fn,
                    status: aligned.status,
                    note: aligned.note,
                    confidence: aligned.confidence,
                    reasoning: aligned.reasoning,
                    evidence: aligned.evidence,
                    evidenceLine,
                });
            }
        }
        return results;
    }

    private async alignBatch(claims: PaperClaim[], functions: CodeFunction[], paperTitle?: string): Promise<{ alignments: AlignedItem[] }> {
        if (functions.length === 0) {
            return {
                alignments: claims.map((_, i) => ({
                    claimIndex: i, functionIndex: null,
                    status: 'missing' as const, note: 'no functions', confidence: 0,
                    reasoning: '', evidence: undefined, evidenceLine: undefined,
                })),
            };
        }

        const claimLines = claims.map((c, i) => {
            const importance = c.importance ? ` [imp=${c.importance}]` : '';
            return `[CLAIM ${i}]${importance} ${c.description} (${c.location}${c.quote ? `, "${c.quote.slice(0, 120)}"` : ''})`;
        }).join('\n');

        const fnSummaries = functions.map((f, i) => `[${i}] ${summarizeFunction(f)}`).join('\n');

        const systemPrompt = `You are an ML paper-code alignment expert. For each CLAIM, find the single best-matching function from the FUNCTION LIST and judge the alignment.

Each function entry: [ID] file :: name(Lstart-Lend) | brief description

## Rules
- Match based on function name, file name, and description against the claim
- If a function clearly implements the claim's logic → set functionIndex, status "match"
- If the core idea is present but details differ → status "partial"
- If function exists but does something different → status "mismatch"
- If no function matches → set functionIndex null, status "missing"
- evidence: key variables/API calls in the function that support the match (<=100 chars)
- evidenceLine: 1-based line roughly where evidence appears (1 = first line of function)
- importance 3 claims are core — be strict about exact match
- Be concise in note (<=50 chars)

## Output JSON
{"alignments":[
  {"claimIndex":0,"functionIndex":3,"status":"match","note":"QKV attention with RoPE","confidence":0.95,"reasoning":"Found q_proj/k_proj/v_proj and rotary embedding in function body","evidence":"q @ k.T / sqrt(d_k) * scale","evidenceLine":15},
  {"claimIndex":1,"functionIndex":null,"status":"missing","note":"no optimizer code found","confidence":0.2,"reasoning":"Function list contains only model architecture, no training code"}
]}`;

        const raw = await this.llm.chatJson<AlignResult>([
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: `Paper: ${paperTitle || '(unknown)'}

Claims (${claims.length}):
${claimLines}

Function List (${functions.length} total):
${fnSummaries}

Output JSON.`,
            },
        ]);

        return {
            alignments: (raw.alignments || []).map(a => ({
                claimIndex: a.claimIndex,
                functionIndex: a.functionIndex != null && a.functionIndex >= 0 && a.functionIndex < functions.length
                    ? a.functionIndex : null,
                status: a.status || 'missing',
                note: a.note || '',
                confidence: typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : 0,
                reasoning: a.reasoning || '',
                evidence: a.evidence,
                evidenceLine: a.evidenceLine,
            })),
        };
    }
}
