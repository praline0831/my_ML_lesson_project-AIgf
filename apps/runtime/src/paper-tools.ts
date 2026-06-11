import { arxivService, deepResearchService } from '@agent/paper';
import { Tool } from './types.js';

function createTool(
    name: string,
    description: string,
    execute: (args: Record<string, unknown>) => Promise<unknown>
): Tool {
    return { name, description, execute } as Tool;
}

export const searchArxivTool: Tool = createTool(
    'search_arxiv',
    '搜索 ArXiv 论文库。根据关键词搜索相关论文，返回论文标题、作者、摘要和链接。',
    async ({ query, max_results }) => {
        const results = await arxivService.search(
            query as string,
            typeof max_results === 'number' ? max_results : 10
        );

        if (results.papers.length === 0) {
            return `未找到与 "${query}" 相关的论文。`;
        }

        const briefs = results.papers.map(p => arxivService.formatPaperBrief(p));
        return `找到 ${results.totalResults} 篇相关论文：\n\n${briefs.join('\n\n---\n\n')}`;
    }
);

export const deepResearchTool: Tool = createTool(
    'deep_research',
    '深度研究工具：针对一个研究主题，自动进行多轮 ArXiv 检索（包含主题关键词、综述、近期进展等），最终返回完整的论文清单和研究报告。当用户说"深度研究"、"调研"、"综述"、"系统梳理某个方向"时使用。',
    async ({ topic, rounds, per_round }) => {
        if (!topic || typeof topic !== 'string') {
            throw new Error('缺少 topic 参数');
        }

        const researchRounds = typeof rounds === 'number' ? Math.min(Math.max(rounds, 1), 5) : 3;
        const perRound = typeof per_round === 'number' ? Math.min(Math.max(per_round, 3), 20) : 8;

        const report = await deepResearchService.research(topic, researchRounds, perRound);

        const lines: string[] = [];
        lines.push(`🔬 **深度研究报告：${report.topic}**\n`);
        lines.push(report.synthesis);
        lines.push('\n---\n');
        lines.push('📑 **检索过程**：\n');
        for (const step of report.steps) {
            lines.push(`**第 ${step.round} 轮**：${step.query}`);
            lines.push(`  ${step.summary}`);
        }
        lines.push('\n---\n');
        lines.push(`📚 **论文清单（共 ${report.allPapers.length} 篇）**：\n`);
        const topPapers = report.allPapers.slice(0, 20);
        topPapers.forEach((p, i) => {
            lines.push(`${i + 1}. **${p.title}**`);
            lines.push(`   👤 ${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}`);
            lines.push(`   📅 ${p.published.slice(0, 10)} | 🏷️ ${p.categories.slice(0, 3).join(', ')}`);
            lines.push(`   🔗 ${p.id}`);
            lines.push(`   📝 ${p.abstract.slice(0, 200)}${p.abstract.length > 200 ? '...' : ''}`);
            lines.push('');
        });

        if (report.allPapers.length > 20) {
            lines.push(`\n（还有 ${report.allPapers.length - 20} 篇未显示，请使用 search_arxiv 进一步检索）`);
        }

        return lines.join('\n');
    }
);

export const paperTools: Tool[] = [searchArxivTool, deepResearchTool];
