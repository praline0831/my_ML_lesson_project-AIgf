/**
 * 论文解析器
 *
 * 流程：
 *   1. 通过 @agent/paper 拿 arXiv 摘要
 *   2. 尝试拉 ar5iv 渲染版 HTML（比 PDF 友好）
 *   3. 提取正文的纯文本（去标签、保留段落结构）
 *   4. 用 LLM 从中抽取 5-15 个"复现关键声明"
 */

import { arxivService } from '@agent/paper';
import { LLMClient } from './llm-client.js';
import type { PaperClaim, ParsedPaper } from './types.js';

const AR5IV_BASE = 'https://ar5iv.labs.arxiv.org/html/';

export interface PaperParserOptions {
    /** 要抽取的声明数量（默认 8） */
    claimCount?: number;
    /** 传入自定义 LLM 客户端 */
    llm?: LLMClient;
}

/**
 * 规范化 arxiv id
 * 支持：
 *   - 2106.09685
 *   - arXiv:2106.09685
 *   - https://arxiv.org/abs/2106.09685
 *   - 2106.09685v1
 */
export function normalizeArxivId(input: string): string {
    let id = input.trim();
    id = id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '');
    id = id.replace(/^arXiv:/i, '');
    id = id.replace(/\.pdf$/i, '');
    // 保留版本号，方便后续 fetch
    return id;
}

export class PaperParser {
    private llm: LLMClient;

    constructor(llm: LLMClient, private options: PaperParserOptions = {}) {
        this.llm = llm;
        this.options = { claimCount: 8, ...options };
    }

    /**
     * 主入口
     */
    async parse(arxivIdOrUrl: string): Promise<ParsedPaper> {
        const arxivId = normalizeArxivId(arxivIdOrUrl);
        const baseId = arxivId.replace(/v\d+$/, ''); // 拿摘要不带版本号

        // 1) 拿摘要
        const search = await arxivService.search(baseId, 1);
        const meta = search.papers.find(p => p.id.endsWith(baseId)) || search.papers[0];
        if (!meta) {
            throw new Error(`未找到 arXiv 论文: ${arxivId}`);
        }

        // 2) 从摘要/comment 抽 GitHub 链接
        const repoUrl = extractRepoUrl(`${meta.abstract}\n${meta.comment ?? ''}`);

        // 3) 拿正文
        const bodyText = await this.fetchBody(arxivId);

        // 4) LLM 抽声明
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

    /**
     * 拉 ar5iv 全文 → 转纯文本
     */
    private async fetchBody(arxivId: string): Promise<string> {
        const url = `${AR5IV_BASE}${arxivId}`;
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'paper-align-agent/0.1' },
            });
            if (!resp.ok) {
                console.warn(`[paper-parser] ar5iv 返回 ${resp.status}，回退到仅用摘要`);
                return '';
            }
            const html = await resp.text();
            return htmlToText(html);
        } catch (err) {
            console.warn(`[paper-parser] ar5iv 拉取失败: ${(err as Error).message}`);
            return '';
        }
    }

    /**
     * 用 LLM 抽取"复现关键"声明
     */
    private async extractClaims(title: string, bodyText: string): Promise<PaperClaim[]> {
        // 截断正文，避免超 token
        const maxChars = 24000;
        const truncated = bodyText.length > maxChars
            ? bodyText.slice(0, maxChars) + '\n\n[... truncated ...]'
            : bodyText;

        if (!truncated) {
            // 没有正文时退到摘要
            return [{
                description: '（仅有摘要，无法细化声明）',
                location: 'abstract',
            }];
        }

        const systemPrompt = `你是一个 ML 论文复现专家，任务是从论文正文中提取**对复现最关键**的技术声明。

## 什么是"复现关键"
能在代码中找到对应实现的具体内容：数学公式、算法步骤、损失函数、训练 trick、数据处理逻辑。
**不是**：实验结果数字（"在 GLUE 上达到 89.2"）、引用文献、概念性讨论、动机说明。

## 分类标签（必填）
- \`formula\`    数学公式/推导（如 LoRA: W + ΔW = W + BA）
- \`algorithm\`  算法步骤/伪代码（如 beam search 流程）
- \`loss\`       损失函数定义
- \`hyperparam\` 关键超参（学习率、batch size、rank r、warmup steps）
- \`training\`   训练策略（优化器选择、gradient clip、ema、mixed precision）
- \`data\`       数据处理/预处理/增强
- \`arch\`       模型结构细节（层数、hidden size、激活函数、dropout）

## 重要度（1-3）
- 3 = 核心方法（论文标题/方法名直接对应的内容）
- 2 = 关键技术细节（影响复现结果）
- 1 = 可选项（作者说"也可以用 X 替代"）

## 提取规则
1. 每条 claim 必须是**单个具体点**，不要把三件事混成一条
2. 给出 location（§3.2 / Eq.5 / Table 1 / Algorithm 1），方便回查原文
3. quote 字段贴**包含关键公式或关键词的原文**（<= 200 字），方便后续 grep
4. 至少 5 条，最多 ${this.options.claimCount} 条
5. 优先级：formula > loss > algorithm > training > arch > data > hyperparam

## 输出格式（严格 JSON）
{
  "claims": [
    {
      "description": "一句话核心（中文）",
      "type": "formula|loss|algorithm|hyperparam|training|data|arch",
      "importance": 1|2|3,
      "location": "§3.2 / Eq.5 / Table 1",
      "quote": "包含关键公式或关键词的原文片段"
    }
  ]
}

## 示例（LoRA 论文）
{
  "claims": [
    {
      "description": "LoRA 权重更新用低秩分解 ΔW = BA",
      "type": "formula",
      "importance": 3,
      "location": "§4.1 / Eq.5",
      "quote": "W0 + ΔW = W0 + BA, where B ∈ R^{d×r}, A ∈ R^{r×k}, and the rank r ≪ min(d, k)"
    },
    {
      "description": "前向传播 h = W0x + BAx",
      "type": "formula",
      "importance": 3,
      "location": "Eq.3",
      "quote": "h = W0x + ΔWx = W0x + BAx"
    },
    {
      "description": "A 用高斯初始化，B 用零初始化",
      "type": "hyperparam",
      "importance": 2,
      "location": "§4.1",
      "quote": "A ~ N(0, σ²), B = 0"
    }
  ]
}`;

        const userPrompt = `论文标题：${title}

论文正文：
"""
${truncated}
"""

请输出 JSON。`;

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

/**
 * 从文本中提取 GitHub 仓库链接
 * 修复：贪心正则会吃末尾的句末标点（.,;:!?'"），需要剥掉
 */
export function extractRepoUrl(text: string): string | undefined {
    const match = text.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
    if (!match) return undefined;
    let url = match[0];
    // 去掉 .git 后缀
    url = url.replace(/\.git$/, '');
    // 去掉末尾斜杠
    url = url.replace(/\/$/, '');
    // 去掉末尾的句末标点（贪婪匹配的副作用）
    url = url.replace(/[.,;:!?'")\]}>]+$/, '');
    return url;
}

/**
 * 简单 HTML → 文本
 * 保留段落结构（双换行），去除所有标签
 */
function htmlToText(html: string): string {
    // 移除 script/style
    let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // 段落/换行
    text = text.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    // 去掉所有标签
    text = text.replace(/<[^>]+>/g, '');
    // 解码常见实体
    text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    // 规范化空白
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    return text.trim();
}
