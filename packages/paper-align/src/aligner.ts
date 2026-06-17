/**
 * Claim ↔ Function 对齐器
 *
 * 核心任务：对每个 paper claim，判断它：
 *   - 对应到哪个代码函数
 *   - 实现是否与论文一致
 *   - 缺失 / 部分实现 / 完整匹配 / 存在偏差
 *
 * 策略：分批喂给 LLM（一次只对齐 3-5 个 claim），避免超 token
 */

import { LLMClient } from './llm-client.js';
import type { AlignmentRow, CodeFunction, PaperClaim } from './types.js';

export interface AlignerOptions {
    /** 一批对齐多少个 claim（默认 4） */
    batchSize?: number;
    llm?: LLMClient;
}

interface AlignedItem {
    claimIndex: number;
    functionIndex: number | null;   // null 表示找不到
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    note: string;
    confidence: number;
    /** 模型推理过程（方便调试） */
    reasoning?: string;
    /** 代码中匹配到的关键证据片段 */
    evidence?: string;
    /**
     * 证据所在的行号（函数体内的相对行号，从 1 开始）
     * 例：函数体第 5 行实现 α/r 缩放 → evidenceLine: 5
     * 最终展示时换算成文件绝对行号：fileLine = startLine + evidenceLine - 1
     */
    evidenceLine?: number;
}

interface BatchResult {
    alignments: AlignedItem[];
}

export class Aligner {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: AlignerOptions = {}) {
        this.llm = llm;
        this.options = { batchSize: 4, ...options };
    }

    async align(claims: PaperClaim[], functions: CodeFunction[]): Promise<AlignmentRow[]> {
        if (claims.length === 0) return [];
        if (functions.length === 0) {
            // 没有代码可对，全部 missing
            return claims.map(c => ({
                claim: c,
                status: 'missing',
                note: '仓库中未找到可对齐的 Python 函数',
                confidence: 1.0,
            }));
        }

        const results: AlignmentRow[] = [];
        for (let i = 0; i < claims.length; i += this.options.batchSize!) {
            const batch = claims.slice(i, i + this.options.batchSize!);
            const batchResults = await this.alignBatch(batch, functions);
            for (let j = 0; j < batch.length; j++) {
                const claim = batch[j];
                const aligned = batchResults.alignments.find(a => a.claimIndex === j);
                if (!aligned) {
                    results.push({
                        claim,
                        status: 'missing',
                        note: '对齐失败',
                        confidence: 0,
                    });
                    continue;
                }
                const fn = aligned.functionIndex != null ? functions[aligned.functionIndex] : undefined;
                results.push({
                    claim,
                    matchedFunction: fn,
                    status: aligned.status,
                    note: aligned.note,
                    confidence: aligned.confidence,
                    reasoning: aligned.reasoning,
                    evidence: aligned.evidence,
                });
            }
        }
        return results;
    }

    private async alignBatch(claims: PaperClaim[], functions: CodeFunction[]): Promise<BatchResult> {
        const claimList = claims.map((c, i) =>
            `[CLAIM ${i}] ${c.description}\n     出处: ${c.location}${c.quote ? `\n     原文: ${c.quote}` : ''}`
        ).join('\n\n');

        const fnList = functions.map((f, i) => {
            const body = f.body.length > 1200 ? f.body.slice(0, 1200) + '\n... (truncated)' : f.body;
            return `[FN ${i}] ${f.file} :: ${f.name} (L${f.startLine}-${f.endLine})\n${f.signature}\n${body}`;
        }).join('\n\n---\n\n');

        const systemPrompt = `你是论文-代码复现验证专家。任务：对每个 CLAIM 在 FN 列表中找**最可能实现该声明**的函数，并判断实现是否与论文一致。

## 评判流程（必须按顺序）

对每个 claim，**先思考**（写在 \`reasoning\` 字段）：
1. 这个 claim 的**核心标识符**是什么？（公式符号、函数名、超参名、特殊 trick 名）
   - 例：LoRA 公式 "W + BA" → 找代码里的 \`B @ A\` 或 \`lora_B @ lora_A\`
   - 例：学习率 1e-4 + cosine schedule → 找 \`lr=1e-4\` 和 \`get_cosine_schedule\`
2. 在 FN 列表中**精确匹配**这些标识符（看代码里有没有这些 token/符号）
3. 找到后**对比**实现细节：
   - 变量名是否对应（论文的 W0 ↔ 代码的 self.weight？）
   - 操作顺序是否一致
   - 默认参数是否与论文一致
4. 给判定

## 判定规则
- \`match\`     完整实现，核心公式/参数/操作与论文一致
- \`partial\`   部分实现或简化（省略了某 trick），但**核心思想在**
- \`mismatch\`  找到对应函数但**实现与论文明显不一致**（公式写错、参数不同）
- \`missing\`   找不到任何对应（代码没开源 / 作者换种实现 / claim 只是描述性）

## 置信度指导
- 0.9-1.0: 找到代码且公式/参数完全对得上
- 0.7-0.9: 找到代码但部分细节模糊
- 0.5-0.7: 找到代码但核心逻辑有偏差
- 0.3-0.5: 找到代码但只是名字像
- 0.0-0.3: 完全找不到，应判 missing

## 输出格式（严格 JSON）
{
  "alignments": [
    {
      "claimIndex": 0,
      "functionIndex": 3,                              // null = missing
      "status": "match|partial|mismatch|missing",
      "reasoning": "先描述你找到了什么证据（哪行/哪个标识符），再给判定",
      "note": "中文简述对齐结果（<= 60 字）",
      "evidence": "代码中的关键片段（<= 100 字，如 'B @ A, rank=8' 或 'lr_scheduler.CosineAnnealing'）",
      "evidenceLine": 5,                               // 证据在该函数体内的相对行号（从 1 开始）
      "confidence": 0.0
    }
  ]
}

## evidenceLine 必填规则（重要）
- 只要 \`functionIndex\` 不为 null，**必须**给 \`evidenceLine\`
- \`evidenceLine\` 是**函数体内的相对行号**（1-based），不是文件绝对行号
- 例：函数体第 5 行实现了 α/r 缩放 → \`evidenceLine: 5\`
- 例：函数体第 1 行是 def，第 3 行有 return → \`evidenceLine: 3\`
- 如果一行没找到（missing），evidenceLine 可以是 null`;

        const userPrompt = `论文声明（CLAIM）：
${claimList}

候选代码函数（FN）：
${fnList}

请输出 JSON。`;

        return await this.llm.chatJson<BatchResult>([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ]);
    }
}
