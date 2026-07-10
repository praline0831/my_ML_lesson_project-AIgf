import { ProxyAgent } from 'undici';
import type { RepoFile } from './types.js';

const RAW_BASE = 'https://raw.githubusercontent.com';
const API_BASE = 'https://api.github.com';

export interface RepoFetcherOptions {
    maxFileChars?: number;
    maxFiles?: number;
    token?: string;
    proxyUrl?: string;
}

interface GitTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
}

interface GitTreeResponse {
    sha: string;
    url: string;
    tree: GitTreeItem[];
    truncated: boolean;
}

export class RepoFetcher {
    private headers: Record<string, string>;
    private proxyAgent: ProxyAgent | undefined;
    private proxyUrl: string | undefined;

    constructor(private options: RepoFetcherOptions = {}) {
        this.options = { maxFileChars: 30000, maxFiles: 30, ...options };
        this.headers = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'paper-align-agent/0.1',
        };
        if (options.token) {
            this.headers.Authorization = `Bearer ${options.token}`;
        }

        this.proxyUrl = options.proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        this.proxyAgent = this.proxyUrl ? new ProxyAgent(this.proxyUrl) : undefined;

        if (this.proxyAgent) {
            console.log(`[repo-fetcher] using proxy: ${this.proxyUrl}`);
        } else {
            console.warn(`[repo-fetcher] no proxy configured, direct GitHub access may be slow`);
        }
    }

    async fetchCandidateFiles(repoUrl: string): Promise<{
        owner: string;
        repo: string;
        defaultBranch: string;
        fileTree: string[];
        candidateFiles: RepoFile[];
    }> {
        const { owner, repo } = parseRepoUrl(repoUrl);
        const defaultBranch = await this.getDefaultBranch(owner, repo);
        const tree = await this.getTree(owner, repo, defaultBranch);
        const codePaths = filterCodeFiles(tree.map(t => t.path));
        const ranked = rankFiles(codePaths, tree);
        const topPaths = ranked.slice(0, this.options.maxFiles!);

        const candidateFiles: RepoFile[] = [];
        for (const path of topPaths) {
            try {
                const content = await this.fetchRaw(owner, repo, defaultBranch, path);
                candidateFiles.push({
                    path,
                    language: detectLanguage(path),
                    content: truncate(content, this.options.maxFileChars!),
                });
            } catch (err) {
                console.warn(`[repo-fetcher] skipping ${path}: ${(err as Error).message}`);
            }
        }

        return {
            owner,
            repo,
            defaultBranch,
            fileTree: codePaths,
            candidateFiles,
        };
    }

    private async getDefaultBranch(owner: string, repo: string): Promise<string> {
        const resp = await fetch(`${API_BASE}/repos/${owner}/${repo}`, {
            headers: this.headers,
            dispatcher: this.proxyAgent,
        } as RequestInit & { dispatcher?: ProxyAgent });
        if (!resp.ok) {
            throw new Error(`cannot access repo ${owner}/${repo}: ${resp.status}`);
        }
        const data = await resp.json() as { default_branch?: string };
        return data.default_branch || 'main';
    }

    private async getTree(owner: string, repo: string, branch: string): Promise<GitTreeItem[]> {
        const resp = await fetch(
            `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
            {
                headers: this.headers,
                dispatcher: this.proxyAgent,
            } as RequestInit & { dispatcher?: ProxyAgent }
        );
        if (!resp.ok) {
            throw new Error(`cannot fetch file tree: ${resp.status}`);
        }
        const data = await resp.json() as GitTreeResponse;
        if (data.truncated) {
            console.warn(`[repo-fetcher] file tree truncated, showing ~100k entries`);
        }
        return data.tree.filter(t => t.type === 'blob');
    }

    private async fetchRaw(owner: string, repo: string, branch: string, path: string): Promise<string> {
        const url = `${RAW_BASE}/${owner}/${repo}/${branch}/${path}`;
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'paper-align-agent/0.1' },
                dispatcher: this.proxyAgent,
            } as RequestInit & { dispatcher?: ProxyAgent });
            if (!resp.ok) {
                const statusText = resp.statusText || 'Unknown';
                throw new Error(`fetch failed: ${resp.status} ${statusText} - ${url}`);
            }
            return await resp.text();
        } catch (err) {
            if (err instanceof Error) {
                if (err.message.includes('fetch failed')) {
                    throw err;
                }
                throw new Error(`network error: ${err.message} - ${url}`);
            }
            throw err;
        }
    }
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
    const cleaned = url.trim().replace(/[.,;:!?'")\]}>]+$/, '');
    const match = cleaned.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (!match) {
        throw new Error(`cannot parse GitHub URL: ${url}`);
    }
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

function filterCodeFiles(paths: string[]): string[] {
    const codeExts = ['.py', '.ipynb'];
    const skipDirs = [
        '.git/', 'node_modules/', 'venv/', '.venv/', 'env/',
        '__pycache__/', '.pytest_cache/', '.tox/', 'dist/', 'build/',
        'docs/', 'doc/', 'examples/', 'tutorials/', 'notebooks/',
        'test/', 'tests/', 'testing/',
        'assets/', 'images/', 'data/', 'datasets/',
    ];

    return paths.filter(p => {
        if (!codeExts.some(ext => p.endsWith(ext))) return false;
        if (skipDirs.some(d => p.startsWith(d))) return false;
        if (p.includes('__pycache__')) return false;
        return true;
    });
}

function rankFiles(paths: string[], tree: GitTreeItem[]): string[] {
    const sizeMap = new Map(tree.map(t => [t.path, t.size ?? 0]));

    const keywords = [
        'model', 'models', 'net', 'network', 'arch', 'architecture',
        'loss', 'criterion', 'objective', 'cost',
        'train', 'training', 'trainer', 'train_step', 'learn',
        'solver', 'optimizer', 'optim', 'optimization',
        'dataset', 'data', 'loader', 'dataloader', 'datasets',
        'main', 'run', 'script',
        'layer', 'block', 'module', 'component',
        'attention', 'transformer', 'encoder', 'decoder',
        'config', 'configuration', 'hparams', 'hyper',
        'utils', 'util', 'helper', 'tools',
        'infer', 'inference', 'predict', 'eval', 'evaluate',
        'engine', 'core', 'nn', 'networks',
    ];

    const skipPaths = [
        'test_', '_test', 'tests/', 'testing/',
        'setup.py', 'setup.cfg', 'requirements',
        'conf.py', 'Makefile', 'Dockerfile',
        'README', 'LICENSE', '.gitignore',
    ];

    const scored = paths.map(p => {
        let score = 0;
        const parts = p.split('/');
        const depth = parts.length;
        const fileName = parts.pop() || '';
        const dir = parts.join('/');

        score -= depth * 0.5;

        const lower = p.toLowerCase();
        for (const kw of keywords) {
            if (lower.includes(kw)) score += 3;
        }

        if (/^(model|train|main|run|loss|net|config)\.py$/.test(fileName)) score += 8;
        if (/^__init__\.py$/.test(fileName)) score += 2;
        if (skipPaths.some(s => lower.includes(s))) score -= 10;

        if (/\bsrc\b/.test(dir)) score += 3;
        if (/\b(lib|core|nn|networks)\b/.test(dir)) score += 3;

        const size = sizeMap.get(p) ?? 0;
        if (size > 80000) score -= 3;
        if (size > 150000) score -= 6;
        if (size < 500) score -= 1;
        if (size >= 1000 && size <= 30000) score += 2;

        return { p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.p);
}

function detectLanguage(path: string): string {
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.ipynb')) return 'jupyter';
    return 'unknown';
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + `\n\n# [... truncated, original ${text.length} chars ...]`;
}
