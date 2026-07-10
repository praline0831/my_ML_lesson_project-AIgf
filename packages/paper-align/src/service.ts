import { Aligner } from './aligner.js';
import { extractPythonFunctions } from './key-function-selector.js';
import { LLMClient, defaultLLMClient } from './llm-client.js';
import { PaperParser, normalizeArxivId } from './paper-parser.js';
import { RepoFetcher } from './repo-fetcher.js';
import { buildReport } from './reporter.js';
import type { AlignmentReport, CodeFunction, ParsedPaper, RepoFile } from './types.js';

export interface PaperAlignAgentOptions {
    llm?: LLMClient;
    githubToken?: string;
    proxyUrl?: string;
    keyFunctionCount?: number;
    candidateFileCount?: number;
    onProgress?: (stage: string, info?: string) => void;
    cacheTtlMs?: number;
}

interface CacheEntry<T> {
    data: T;
    ts: number;
}

export class PaperAlignAgent {
    private llm: LLMClient;
    private paperParser: PaperParser;
    private repoFetcher: RepoFetcher;
    private aligner: Aligner;
    private onProgress?: (stage: string, info?: string) => void;
    private cacheTtlMs: number;
    private paperCache = new Map<string, CacheEntry<ParsedPaper>>();
    private repoCache = new Map<string, CacheEntry<{
        owner: string;
        repo: string;
        defaultBranch: string;
        fileTree: string[];
        candidateFiles: RepoFile[];
    }>>();

    constructor(options: PaperAlignAgentOptions = {}) {
        this.llm = options.llm || defaultLLMClient();
        this.onProgress = options.onProgress;
        this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60 * 1000;

        this.paperParser = new PaperParser(this.llm);
        this.repoFetcher = new RepoFetcher({
            token: options.githubToken,
            proxyUrl: options.proxyUrl,
            maxFiles: options.candidateFileCount ?? 30,
        });
        this.aligner = new Aligner(this.llm);
    }

    private extractAllFunctions(candidateFiles: RepoFile[]): CodeFunction[] {
        const all: CodeFunction[] = [];
        for (const file of candidateFiles) {
            if (file.language !== 'python') continue;
            all.push(...extractPythonFunctions(file));
        }
        return all;
    }

    clearCache(): void {
        this.paperCache.clear();
        this.repoCache.clear();
        this.progress('cache', 'all caches cleared');
    }

    private cachedOrFetch<T>(cache: Map<string, CacheEntry<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
        const entry = cache.get(key);
        if (entry && Date.now() - entry.ts < this.cacheTtlMs) {
            this.progress('cache', `cache hit: ${key}`);
            return Promise.resolve(entry.data);
        }
        return fetcher().then(data => {
            cache.set(key, { data, ts: Date.now() });
            return data;
        });
    }

    async align(arxivIdOrUrl: string, explicitRepoUrl?: string): Promise<AlignmentReport> {
        const arxivId = normalizeArxivId(arxivIdOrUrl);

        this.progress('paper', `parsing paper ${arxivId} ...`);
        const paper = await this.cachedOrFetch(this.paperCache, arxivId, () =>
            this.paperParser.parse(arxivId)
        );
        this.progress('paper', `extracted ${paper.claims.length} claims`);

        const repoUrl = explicitRepoUrl || paper.repoUrl;
        if (!repoUrl) {
            this.progress('repo', 'no GitHub link found in paper, skipping code alignment');
            return buildReport({
                paper: {
                    arxivId: paper.arxivId,
                    title: paper.title,
                },
                rows: paper.claims.map(c => ({
                    claim: c,
                    status: 'missing',
                    note: 'no GitHub link in paper',
                    confidence: 1.0,
                })),
            });
        }

        this.progress('repo', `fetching repository ${repoUrl} ...`);
        const repoInfo = await this.cachedOrFetch(this.repoCache, repoUrl, () =>
            this.repoFetcher.fetchCandidateFiles(repoUrl)
        );
        this.progress('repo', `found ${repoInfo.candidateFiles.length} candidate files`);

        this.progress('functions', `extracting all functions from ${repoInfo.candidateFiles.length} files ...`);
        const allFunctions = this.extractAllFunctions(repoInfo.candidateFiles);
        this.progress('functions', `extracted ${allFunctions.length} functions total`);

        this.progress('align', 'aligning all claims ↔ all functions (single-pass) ...');
        const rows = await this.aligner.align(paper.claims, allFunctions, paper.title);
        this.progress('align', `alignment complete: ${rows.length} rows`);

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

export { Aligner } from './aligner.js';
export { KeyFunctionSelector } from './key-function-selector.js';
export { LLMProviderAdapter } from './llm-adapter.js';
export type { ExternalChatMessage, ExternalLLMProvider } from './llm-adapter.js';
export { LLMClient, defaultLLMClient } from './llm-client.js';
export { PaperParser, extractRepoUrl, normalizeArxivId } from './paper-parser.js';
export { RepoFetcher } from './repo-fetcher.js';
export { buildReport } from './reporter.js';
export type { AlignmentReport, AlignmentRow, CodeFunction, PaperClaim, ParsedPaper, ParsedRepo, RepoFile } from './types.js';
