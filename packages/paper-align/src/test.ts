/**
 * 论文-代码对齐 Agent - 测试入口
 *
 * 使用：
 *   # 设置环境变量
 *   $env:LLM_ENDPOINT = "https://api.openai.com/v1"
 *   $env:LLM_MODEL = "gpt-4o-mini"
 *   $env:LLM_API_KEY = "sk-xxx"
 *   $env:GITHUB_TOKEN = "ghp_xxx"   # 可选，提升 rate limit
 *
 *   npx tsx src/test.ts 2106.09685
 *   # 或：npx tsx src/test.ts arxiv:2106.09685 https://github.com/microsoft/LoRA
 */

import { PaperAlignAgent } from './service.js';

async function main() {
    const arxivArg = process.argv[2] || '2106.09685'; // LoRA 论文
    const explicitRepo = process.argv[3];              // 可选：手动指定 repo

    console.log('🌟 论文-代码对齐 Agent 测试\n');
    console.log(`📄 arXiv: ${arxivArg}`);
    if (explicitRepo) console.log(`🔗 强制 repo: ${explicitRepo}`);
    console.log('');

    if (!process.env.LLM_ENDPOINT) {
        console.warn('⚠️  未设置 LLM_ENDPOINT，回退到 http://localhost:11434/v1 (Ollama)');
        console.warn('   建议: $env:LLM_ENDPOINT = "https://api.openai.com/v1"');
    }
    console.log('');

    const agent = new PaperAlignAgent({
        onProgress: (stage, info) => {
            console.log(`  [${stage}] ${info ?? ''}`);
        },
    });

    try {
        const report = await agent.align(arxivArg, explicitRepo);

        console.log('\n' + '='.repeat(60));
        console.log(report.markdown);
        console.log('='.repeat(60));

        // 同时落盘
        const fs = await import('fs/promises');
        const path = await import('path');
        const outDir = path.resolve(process.cwd(), 'align-reports');
        await fs.mkdir(outDir, { recursive: true });
        const outFile = path.join(outDir, `${report.paper.arxivId.replace(/[^\w.-]/g, '_')}.md`);
        await fs.writeFile(outFile, report.markdown, 'utf-8');
        console.log(`\n📝 报告已保存: ${outFile}`);
    } catch (err) {
        console.error('❌ 失败:', (err as Error).message);
        console.error((err as Error).stack);
        process.exit(1);
    }
}

main();
