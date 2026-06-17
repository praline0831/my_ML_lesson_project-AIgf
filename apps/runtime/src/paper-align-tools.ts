/**
 * 论文-代码对齐 Tool（接入 runtime 的 Agent）
 *
 * 复用 @agent/paper-align 包，把整条流水线包装成一个 Tool，
 * 让 LangGraph agent 可以在对话中调用。
 */

import { PaperAlignAgent } from '@agent/paper-align';
import type { Tool } from './types.js';

function createTool(
    name: string,
    description: string,
    execute: (args: Record<string, unknown>) => Promise<unknown>
): Tool {
    return { name, description, execute } as Tool;
}

/**
 * 构造对齐 Tool
 * @param llmProvider runtime 的 LLMProvider（可暂时不用，让包自己从 env 拿）
 */
export function createPaperAlignTool(llmProvider?: unknown): Tool {
    return createTool(
        'align_paper_code',
        '论文-代码对齐工具。给定 arXiv 论文 id（可加 GitHub 链接），自动抽取论文关键声明 + 拉取仓库 + 抽取关键函数 + 输出对齐报告。\n参数：\n  - arxiv_id: 必填，arXiv 编号（如 2106.09685）\n  - repo_url: 可选，强制指定 GitHub 链接',
        async (args) => {
            const arxivId = (args.arxiv_id as string) || (args.arxivId as string);
            const repoUrl = (args.repo_url as string) || (args.repoUrl as string | undefined);

            if (!arxivId) {
                throw new Error('缺少 arxiv_id 参数');
            }

            // 这里可以让包自己从 env 读 LLM；runtime 的 LLMProvider 是另一种接口，
            // 后续可在 LLMClient 旁边加一个 adapter。当前先不接，避免改动 runtime 现有类型。
            void llmProvider;

            const agent = new PaperAlignAgent();
            const report = await agent.align(arxivId, repoUrl);

            return report.markdown;
        }
    );
}

export const paperAlignTools: Tool[] = [createPaperAlignTool()];
