/**
 * GitHub 仓库抓取器
 *
 * 策略：
 *   1. 解析 owner/repo + 默认分支
 *   2. 用 Git Trees API 拉完整文件树（递归）
 *   3. 启发式过滤 + 让 LLM 选"关键文件"
 *   4. 用 raw.githubusercontent.com 拉文件原文
 *
 * 注：未鉴权也能用，但有 60 req/h 限制。生产可加 GITHUB_TOKEN。
 */

import type { RepoFile } from './types.js';

const RAW_BASE = 'https://raw.githubusercontent.com';
const API_BASE = 'https://api.github.com';

export interface RepoFetcherOptions {
    /** 拉取单个文件的最大字符数（默认 20000） */
    maxFileChars?: number;
    /** 最多拉取多少个候选文件（默认 12） */
    maxFiles?: number;
    /** GitHub Token（可选） */
    token?: string;
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

    constructor(private options: RepoFetcherOptions = {}) {
        this.options = { maxFileChars: 20000, maxFiles: 12, ...options };
        this.headers = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'paper-align-agent/0.1',
        };
        if (options.token) {
            this.headers.Authorization = `Bearer ${options.token}`;
        }
    }

    /**
     * 主入口：拉仓库 + 候选文件
     * 注意：函数级提取不在这里做，由 key-function-selector 处理
     */
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
                console.warn(`[repo-fetcher] 跳过 ${path}: ${(err as Error).message}`);
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
        const resp = await fetch(`${API_BASE}/repos/${owner}/${repo}`, { headers: this.headers });
        if (!resp.ok) {
            throw new Error(`无法访问仓库 ${owner}/${repo}: ${resp.status}`);
        }
        const data = await resp.json() as { default_branch?: string };
        return data.default_branch || 'main';
    }

    private async getTree(owner: string, repo: string, branch: string): Promise<GitTreeItem[]> {
        const resp = await fetch(
            `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
            { headers: this.headers }
        );
        if (!resp.ok) {
            throw new Error(`无法获取文件树: ${resp.status}`);
        }
        const data = await resp.json() as GitTreeResponse;
        if (data.truncated) {
            console.warn(`[repo-fetcher] 警告：文件树被截断，仅展示前 ~100k 条`);
        }
        return data.tree.filter(t => t.type === 'blob');
    }

    private async fetchRaw(owner: string, repo: string, branch: string, path: string): Promise<string> {
        const url = `${RAW_BASE}/${owner}/${repo}/${branch}/${path}`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'paper-align-agent/0.1' },
        });
        if (!resp.ok) {
            throw new Error(`拉取失败: ${resp.status}`);
        }
        return await resp.text();
    }
}

/**
 * 解析 owner/repo
 * 支持：https://github.com/owner/repo  /  https://github.com/owner/repo.git
 * 修复：贪心正则会吃末尾标点（.,;:!?'"），需要剥掉再解析
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
    // 先剥掉末尾的句末标点，避免 microsoft/LoRA. 这种情况
    const cleaned = url.trim().replace(/[.,;:!?'")\]}>]+$/, '');
    const match = cleaned.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (!match) {
        throw new Error(`无法解析 GitHub URL: ${url}`);
    }
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * 过滤出"代码相关"文件
 * 策略：白名单后缀 + 排除常见无关目录
 */
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

/**
 * 给文件排序：入口/核心文件靠前
 * 评分：
 *   + 路径短 → 顶层优先
 *   + 名字匹配核心关键词（model/loss/train/net/dataset/...）
 *   + README 中常被引用的（main.py / train.py / run.py）
 */
function rankFiles(paths: string[], tree: GitTreeItem[]): string[] {
    const sizeMap = new Map(tree.map(t => [t.path, t.size ?? 0]));

    const keywords = [
        'model', 'models', 'net', 'network', 'arch',
        'loss', 'criterion', 'objective',
        'train', 'training', 'trainer',
        'solver', 'optimizer', 'optim',
        'dataset', 'data', 'loader',
        'main', 'run', 'script',
    ];

    const scored = paths.map(p => {
        let score = 0;
        const depth = p.split('/').length;
        score -= depth; // 越浅越优先

        const lower = p.toLowerCase();
        for (const kw of keywords) {
            if (lower.includes(kw)) score += 3;
        }

        const fileName = p.split('/').pop() || '';
        if (/^(main|train|run)\.py$/.test(fileName)) score += 5;

        // 文件大小惩罚：太大不好读
        const size = sizeMap.get(p) ?? 0;
        if (size > 50000) score -= 2;
        if (size > 100000) score -= 5;
        if (size < 1000) score -= 1;

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
