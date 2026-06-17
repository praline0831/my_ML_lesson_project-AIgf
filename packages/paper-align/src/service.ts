/**
 * 论文-代码对齐 Agent - 主服务
 *
 * 用法：
 *   const agent = new PaperAlignAgent({ llm });
 *   const report = await agent.align('2106.09685');
 *   console.log(report.markdown);
 */

import { Aligner } from './aligner.js';
import { KeyFunctionSelector } from './key-function-selector.js';
import { LLMClient, defaultLLMClient } from './llm-client.js';
import { PaperParser, normalizeArxivId } from './paper-parser.js';
import { RepoFetcher } from './repo-fetcher.js';
import { buildReport } from './reporter.js';
import type { AlignmentReport } from './types.js';

export interface PaperAlignAgentOptions {
    llm?: LLMClient;
    githubToken?: string;
    /** 函数级抽取的最大候选函数数（喂 LLM 之前） */
    keyFunctionCount?: number;
    /** 候选文件数（喂 key-function-selector 之前） */
    candidateFileCount?: number;
    /** 进度回调 */
    onProgress?: (stage: string, info?: string) => void;
}

export class PaperAlignAgent {
    private llm: LLMClient;
    private paperParser: PaperParser;
    private repoFetcher: RepoFetcher;
    private fnSelector: KeyFunctionSelector;
    private aligner: Aligner;
    private onProgress?: (stage: string, info?: string) => void;

    constructor(options: PaperAlignAgentOptions = {}) {
        this.llm = options.llm || defaultLLMClient();
        this.onProgress = options.onProgress;

        this.paperParser = new PaperParser(this.llm);
        this.repoFetcher = new RepoFetcher({
            token: options.githubToken,
            maxFiles: options.candidateFileCount ?? 12,
        });
        this.fnSelector = new KeyFunctionSelector(this.llm, {
            targetCount: options.keyFunctionCount ?? 10,
        });
        this.aligner = new Aligner(this.llm);
    }

    /**
     * 主入口：对齐一篇 arXiv 论文
     */
    async align(arxivIdOrUrl: string, explicitRepoUrl?: string): Promise<AlignmentReport> {
        const arxivId = normalizeArxivId(arxivIdOrUrl);

        this.progress('paper', `解析论文 ${arxivId} ...`);
        const paper = await this.paperParser.parse(arxivId);
        this.progress('paper', `抽取到 ${paper.claims.length} 个声明`);

        const repoUrl = explicitRepoUrl || paper.repoUrl;
        if (!repoUrl) {
            this.progress('repo', '论文中未找到 GitHub 链接，跳过代码对齐');
            return buildReport({
                paper: {
                    arxivId: paper.arxivId,
                    title: paper.title,
                },
                rows: paper.claims.map(c => ({
                    claim: c,
                    status: 'missing',
                    note: '论文中未提供 GitHub 链接',
                    confidence: 1.0,
                })),
            });
        }

        this.progress('repo', `拉取仓库 ${repoUrl} ...`);
        const repoInfo = await this.repoFetcher.fetchCandidateFiles(repoUrl);
        this.progress('repo', `筛选出 ${repoInfo.candidateFiles.length} 个候选文件`);

        this.progress('functions', '抽取关键函数 ...');
        const keyFunctions = await this.fnSelector.select(repoInfo.candidateFiles);
        this.progress('functions', `选中 ${keyFunctions.length} 个关键函数`);

        this.progress('align', '对齐 claim ↔ function ...');
        const rows = await this.aligner.align(paper.claims, keyFunctions);
        this.progress('align', `对齐完成：${rows.length} 行`);

        return buildReport({
            paper: {
                arxivId: paper.arxivId,
                title: paper.title,
                repoUrl,
            },
            repo: {
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                url: repoUrl,
            },
            rows,
        });
    }

    private progress(stage: string, info?: string) {
        if (this.onProgress) {
            this.onProgress(stage, info);
        } else {
            console.log(`[paper-align] ${stage}: ${info ?? ''}`);
        }
    }
}

// 重新导出常用符号
export { Aligner } from './aligner.js';
export { KeyFunctionSelector } from './key-function-selector.js';
export { LLMProviderAdapter } from './llm-adapter.js';
export type { ExternalChatMessage, ExternalLLMProvider } from './llm-adapter.js';
export { LLMClient, defaultLLMClient } from './llm-client.js';
export { PaperParser, extractRepoUrl, normalizeArxivId } from './paper-parser.js';
export { RepoFetcher } from './repo-fetcher.js';
export { buildReport } from './reporter.js';
export type { AlignmentReport, AlignmentRow, CodeFunction, PaperClaim, ParsedPaper, ParsedRepo, RepoFile } from './types.js';

