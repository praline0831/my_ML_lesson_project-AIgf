import { Skill, SkillContext } from './types.js';

export interface PaperAlignArgs {
    arxiv_id: string;
    repo_url?: string;
}

export const paperAlignSkill: Skill = {
    name: 'paper_align',
    description: '对齐论文与代码：输入 arXiv ID，自动提取论文核心组件和公式，匹配对应 GitHub 仓库的代码函数，精确定位到行级实现。输出分层对齐报告。',
    enabledByDefault: true,
    instructions: `## paper_align 技能 — 论文-代码智能对齐

### 功能
给定一篇 arXiv 论文，自动完成三件事：
1. **论文解析** — 识别 3-5 个核心贡献组件，每个组件提取 2-4 条关键声明（公式、架构、算法）
2. **代码匹配** — 从 GitHub 仓库中定位实现这些声明的函数，精确到行
3. **分层报告** — 按组件组织，含行级证据和变量映射

### 使用场景
- 读论文时想快速找到关键公式对应的代码实现
- 复现论文时需要知道代码里哪个函数做了什么
- 对比论文声称的方法和实际实现是否一致

### 调用方式
<skill>{"name":"paper_align","args":{"arxiv_id":"2106.09685","repo_url":"https://github.com/microsoft/LoRA"}}</skill>

参数说明：
- arxiv_id: 必需，arXiv 论文 ID（如 "2106.09685" 或完整 URL）
- repo_url: 可选，GitHub 仓库 URL（未提供则从论文自动提取）

### 注意事项
- 只支持 Python 代码仓库
- 结果包含证据行号和变量映射，可直接跳转到代码对应位置
- 复杂论文可能需要几分钟`,
    parameters: [
        { name: 'arxiv_id', type: 'string', description: 'arXiv 论文 ID，如 "2106.09685" 或完整 arXiv URL', required: true },
        { name: 'repo_url', type: 'string', description: '可选，GitHub 仓库 URL，如 "https://github.com/microsoft/LoRA"', required: false },
    ],
    execute: async (args: Record<string, unknown>, ctx: SkillContext) => {
        const arxivId = String(args.arxiv_id ?? '').trim();
        if (!arxivId) throw new Error('paper_align: arxiv_id 不能为空');

        const repoUrl = args.repo_url ? String(args.repo_url).trim() : undefined;

        // dynamic import to avoid circular dependency at module level
        const { PaperAlignAgent, LLMProviderAdapter } = await import('@agent/paper-align');

        const adapter = new LLMProviderAdapter(ctx.llm);

        const agent = new PaperAlignAgent({
            llm: adapter,
            onProgress: (stage, info) => {
                console.log(`[paper-align] ${stage}: ${info ?? ''}`);
            },
        });

        const report = await agent.align(arxivId, repoUrl);

        return {
            arxiv_id: arxivId,
            title: report.paper.title,
            summary: report.summary,
            components: report.components?.map(c => ({
                name: c.component.name,
                priority: c.component.priority,
                claims: c.rows.map(r => ({
                    description: r.claim.description,
                    status: r.status,
                    location: r.claim.location,
                    evidence: r.evidence,
                    evidenceLine: r.evidenceLine,
                    function: r.matchedFunction ? `${r.matchedFunction.file}::${r.matchedFunction.name}` : null,
                })),
            })),
            markdown: report.markdown,
        };
    },
};
