/**
 * 关键函数选择器
 *
 * 流程：
 *   1. 用正则从 Python 文件中粗提取所有 top-level def / class
 *   2. 按"启发式分数"排序（类名/函数名/代码长度）
 *   3. 取 top-N 让 LLM 二轮挑出"真正对应论文核心方法的"函数
 *
 * 设计取舍：不做完整 AST（依赖太重），但能覆盖 80% ML repo 的关键函数。
 */

import { LLMClient } from './llm-client.js';
import type { CodeFunction, RepoFile } from './types.js';

export interface KeyFunctionSelectorOptions {
    /** 最终选几个关键函数（默认 10） */
    targetCount?: number;
    /** 每个函数提取的最大字符数（默认 3000） */
    maxBodyChars?: number;
    llm?: LLMClient;
}

const KEYWORD_HINTS = [
    'model', 'net', 'network', 'arch', 'forward',
    'loss', 'criterion', 'objective',
    'train', 'step', 'update',
    'optim', 'lr', 'schedule',
    'attention', 'mha', 'mlp',
    'embed', 'encoder', 'decoder',
    'lora', 'adapter', 'prefix',
    'sample', 'generate', 'decode',
    'compute', 'calculate',
];

export class KeyFunctionSelector {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: KeyFunctionSelectorOptions = {}) {
        this.llm = llm;
        this.options = { targetCount: 10, maxBodyChars: 3000, ...options };
    }

    async select(candidateFiles: RepoFile[]): Promise<CodeFunction[]> {
        // 1) 粗提取
        const all: CodeFunction[] = [];
        for (const file of candidateFiles) {
            if (file.language !== 'python') continue;
            all.push(...extractPythonFunctions(file));
        }

        if (all.length === 0) return [];

        // 2) 启发式排序，取候选池（多给点让 LLM 有空间挑）
        const ranked = rankByHeuristic(all);
        const poolSize = Math.min(ranked.length, this.options.targetCount! * 3);
        const pool = ranked.slice(0, poolSize);

        // 3) LLM 二轮挑
        const picked = await this.llmPick(pool);

        return picked;
    }

    private async llmPick(pool: CodeFunction[]): Promise<CodeFunction[]> {
        const target = this.options.targetCount!;
        const summaries = pool.map((f, i) => {
            const body = f.body.length > 600 ? f.body.slice(0, 600) + '...' : f.body;
            return `[${i}] ${f.file} :: ${f.name} (L${f.startLine}-${f.endLine})\n${f.signature}\n${body}`;
        }).join('\n\n---\n\n');

        const systemPrompt = `你是 ML 代码审查专家。任务：从候选函数池中挑出 ${target} 个最可能是"论文核心方法实现"的函数/类。

## 三档优先级（按顺序挑）

### P0 - 必选（核心方法）
- 论文方法名直接对应的类/函数（LoRA → \`LoRALayer\`, Transformer → \`MultiHeadAttention\`）
- 方法的 forward / compute / __call__ 入口
- 训练主循环（\`train_step\`, \`fit\`, \`update\`）

### P1 - 优先选（关键计算）
- 核心数学公式的实现（attention score、loss、sample）
- 关键 trick（gradient checkpoint、RoPE、LayerNorm、激活函数）
- 数据加载/预处理主入口

### P2 - 选剩余名额时考虑
- 配置/超参数类（仅当其包含可对齐的 claim 时）
- 评估函数（如果 claim 涉及）

## ❌ 必跳过的"噪音函数"
- 工具函数：\`parse_args\`, \`save_checkpoint\`, \`load_model\`, \`set_seed\`, \`to_tensor\`, \`print_metrics\`
- 入口/CLI：\`main\`, \`run\`, \`cli\`, \`parse_args\`
- 日志/可视化：\`log\`, \`plot\`, \`wandb_init\`, \`tensorboard\`
- 注册器：\`register_model\`, \`register_dataset\`
- 测试/demo：名字含 \`test_\` / \`demo\` / \`example\` / \`_demo\`
- 装饰器/包装器：单纯包一层没新逻辑的

## 评判步骤
对每个候选函数，回答三个问题：
1. 函数名是否暗示核心组件？（model/loss/attention/...）
2. 函数体里是否有关键计算（不是工具函数）？
3. docstring 或代码注释是否提到算法细节？

只挑三项都"是"的。

## 输出格式（严格 JSON）
{
  "selected": [
    {
      "index": 0,                            // 候选池下标
      "priority": "P0"|"P1"|"P2",
      "reason": "为什么选它（<= 30 字）"
    }
  ]
}`;

        const userPrompt = `候选函数池（共 ${pool.length} 个）：

${summaries}

请挑选最关键的 ${target} 个。`;

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

        // 兼容旧版输出：selected 可能是 number[] 或 {index, priority, reason}[]
        const items = (result.selected || []).map(item =>
            typeof item === 'number' ? { index: item } : item
        );

        // 按 P0 → P1 → P2 排序，再按 pool 顺序填充
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

/**
 * 从 Python 文件提取所有 def / class 块
 *
 * 关键：class 内部的 def 会作为独立方法提取（命名：ClassName.method）
 * 这样 LoRALinear.forward 和 LoRALinear.__init__ 分开，
 * 对齐时不会把整个类几十行混在一起。
 */
export function extractPythonFunctions(file: RepoFile): CodeFunction[] {
    const lines = file.content.split('\n');
    const defRegex = /^(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/;

    // 1) 找出所有 def/class 起始行 + 缩进级别
    type DefSpan = {
        idx: number;        // defs 数组中的下标
        line: number;       // 0-based 起始行
        indent: number;     // 缩进（0 = 顶层）
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

    // 2) 计算每个 def 的"父级"（最近的、缩进更浅的 def/class）
    const parentOf = (i: number): DefSpan | null => {
        for (let j = i - 1; j >= 0; j--) {
            if (defs[j].indent < defs[i].indent) return defs[j];
        }
        return null;
    };

    // 3) 计算每个 def 的结束行（下一个缩进 ≤ 自己的 def 之前）
    //    顶层 def 的 body 会包含所有缩进更深的子 def（class 整段）
    //    方法的 body 不会包含 sibling 方法
    const results: CodeFunction[] = [];
    for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        let endLine = lines.length; // 默认到文件末尾

        for (let j = i + 1; j < defs.length; j++) {
            if (defs[j].indent <= def.indent) {
                endLine = defs[j].line;
                break;
            }
        }

        // 命名：方法带父级前缀（LoRALinear.forward），顶层 def 不带
        const parent = parentOf(i);
        const fullName = parent ? `${parent.name}.${def.name}` : def.name;

        // 签名：从 def 行往下找第一个以 `):` 结尾的行（参数列表结束）
        const signature = buildSignature(lines, def.line, def.indent);

        const body = lines.slice(def.line, endLine).join('\n');
        results.push({
            file: file.path,
            name: fullName,
            startLine: def.line + 1,    // 1-based, 含
            endLine,                     // 0-based, 不含
            signature,
            body,
            kind: def.kind,
            parentName: parent?.name,
        });
    }

    return results;
}

/**
 * 构建函数签名
 * - 顶层 def: 取 def 行 + 参数列表结束
 * - 短 def（单行签名的）就返回一行
 */
function buildSignature(lines: string[], startLine: number, indent: number): string {
    const first = lines[startLine].trim();
    // 如果第一行就有 `):` 或 `):` 配对 → 单行签名
    const openParens = (first.match(/\(/g) || []).length;
    const closeParens = (first.match(/\)/g) || []).length;
    if (openParens > closeParens) {
        // 多行签名：向后找参数列表结束
        for (let i = startLine + 1; i < Math.min(startLine + 10, lines.length); i++) {
            const line = lines[i];
            const lineIndent = line.length - line.trimStart().length;
            if (lineIndent > indent) continue; // 还在参数列表里
            // 找 `):` 或 `):`
            if (line.includes('):') || line.includes(') :')) {
                return lines.slice(startLine, i + 1).join('\n');
            }
        }
    }
    return first;
}

function rankByHeuristic(functions: CodeFunction[]): CodeFunction[] {
    const scored = functions.map(f => {
        let score = 0;
        const lower = (f.file + '::' + f.name).toLowerCase();
        for (const kw of KEYWORD_HINTS) {
            if (lower.includes(kw)) score += 2;
        }
        // 长度适中加分
        const len = f.body.length;
        if (len > 200 && len < 3000) score += 3;
        if (len > 3000) score += 1;
        if (len < 100) score -= 2;
        return { f, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.f);
}
