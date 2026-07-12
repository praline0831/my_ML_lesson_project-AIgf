import { LLMClient } from './llm-client.js';
import type { AlignmentRow, CodeFunction, EvidenceSpan, PaperClaim, PaperComponent } from './types.js';

export interface AlignerOptions {
    batchSize?: number;
    llm?: LLMClient;
}

/* ─── Claim 角色检测 ─── */

type ClaimRole = 'architecture' | 'training' | 'inference';

function detectClaimRole(claim: PaperClaim): ClaimRole {
    const text = `${claim.description} ${claim.quote || ''}`.toLowerCase();
    let train = 0, infer = 0;
    if (/loss|training|optimization|weight.*updat|gradient|optimizer|l1|l2|mse|backward/.test(text)) train++;
    if (/sample|reverse|denoise|inference|predict|generate|scheduler|step.*timestep/.test(text)) infer++;
    if (train > infer && train > 0) return 'training';
    if (infer > train && infer > 0) return 'inference';
    return 'architecture';
}

/* ─── 元数据提取 ─── */

function extractDocstring(body: string): string {
    const lines = body.split('\n');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const t = lines[i].trim();
        if ((t.startsWith('"""') || t.startsWith("'''"))) {
            const docLines: string[] = [];
            let inDoc = true;
            const rest = t.slice(3).trim();
            if (rest.endsWith('"""') || rest.endsWith("'''")) { docLines.push(rest.slice(0, -3).trim()); inDoc = false; }
            else if (rest) docLines.push(rest);
            for (let j = i + 1; j < lines.length && inDoc; j++) {
                const l = lines[j].trim();
                if (l.endsWith('"""') || l.endsWith("'''")) { docLines.push(l.slice(0, -3).trim()); break; }
                docLines.push(l);
            }
            if (docLines.length) return docLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        }
    }
    const comments: string[] = [];
    for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('#')) comments.push(t.replace(/^#\s*/, ''));
        else if (comments.length > 0 && t === '') continue;
        else if (comments.length > 0) break;
    }
    return comments.join('\n');
}

function extractTrainableParams(body: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = /self\.(\w+)\s*=\s*nn\.Parameter\(/g.exec(body)) !== null) { if (!seen.has(m[1])) { seen.add(m[1]); out.push(`${m[1]}(Parameter)`); } }
    while ((m = /self\.(\w+)\s*=\s*nn\.(\w+)\(/g.exec(body)) !== null) { if (!seen.has(m[1])) { seen.add(m[1]); out.push(`${m[1]}(${m[2]})`); } }
    return out;
}

function extractTorchOps(body: string): string[] {
    const ops = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = /(?:torch|F)\.(\w+)/g.exec(body)) !== null) ops.add(m[1]);
    while ((m = /nn\.(\w+)/g.exec(body)) !== null) ops.add(`nn.${m[1]}`);
    return [...ops];
}

function extractTokens(text: string): string[] {
    return text.toLowerCase().split(/[\s,;:()\[\]{}=+\-*/\\'"`<>!?|.…、，。；：（）【】"「」『』《》]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
}

function extractMathOps(text: string): string[] {
    const ops: string[] = [];
    const patterns = ['sqrt', 'matmul', 'softmax', 'sigmoid', 'tanh', 'relu', 'gelu', 'mean', 'sum', 'abs', 'log', 'exp', 'sin', 'cos', 'norm', 'cat', 'stack', 'split', 'chunk', 'gather', 'scatter', 'einsum', 'meshgrid', 'where', 'clamp', 'reshape', 'view', 'transpose', 'permute', 'flatten', 'unsqueeze', 'squeeze', 'pad', 'conv', 'pool', 'dropout', 'batch_norm', 'layer_norm', 'linear', 'embedding', 'cross_entropy', 'mse_loss', 'l1_loss', 'bce_loss', 'nll_loss', 'kl_div'];
    for (const p of patterns) { if (text.includes(p)) ops.push(p); }
    return ops;
}

/* ─── 调用链解析：找 self.xxx 引用的外部模块 ─── */

function resolveCallees(body: string, allFunctions: CodeFunction[]): CodeFunction[] {
    const refs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = /self\.(\w+)/g.exec(body)) !== null) refs.add(m[1]);

    const found: CodeFunction[] = [];
    for (const ref of refs) {
        for (const fn of allFunctions) {
            if (fn.name === ref || fn.name.endsWith('.' + ref)) {
                found.push(fn);
                break;
            }
        }
    }
    return found;
}

