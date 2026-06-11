import { ArxivPaper, arxivService } from './arxiv.js';

export interface ResearchStep {
  round: number;
  query: string;
  papers: ArxivPaper[];
  summary: string;
}

export interface ResearchReport {
  topic: string;
  steps: ResearchStep[];
  allPapers: ArxivPaper[];
  synthesis: string;
  generatedAt: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with',
  'is', 'are', 'be', 'by', 'this', 'that', 'we', 'our', 'it', 'as',
  'from', 'at', 'using', 'into', 'how', 'what', 'why', 'can', 'do',
  'does', 'have', 'has', 'had', 'will', 'would', 'should', 'could',
  '基于', '研究', '方法', '分析', '应用', '一种', '通过', '以及',
]);

function extractKeywords(text: string, max: number = 6): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s一-鿿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));

  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

function dedupPapers(papers: ArxivPaper[]): ArxivPaper[] {
  const seen = new Set<string>();
  const result: ArxivPaper[] = [];
  for (const p of papers) {
    const key = p.id.replace(/v\d+$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}

function generateSubQueries(topic: string, keywords: string[]): string[] {
  return [
    topic,
    keywords.slice(0, 4).join(' '),
    `${topic} survey`,
    `${topic} review`,
    `${topic} recent advances`,
  ];
}

function synthesizeReport(topic: string, steps: ResearchStep[], papers: ArxivPaper[]): string {
  const lines: string[] = [];

  lines.push(`📚 主题：${topic}`);
  lines.push(`🔍 检索到 ${papers.length} 篇相关论文\n`);

  const groupedByYear = new Map<string, ArxivPaper[]>();
  for (const p of papers) {
    const year = p.published.slice(0, 4);
    if (!groupedByYear.has(year)) groupedByYear.set(year, []);
    groupedByYear.get(year)!.push(p);
  }

  const years = Array.from(groupedByYear.keys()).sort().reverse();
  lines.push('📅 时间分布：');
  for (const y of years) {
    lines.push(`   ${y}: ${groupedByYear.get(y)!.length} 篇`);
  }
  lines.push('');

  const allAuthors = new Map<string, number>();
  for (const p of papers) {
    for (const a of p.authors) {
      allAuthors.set(a, (allAuthors.get(a) ?? 0) + 1);
    }
  }
  const topAuthors = Array.from(allAuthors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topAuthors.length > 0) {
    lines.push('👥 高产作者：');
    for (const [a, c] of topAuthors) {
      lines.push(`   ${a} (${c} 篇)`);
    }
    lines.push('');
  }

  const allCats = new Map<string, number>();
  for (const p of papers) {
    for (const c of p.categories) {
      allCats.set(c, (allCats.get(c) ?? 0) + 1);
    }
  }
  const topCats = Array.from(allCats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topCats.length > 0) {
    lines.push('🏷️ 主要分类：');
    lines.push(`   ${topCats.map(([c, n]) => `${c}(${n})`).join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

export class DeepResearchService {
  async research(
    topic: string,
    rounds: number = 3,
    perRound: number = 8,
    onProgress?: (step: ResearchStep) => void
  ): Promise<ResearchReport> {
    const keywords = extractKeywords(topic);
    const subQueries = generateSubQueries(topic, keywords).slice(0, rounds);

    const steps: ResearchStep[] = [];
    let allPapers: ArxivPaper[] = [];

    for (let i = 0; i < subQueries.length; i++) {
      const q = subQueries[i]!;
      try {
        if (onProgress) {
          onProgress({
            round: i + 1,
            query: q,
            papers: [],
            summary: `🔍 第 ${i + 1}/${subQueries.length} 轮开始检索: "${q}"`,
          });
        }

        let result;
        try {
          result = await arxivService.search(q, perRound);
        } catch (searchErr) {
          const errMsg = searchErr instanceof Error ? searchErr.message : String(searchErr);
          if (errMsg.includes('429') || errMsg.includes('503')) {
            if (onProgress) {
              onProgress({
                round: i + 1,
                query: q,
                papers: [],
                summary: `⏳ ArXiv 限流 (${errMsg})，等待 8 秒后跳过此轮...`,
              });
            }
            await new Promise(r => setTimeout(r, 8000));
            continue;
          }
          throw searchErr;
        }

        const uniquePapers = dedupPapers(result.papers);

        const summary = `✅ 第 ${i + 1} 轮检索 "${q}"：找到 ${result.totalResults} 篇，新增 ${uniquePapers.length} 篇去重后论文`;

        const step: ResearchStep = {
          round: i + 1,
          query: q,
          papers: uniquePapers,
          summary,
        };
        steps.push(step);
        allPapers = dedupPapers([...allPapers, ...uniquePapers]);

        if (onProgress) onProgress(step);

        if (i < subQueries.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
        const step: ResearchStep = {
          round: i + 1,
          query: q,
          papers: [],
          summary: `❌ 第 ${i + 1} 轮检索失败: ${e instanceof Error ? e.message : String(e)}`,
        };
        steps.push(step);
        if (onProgress) onProgress(step);
      }
    }

    const synthesis = synthesizeReport(topic, steps, allPapers);

    return {
      topic,
      steps,
      allPapers,
      synthesis,
      generatedAt: Date.now(),
    };
  }
}

export const deepResearchService = new DeepResearchService();
