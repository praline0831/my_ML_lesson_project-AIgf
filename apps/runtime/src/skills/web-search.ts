/**
 * web-search skill
 *
 * 使用 DuckDuckGo 的 Instant Answer API（无需 API key、免费）。
 * 如果环境无网络或被拦截，抛错让上层处理。
 *
 * 注册示例：
 *   agent.registerSkill(webSearchSkill);
 *   agent.activateSkill('web_search');
 */

import { Skill } from './types.js';

interface DuckDuckGoResponse {
  Abstract?: string;
  AbstractText?: string;
  AbstractURL?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionURL?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
  Redirect?: string;
}

export const webSearchSkill: Skill = {
  name: 'web_search',
  description: '在互联网上搜索信息，适合回答事实性 / 时效性问题。',
  enabledByDefault: false,
  instructions: `当用户提出事实性问题、最新信息、或你不确定的知识时，优先使用 web_search。
请用如下格式调用：
<skill>{"name":"web_search","args":{"query":"<搜索关键词>"}}</skill>`,
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词', required: true },
  ],
  execute: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) {
      throw new Error('web_search: query 不能为空');
    }

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      query
    )}&format=json&no_html=1&skip_disambig=1&t=my_project`;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(
        `web_search: 网络请求失败 - ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (!resp.ok) {
      throw new Error(`web_search: HTTP ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as DuckDuckGoResponse;

    // 汇总结果：优先 Abstract/Answer/Definition，再补充 RelatedTopics
    const parts: string[] = [];
    if (data.AbstractText) {
      parts.push(`摘要: ${data.AbstractText}`);
      if (data.AbstractURL) parts.push(`来源: ${data.AbstractURL}`);
    }
    if (data.Answer) {
      parts.push(`直接答案: ${data.Answer} (${data.AnswerType ?? 'unknown'})`);
    }
    if (data.Definition) {
      parts.push(`定义: ${data.Definition}`);
      if (data.DefinitionURL) parts.push(`来源: ${data.DefinitionURL}`);
    }
    if (data.RelatedTopics) {
      const topics = data.RelatedTopics.slice(0, 5)
        .map((t) => t.Text)
        .filter((t): t is string => !!t);
      if (topics.length > 0) {
        parts.push(`相关主题:\n${topics.map((t) => `  - ${t}`).join('\n')}`);
      }
    }

    if (parts.length === 0) {
      return `未找到关于 "${query}" 的相关信息。`;
    }
    return parts.join('\n');
  },
};
