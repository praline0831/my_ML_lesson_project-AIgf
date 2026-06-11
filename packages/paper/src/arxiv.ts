const ARXIV_API = 'http://export.arxiv.org/api/query';

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
  async search(query: string, maxResults: number = 10): Promise<ArxivSearchResult> {
    const searchQuery = query.split(/\s+/).map(term => `all:${term}`).join('+AND+');
    const url = `${ARXIV_API}?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Paper Research Agent)',
          },
        });

        if (response.status === 429 || response.status === 503) {
          const waitSec = Math.min(attempt * 3, 10);
          console.warn(`[ArxivService] ${response.status} 限流，等待 ${waitSec}s 后重试 (${attempt}/${maxRetries})`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue;
        }

        if (!response.ok) {
          throw new Error(`ArXiv API error: ${response.status}`);
        }

        const xmlText = await response.text();
        const papers = parseArxivResponse(xmlText);

        return {
          papers,
          totalResults: papers.length,
          query,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    console.error('[ArxivService] Search failed after retries:', lastError);
    throw lastError ?? new Error('ArXiv search failed');
  }

  async getPaperById(arxivId: string): Promise<ArxivPaper | null> {
    const cleanId = arxivId.replace(/^.*?(abs|papers?\/)/i, '').replace(/v\d+$/, '');
    const url = `${ARXIV_API}?id_list=${cleanId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const xmlText = await response.text();
      const papers = parseArxivResponse(xmlText);
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
