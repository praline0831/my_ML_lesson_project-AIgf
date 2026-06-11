import type { ArxivPaper } from './arxiv.js';
import type { ResearchReport } from './deep-research.js';

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function paperToMarkdown(paper: ArxivPaper, index?: number): string {
  const lines: string[] = [];
  const prefix = index !== undefined ? `### ${index + 1}. ` : '### ';

  lines.push(`${prefix}[${paper.title}](${paper.id})`);
  lines.push('');
  lines.push(`- **作者**: ${paper.authors.join(', ')}`);
  lines.push(`- **发布日期**: ${paper.published.slice(0, 10)}`);
  lines.push(`- **分类**: ${paper.categories.join(', ')}`);
  lines.push(`- **PDF**: [下载](${paper.pdfUrl})`);
  lines.push(`- **链接**: ${paper.id}`);
  lines.push('');
  lines.push('**摘要**:');
  lines.push('');
  lines.push(`> ${paper.abstract.replace(/\n/g, '\n> ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

export function generateResearchReport(report: ResearchReport): string {
  const lines: string[] = [];

  lines.push(`# 📚 深度研究报告：${report.topic}`);
  lines.push('');
  lines.push(`> 生成时间: ${formatDate(report.generatedAt)}`);
  lines.push(`> 共检索到 **${report.allPapers.length}** 篇相关论文`);
  lines.push('');

  lines.push('## 📊 统计分析');
  lines.push('');
  lines.push('```');
  lines.push(report.synthesis);
  lines.push('```');
  lines.push('');

  lines.push('## 🔍 检索过程');
  lines.push('');
  for (const step of report.steps) {
    lines.push(`### 第 ${step.round} 轮：${step.query}`);
    lines.push('');
    lines.push(`- ${step.summary}`);
    lines.push(`- 本轮检索到 ${step.papers.length} 篇论文`);
    lines.push('');
  }
  lines.push('');

  lines.push('## 📑 论文清单');
  lines.push('');
  report.allPapers.forEach((p, i) => {
    lines.push(paperToMarkdown(p, i));
  });

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*本文档由论文研究助手自动生成*`);
  lines.push('');

  return lines.join('\n');
}

export interface PaperAnalysis {
  paper: ArxivPaper;
  question: string;
  analysis: string;
  analyzedAt: number;
}

export function generateAnalysisDoc(
  items: PaperAnalysis[],
  topic: string = '论文分析'
): string {
  const lines: string[] = [];

  lines.push(`# 📖 ${topic}`);
  lines.push('');
  lines.push(`> 生成时间: ${formatDate(Date.now())}`);
  lines.push(`> 共分析 **${items.length}** 段对话`);
  lines.push('');

  items.forEach((item, i) => {
    lines.push(`## 💬 对话 ${i + 1}`);
    lines.push('');
    lines.push(`**问题**: ${item.question}`);
    lines.push('');
    lines.push(`**分析时间**: ${formatDate(item.analyzedAt)}`);
    lines.push('');
    lines.push('### 论文信息');
    lines.push('');
    lines.push(paperToMarkdown(item.paper));
    lines.push('');
    lines.push('### AI 分析');
    lines.push('');
    lines.push(item.analysis);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  lines.push(`*本文档由论文研究助手自动生成*`);
  lines.push('');

  return lines.join('\n');
}

export function generateSearchResultDoc(
  query: string,
  papers: ArxivPaper[]
): string {
  const lines: string[] = [];

  lines.push(`# 🔍 搜索结果：${query}`);
  lines.push('');
  lines.push(`> 生成时间: ${formatDate(Date.now())}`);
  lines.push(`> 共找到 **${papers.length}** 篇论文`);
  lines.push('');

  papers.forEach((p, i) => {
    lines.push(paperToMarkdown(p, i));
  });

  lines.push('');
  lines.push(`*本文档由论文研究助手自动生成*`);
  lines.push('');

  return lines.join('\n');
}

export function downloadAsFile(content: string, filename: string): Buffer {
  return Buffer.from(content, 'utf-8');
}
