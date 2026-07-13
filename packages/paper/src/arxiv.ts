// 使用 HTTPS 端点（支持代理）
const ARXIV_API = 'https://export.arxiv.org/api/query';

// 配置代理支持（Node.js 18+ 需要显式设置）
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  console.log(`[ArxivService] 使用代理: ${proxyUrl}`);
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

// arXiv 要求：请求间隔 ≥ 3秒，User-Agent 包含联系邮箱
const MIN_REQUEST_INTERVAL_MS = 3500;
let lastRequestTime = 0;

// 简单的内存缓存（5分钟有效）
const cache = new Map<string, { data: ArxivSearchResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  pdfUrl: string;
  comment?: string;
}

export interface ArxivSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  query: string;
}

function parseArxivResponse(xmlText: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

  for (const entry of entries) {
    const getTag = (tag: string): string => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return match ? match[1].trim().replace(/<\/?[^>]+>/gi, '') : '';
    };

    const id = getTag('id');
    const title = getTag('title');
    const authors = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/gi)
      ?.map(a => a.replace(/<author>[\s\S]*?<name>/i, '').replace(/<\/name>[\s\S]*?<\/author>/i, '')) || [];
    const abstractText = getTag('summary');
    const published = getTag('published');
    const updated = getTag('updated');
    const categories = entry.match(/<category[^>]*term="([^"]*)"[^>]*>/gi)
      ?.map(c => c.match(/term="([^"]*)"/)?.[1] ?? '') || [];
    const pdfUrl = id.replace('http://arxiv.org/abs', 'http://arxiv.org/pdf') + '.pdf';
    const comment = getTag('arxiv:comment');

    papers.push({
      id,
      title: title.replace(/\s+/g, ' '),
      authors,
      abstract: abstractText.replace(/\s+/g, ' '),
      published,
      updated,
      categories,
      pdfUrl,
      comment: comment || undefined,
    });
  }

  return papers;
}

export class ArxivService {
  /**
   * 确保 arXiv API 请求间隔 ≥ 3 秒（遵守官方要求）
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      const wait = MIN_REQUEST_INTERVAL_MS - elapsed;
      await new Promise(r => setTimeout(r, wait));
    }
    lastRequestTime = Date.now();
  }

  /**
   * 生成规范的 User-Agent（arXiv 要求包含联系邮箱）
   */
  private getUserAgent(): string {
    // 格式：应用名/版本 (联系邮箱)
    // 如无配置，使用占位邮箱
    const email = process.env.ARXIV_CONTACT_EMAIL || 'research-agent@example.com';
    return `PaperResearchAgent/1.0 (${email})`;
  }

  async search(query: string, maxResults: number = 10): Promise<ArxivSearchResult> {
    const cacheKey = `${query}:${maxResults}`;

    // 检查缓存
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      console.log(`[ArxivService] 命中缓存: "${query}"`);
      return cached.data;
    }

    const searchQuery = query.split(/\s+/).map(term => `all:${term}`).join('+AND+');
    const url = `${ARXIV_API}?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 遵守 arXiv 请求间隔
        await this.enforceRateLimit();

        const response = await fetch(url, {
          headers: {
            'User-Agent': this.getUserAgent(),
          },
        });

        if (response.status === 429 || response.status === 503) {
          // 429/503: 使用指数退避 + 更长等待
          const baseWait = 10; // 基础等待 10 秒
          const waitSec = baseWait + (attempt - 1) * 5; // 10s, 15s, 20s
          console.warn(`[ArxivService] ${response.status} 限流，等待 ${waitSec}s 后重试 (${attempt}/${maxRetries})`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue;
        }

        if (!response.ok) {
          throw new Error(`ArXiv API error: ${response.status}`);
        }

        const xmlText = await response.text();
        const papers = parseArxivResponse(xmlText);

        const result: ArxivSearchResult = {
          papers,
          totalResults: papers.length,
          query,
        };

        // 存入缓存
        cache.set(cacheKey, { data: result, ts: Date.now() });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          // 失败后等待更长时间
          await new Promise(r => setTimeout(r, 3000 * attempt));
        }
      }
    }

    console.error('[ArxivService] Search failed after retries:', lastError);
    throw lastError ?? new Error('ArXiv search failed');
  }

  async getPaperById(arxivId: string): Promise<ArxivPaper | null> {
    const cleanId = arxivId.replace(/^.*?(abs|papers?\/)/i, '').replace(/v\d+$/, '');
    const cacheKey = `id:${cleanId}`;

    // 检查缓存
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data.papers[0] || null;
    }

    const url = `${ARXIV_API}?id_list=${cleanId}`;

    try {
      // 遵守请求间隔
      await this.enforceRateLimit();

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.getUserAgent(),
        },
      });
      if (!response.ok) {
        return null;
      }

      const xmlText = await response.text();
      const papers = parseArxivResponse(xmlText);

      // 存入缓存
      cache.set(cacheKey, { data: { papers, totalResults: papers.length, query: cleanId }, ts: Date.now() });

      return papers[0] || null;
    } catch (error) {
      console.error('[ArxivService] Get paper failed:', error);
      return null;
    }
  }

  formatPaperBrief(paper: ArxivPaper): string {
    return [
      `📄 **${paper.title}**`,
      `👤 ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' et al.' : ''}`,
      `📅 ${paper.published.split('T')[0]}`,
      `🏷️ ${paper.categories.slice(0, 3).join(', ')}`,
      `🔗 ${paper.id}`,
      '',
      `**Abstract:** ${paper.abstract.slice(0, 300)}${paper.abstract.length > 300 ? '...' : ''}`,
    ].join('\n');
  }
}

export const arxivService = new ArxivService();
