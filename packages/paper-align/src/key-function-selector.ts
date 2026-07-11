import { LLMClient } from './llm-client.js';
import type { CodeFunction, RepoFile } from './types.js';

export interface KeyFunctionSelectorOptions {
    targetCount?: number;
    maxBodyChars?: number;
    llm?: LLMClient;
}

const KEYWORD_HINTS = [
    'model', 'net', 'network', 'arch', 'forward',
    '__init__', 'setup', 'configure',
    'loss', 'criterion', 'objective',
    'train', 'step', 'update',
    'optim', 'lr', 'schedule',
    'attention', 'mha', 'mlp',
    'embed', 'embedding', 'encoder', 'decoder',
    'lora', 'adapter', 'prefix', 'prompt',
    'sample', 'generate', 'decode',
    'compute', 'calculate',
    'transform', 'norm', 'normalize',
    'dropout', 'activation', 'relu', 'gelu',
    'init', 'parameter', 'weight',
];

export class KeyFunctionSelector {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: KeyFunctionSelectorOptions = {}) {
        this.llm = llm;
        this.options = { targetCount: 15, maxBodyChars: 5000, ...options };
    }

    async select(candidateFiles: RepoFile[], paperTitle?: string, paperAbstract?: string): Promise<CodeFunction[]> {
        this.paperTitle = paperTitle;
        this.paperAbstract = paperAbstract;
        const all: CodeFunction[] = [];
        for (const file of candidateFiles) {
            if (file.language !== 'python') continue;
            all.push(...extractPythonFunctions(file));
        }

        if (all.length === 0) return [];

        const ranked = rankByHeuristic(all, paperTitle, paperAbstract);
        const poolSize = Math.min(ranked.length, Math.max(this.options.targetCount! * 8, 80));
        const pool = ranked.slice(0, poolSize);

        const picked = await this.llmPick(pool);

        return picked;
    }

    private paperTitle?: string;
    private paperAbstract?: string;

    private async llmPick(pool: CodeFunction[]): Promise<CodeFunction[]> {
        const target = this.options.targetCount!;
        const summaries = pool.map((f, i) => {
            const MAX = 1200;
            const body = f.body.length > MAX
                ? f.body.slice(0, Math.floor(MAX * 0.7)) + '\n# ... (truncated, middle omitted) ...\n' + f.body.slice(-Math.floor(MAX * 0.3))
                : f.body;
            return `[${i}] ${f.file} :: ${f.name} (L${f.startLine}-${f.endLine})\n${f.signature}\n${body}`;
        }).join('\n\n---\n\n');

        const paperContext = this.paperTitle
            ? `## Paper title\n${this.paperTitle}\n\n## Paper abstract\n${(this.paperAbstract || '(unavailable)').slice(0, 2000)}`
            : '(no paper context available — use function names and body heuristics)';

        const systemPrompt = `You are an ML code review expert. Select the **${target} most critical functions/classes** that implement the paper's method from the candidate pool.

## Paper context
${paperContext}

## Priority tiers (select in order)

### P0 - Must select (core method)
- Class/function directly implementing the paper's named method or contribution
- Method entry points: forward / compute / __call__ / __init__
- Training loop and loss computation

### P1 - Prefer (key computation)
- Core math formula implementations matching paper equations
- Key building blocks (attention, normalization, activation, embeddings)
- Data preprocessing / augmentation that matches paper description

### P2 - Fill remaining slots
- Config/hyperparameter classes (if they contain paper-specific values)
- Evaluation metrics that paper claims

## Functions to SKIP (noise)
- Utilities: parse_args, save_checkpoint, load_model, set_seed, to_tensor, print_metrics, mkdir
- CLI wrappers: main, run, cli, parse_args (unless they contain core logic)
- Logging: log, plot, wandb_init, tensorboard, logger
- Registries: register_model, register_dataset
- Test files: names containing test_ / demo / example / _demo / mock
- Pure wrappers with no new logic

## Selection criteria
1. Does the function/class name or body suggest it implements a paper-specific component?
2. Does the body contain non-trivial computations matching the paper description?
3. Would removing this function break the paper's core method?

Select only if YES to at least two of three.

## Output format (strict JSON)
{
  "selected": [
    {
      "index": 0,
      "priority": "P0"|"P1"|"P2",
      "reason": "Why this matches the paper (<= 40 chars)"
    }
  ]
}`;

        const userPrompt = `Candidate function pool (${pool.length} total):

${summaries}

Select the ${target} most critical functions for this paper.`;

        interface PickItem {
            index: number;
            priority?: 'P0' | 'P1' | 'P2';
            reason?: string;
        }
        interface PickResult { selected: PickItem[]; }
        const result = await this.llm.chatJson<PickResult>([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ]);

        const items = (result.selected || []).map(item =>
            typeof item === 'number' ? { index: item } : item
        );

        const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
        items.sort((a, b) => {
            const pa = priorityOrder[a.priority ?? 'P2'] ?? 2;
            const pb = priorityOrder[b.priority ?? 'P2'] ?? 2;
            if (pa !== pb) return pa - pb;
            return a.index - b.index;
        });

        return items
            .map(i => pool[i.index])
            .filter((f): f is CodeFunction => !!f)
            .slice(0, target);
    }
}