/* ─── 检索 & 展开 ─── */

function retrieveRelevant(claim: PaperClaim, functions: CodeFunction[], role: ClaimRole, topK: number = 10): CodeFunction[] {
    const tokens = extractTokens(`${claim.description} ${claim.quote || ''} ${claim.location}`);
    if (tokens.length === 0) return functions.slice(0, topK);

    const scored = functions.map(fn => {
        const sig = `${fn.file}::${fn.name} ${fn.signature}`.toLowerCase();
        const body = fn.body.toLowerCase();
        let score = tokens.filter(t => sig.includes(t)).length;
        score += tokens.filter(t => body.includes(t)).length * 0.2;
        score += extractTorchOps(fn.body).length * 0.1;

        // 角色路由
        if (role === 'training' && /_step|_loss|configure_optim/i.test(fn.name)) score += 15;
        if (role === 'inference' && /sample|predict|generate|_step|no_grad/i.test(fn.name)) score += 15;
        if (role === 'architecture' && /forward|__init__|build/i.test(fn.name)) score += 5;

        return { fn, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.fn);
}

function expandWithClass(candidates: CodeFunction[], allFunctions: CodeFunction[]): CodeFunction[] {
    const map = new Map<string, CodeFunction>();
    const add = (fn: CodeFunction) => map.set(`${fn.file}::${fn.name}`, fn);

    for (const fn of candidates) {
        add(fn);
        const dot = fn.name.lastIndexOf('.');
        if (dot > 0) {
            const parentName = fn.name.slice(0, dot);
            const parent = allFunctions.find(f => f.name === parentName && f.file === fn.file);
            if (parent) add(parent);
        } else {
            for (const f of allFunctions) {
                if (f.file === fn.file && f.name.startsWith(fn.name + '.')) add(f);
            }
        }
        // 包装器展开：只有 0 算子函数才解析 self.xxx 调用
        if (extractTorchOps(fn.body).length === 0) {
            for (const callee of resolveCallees(fn.body, allFunctions)) add(callee);
        }
    }
    return [...map.values()];
}

/* ─── 分组 & 算子密集渲染 ─── */

function groupByClass(fns: CodeFunction[]): { cls: CodeFunction; methods: CodeFunction[] }[] {
    const groups: { cls: CodeFunction; methods: CodeFunction[] }[] = [];
    const standalone: CodeFunction[] = [];

    for (const fn of fns) {
        if (fn.name.lastIndexOf('.') > 0) { standalone.push(fn); }
        else { groups.push({ cls: fn, methods: [] }); }
    }

    const orphans: CodeFunction[] = [];
    for (const sa of standalone) {
        const dot = sa.name.lastIndexOf('.');
        const parentName = sa.name.slice(0, dot);
        const parent = groups.find(c => c.cls.name === parentName && c.cls.file === sa.file);
        (parent ? parent.methods : orphans).push(sa);
    }
    for (const o of orphans) groups.push({ cls: o, methods: [] });
    return groups;
}

/** 算子密集行渲染：只展示包含 torch/F/nn 调用的行（含行号） */
function renderFnDense(fn: CodeFunction, indent: string, isClass: boolean): string {
    const doc = extractDocstring(fn.body);
    const lines = fn.body.split('\n');
    const torchLines: { n: number; text: string }[] = [];

    if (!isClass) {
        for (let i = 0; i < lines.length; i++) {
            if (/(?:torch|F|nn)\./.test(lines[i]) || /return\s/.test(lines[i]) || /loss|optim|backward|step\(\)/.test(lines[i])) {
                torchLines.push({ n: i + 1, text: lines[i] });
            }
        }
    }

    let s = `${indent}${fn.name}`;
    if (doc) s += ` — "${doc.slice(0, 100).replace(/\n/g, ' ')}"`;

    const params = extractTrainableParams(fn.body);
    if (isClass && params.length) s += ` | params: ${params.join(', ')}`;

    const ops = extractTorchOps(fn.body);
    if (ops.length) s += ` | torch: ${ops.slice(0, 10).join(', ')}`;

    s += `\n${indent}  sig: ${fn.signature.slice(0, 140).replace(/\n/g, ' ')}`;

    if (isClass) {
        if (doc) s += `\n${indent}  doc: ${doc.slice(0, 250).replace(/\n/g, `\n${indent}  `)}`;
    } else if (torchLines.length > 0) {
        const show = torchLines.slice(0, 8);
        for (const l of show) {
            s += `\n${indent}  L${l.n}: ${l.text.trim()}`;
        }
        if (torchLines.length > 20) s += `\n${indent}  ... (${torchLines.length - 20} more op lines)`;
    } else {
        // 0 算子 → 包装器，显示 note
        const head = lines.slice(0, Math.min(5, lines.length)).join(`\n${indent}  `);
        s += `\n${indent}  (no torch ops — wrapper/container)`;
        s += `\n${indent}  ${head}`;
    }
    return s;
}

function renderGrouped(groups: { cls: CodeFunction; methods: CodeFunction[] }[]): { text: string; lookup: CodeFunction[] } {
    const parts: string[] = [];
    const lookup: CodeFunction[] = [];

    for (const g of groups) {
        const isOrphan = g.methods.length === 0;
        lookup.push(g.cls);
        parts.push(renderFnDense(g.cls, '', !isOrphan));
        for (const m of g.methods) {
            lookup.push(m);
            parts.push(renderFnDense(m, '  ', false));
        }
        parts.push('');
    }
    return { text: parts.join('\n'), lookup };
}

/* ─── 算子锚点证据提取 ─── */

function buildEvidenceSpan(fn: CodeFunction, claim: PaperClaim): EvidenceSpan | null {
    const bodyLines = fn.body.split('\n');
    const mathOps = extractMathOps(`${claim.description} ${claim.quote || ''}`);

    if (mathOps.length === 0) {
        // 没有数学算子 → 返回 torch 密集行
        const opLines = bodyLines.map((l, i) => ({ n: i, has: /(?:torch|F|nn)\./.test(l) })).filter(x => x.has);
        if (opLines.length > 0) {
            const first = Math.max(0, opLines[0].n - 2);
            const last = Math.min(bodyLines.length - 1, opLines[opLines.length - 1].n + 2);
            return {
                startLine: fn.startLine + first,
                endLine: fn.startLine + last,
                codeSnippet: bodyLines.slice(first, last + 1).join('\n'),
            };
        }
        return { startLine: fn.startLine, endLine: fn.endLine, codeSnippet: bodyLines.slice(0, 10).join('\n') };
    }

    // 找包含 mathOps 的行
    const matchLines: number[] = [];
    for (let i = 0; i < bodyLines.length; i++) {
        const lc = bodyLines[i].toLowerCase();
        if (mathOps.some(op => lc.includes(op))) matchLines.push(i);
    }

    if (matchLines.length === 0) {
        // 回退：返回 torch 密集行
        const opLines = bodyLines.map((l, i) => ({ n: i, has: /(?:torch|F|nn)\./.test(l) })).filter(x => x.has);
        if (opLines.length > 0) {
            const first = Math.max(0, opLines[0].n - 2);
            const last = Math.min(bodyLines.length - 1, opLines[opLines.length - 1].n + 2);
            return {
                startLine: fn.startLine + first,
                endLine: fn.startLine + last,
                codeSnippet: bodyLines.slice(first, last + 1).join('\n'),
            };
        }
        return { startLine: fn.startLine, endLine: fn.endLine, codeSnippet: bodyLines.slice(0, 10).join('\n') };
    }

    const first = Math.max(0, matchLines[0] - 3);
    const last = Math.min(bodyLines.length - 1, matchLines[matchLines.length - 1] + 3);
    return {
        startLine: fn.startLine + first,
        endLine: fn.startLine + last,
        codeSnippet: bodyLines.slice(first, last + 1).join('\n'),
    };
}

/* ─── 主逻辑 ─── */

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
        const rows: AlignmentRow[] = [];

        for (const comp of components) {
            for (const claim of comp.claims) {
                const role = detectClaimRole(claim);
                const candidates = retrieveRelevant(claim, functions, role, 5);
                if (candidates.length === 0) {
                    rows.push({ claim, componentName: comp.name, status: 'mismatch', note: 'no candidates', confidence: 0 });
                    continue;
                }

                const expanded = expandWithClass(candidates, functions);
                const groups = groupByClass(expanded);
                const { text: rendered, lookup } = renderGrouped(groups);

                const systemPrompt = `You are a COMPILER matching paper formulas to PyTorch operators, not a search engine.

## Rules
- Do NOT match by class/function name. "attention" in the name means NOTHING.
- Do NOT match by docstring. Only match by actual torch operations.
- You MUST find the EXACT torch.* / F.* / nn.* calls.
- Prefer "mismatch" over fake match.

Each entry shows:
  ClassName | params: trainable components | torch: ops found
  MethodName | torch: ops found
    L42:  actual torch call in code

"(no torch ops)" means the function delegates to other objects (self.xxx). Skip it.

## How to match
  "Q = XW_q" → torch.matmul or nn.Linear
  "softmax(QK^T/√d)" → F.softmax(torch.matmul(q,k.t())/sqrt(d))
  "z_t = √ᾱ_t z + √(1-ᾱ_t)ε" → torch.sqrt(alpha_cumprod)*z + torch.sqrt(1-alpha_cumprod)*noise
  "L = ||ε - ε_θ||²" → F.mse_loss(pred, noise)

## Output
{"functionIndex":3,"status":"match","note":"brief reason","confidence":0.9,"evidence":"torch op(s) found"}

- functionIndex: 0-based index in the code list (null = no match)
- status: "match" | "partial" | "mismatch"
- evidence: the actual torch op(s) (<=200 chars)`;

                const userPrompt = `Paper: ${paperTitle || '(unknown)'}
Component: ${comp.name}
Claim: ${claim.description}${claim.quote ? ` — "${claim.quote}"` : ''}
Role: ${role}

Code (${lookup.length} entries):
${rendered}

Output JSON.`;

                try {
                    const result = await this.llm.chatJson<{ functionIndex: number | null; status: string; note: string; confidence: number; evidence?: string }>(
                        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                        0.7,
                    );

                    const idx = result.functionIndex != null && result.functionIndex >= 0 && result.functionIndex < lookup.length
                        ? result.functionIndex : null;
                    const matchedFn = idx != null ? lookup[idx] : undefined;

                    const row: AlignmentRow = {
                        claim, componentName: comp.name,
                        matchedFunction: matchedFn,
                        matchedFunctions: matchedFn ? [matchedFn] : undefined,
                        status: result.status === 'match' || result.status === 'partial' || result.status === 'mismatch'
                            ? result.status : 'mismatch',
                        note: result.note || '',
                        confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0,
                        evidence: result.evidence,
                    };

                    if (matchedFn && (result.status === 'match' || result.status === 'partial')) {
                        const span = buildEvidenceSpan(matchedFn, claim);
                        if (span) row.evidenceSpans = [span];
                    }

                    rows.push(row);
                } catch (e) {
                    console.warn(`[aligner] claim failed: ${(e as Error).message}`);
                    rows.push({ claim, componentName: comp.name, status: 'mismatch', note: 'LLM error', confidence: 0 });
                }
            }
        }

        return rows;
    }
}