export function extractPythonFunctions(file: RepoFile): CodeFunction[] {
    const lines = file.content.split('\n');
    const defRegex = /^(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/;

    type DefSpan = {
        idx: number;
        line: number;
        indent: number;
        kind: 'def' | 'class';
        name: string;
    };
    const defs: DefSpan[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(defRegex);
        if (!m) continue;
        const indent = lines[i].length - lines[i].trimStart().length;
        defs.push({
            idx: defs.length,
            line: i,
            indent,
            kind: m[1] === 'class' ? 'class' : 'def',
            name: m[2],
        });
    }

    const parentOf = (i: number): DefSpan | null => {
        for (let j = i - 1; j >= 0; j--) {
            if (defs[j].indent < defs[i].indent) return defs[j];
        }
        return null;
    };

    const results: CodeFunction[] = [];
    for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        let endLine = lines.length;

        for (let j = i + 1; j < defs.length; j++) {
            if (defs[j].indent <= def.indent) {
                endLine = defs[j].line;
                break;
            }
        }

        const parent = parentOf(i);
        const fullName = parent ? `${parent.name}.${def.name}` : def.name;

        const signature = buildSignature(lines, def.line, def.indent);

        const body = lines.slice(def.line, endLine).join('\n');
        results.push({
            file: file.path,
            name: fullName,
            startLine: def.line + 1,
            endLine,
            signature,
            body,
            kind: def.kind,
            parentName: parent?.name,
        });
    }

    return results;
}

function buildSignature(lines: string[], startLine: number, indent: number): string {
    const first = lines[startLine].trim();
    const openParens = (first.match(/\(/g) || []).length;
    const closeParens = (first.match(/\)/g) || []).length;
    if (openParens > closeParens) {
        for (let i = startLine + 1; i < Math.min(startLine + 10, lines.length); i++) {
            const line = lines[i];
            const lineIndent = line.length - line.trimStart().length;
            if (lineIndent > indent) continue;
            if (line.includes('):') || line.includes(') :')) {
                return lines.slice(startLine, i + 1).join('\n');
            }
        }
    }
    return first;
}

export function rankByHeuristic(functions: CodeFunction[], paperTitle?: string, paperAbstract?: string): CodeFunction[] {
    const paperTokens = new Set<string>();
    if (paperTitle || paperAbstract) {
        const raw = `${paperTitle || ''} ${paperAbstract || ''}`.toLowerCase();
        for (const t of raw.split(/[\s,;:()\[\]{}=+\-*/\\'"`<>!?|.…、，。；：（）【】"「」『』《》]+/)) {
            if (t.length >= 3 && !/^\d+$/.test(t)) paperTokens.add(t);
        }
    }

    const scored = functions.map(f => {
        let score = 0;
        const lower = (f.file + '::' + f.name).toLowerCase();
        const bodyLower = f.body.toLowerCase();

        for (const kw of KEYWORD_HINTS) {
            if (lower.includes(kw)) score += 2;
        }

        if (paperTokens.size > 0) {
            for (const token of paperTokens) {
                if (lower.includes(token)) score += 4;
                if (bodyLower.includes(token)) score += 2;
            }
        }

        const name = f.name.toLowerCase();
        if (name === '__init__') score += 6;
        if (name === 'forward') score += 5;

        const len = f.body.length;
        if (len >= 50 && len < 200) score += 2;
        if (len >= 200 && len < 3000) score += 3;
        if (len >= 3000) score += 1;

        return { f, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.f);
}
