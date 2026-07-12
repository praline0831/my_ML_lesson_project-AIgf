export interface LLMConfig {
    endpoint: string;
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
    supportsJsonMode?: boolean;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class LLMClient {
    constructor(private config: LLMConfig) { }

    async chat(messages: ChatMessage[], jsonMode: boolean = false, temperature?: number): Promise<string> {
        const url = `${this.config.endpoint.replace(/\/$/, '')}/chat/completions`;

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages,
            temperature: temperature ?? this.config.temperature ?? 0.5,
            max_tokens: this.config.maxTokens ?? 8192,
        };

        if (jsonMode && this.config.supportsJsonMode !== false) {
            body.response_format = { type: 'json_object' };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`LLM request failed: ${response.status} ${err}`);
        }

        const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('LLM returned empty response');
        }
        return content;
    }

    async chatJson<T = unknown>(messages: ChatMessage[], temperature?: number): Promise<T> {
        const text = await this.chat(messages, true, temperature);
        return extractJson<T>(text);
    }
}

function repairJson(raw: string): string {
    let s = raw;
    // remove content after last complete } object (truncated junk)
    const lastCloser = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (lastCloser > 0 && lastCloser < s.length - 1) {
        s = s.slice(0, lastCloser + 1);
    }
    // fix stray " after } in array: }"  ->  }
    s = s.replace(/\}"(?!\s*[,:\]\}])/g, '}');
    // fix stray quotes between array elements: }," {  ->  },{
    s = s.replace(/},"\s*\{/g, '},{');
    s = s.replace(/},"\s*$/g, '}');
    // fix stray " before { in array context
    s = s.replace(/,\s*"\s*\{/g, ',{');
    // fix stray closing paren after string: "text"),  ->  "text",
    s = s.replace(/"\)\s*[,:\]\}]/g, '",');
    s = s.replace(/"\)\s*$/g, '"');
    // fix stray closing paren before , or } or ]
    s = s.replace(/\)\s*[,}\]]/g, (m) => m.replace(/\)/, ''));
    // trim trailing non-JSON (incomplete last string etc.)
    // if the last complete value ends with a dangling string, trim it
    s = s.replace(/,"[^"]*$/g, '');
    // count and balance braces/brackets
    const openBraces = (s.match(/\{/g) || []).length;
    const closeBraces = (s.match(/\}/g) || []).length;
    const openBrackets = (s.match(/\[/g) || []).length;
    const closeBrackets = (s.match(/\]/g) || []).length;
    if (openBraces > closeBraces) s += '}'.repeat(openBraces - closeBraces);
    if (openBrackets > closeBrackets) s += ']'.repeat(openBrackets - closeBrackets);
    return s;
}

export function extractJson<T>(text: string): T {
    let trimmed = text.trim();

    // 如果 LLM 用了 ```json 前缀但没有闭合标签，直接去掉前缀
    const jsonPrefix = trimmed.match(/^```(?:json)?\s*/);
    if (jsonPrefix) {
        trimmed = trimmed.slice(jsonPrefix[0].length);
    }

    try {
        return JSON.parse(trimmed) as T;
    } catch {
    }

    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
        const candidate = repairJson(codeBlock[1].trim());
        try {
            return JSON.parse(candidate) as T;
        } catch {
        }
    }

    // try extracting from first { to last }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        let candidate = repairJson(trimmed.slice(firstBrace, lastBrace + 1));

        try {
            return JSON.parse(candidate) as T;
        } catch {
        }
    }

    // handle bare array: [...] when code expected {"key": [...]}
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        let candidate = repairJson(trimmed.slice(firstBracket, lastBracket + 1));
        try {
            return JSON.parse(candidate) as T;
        } catch {
        }
    }

    throw new Error(`cannot parse JSON from LLM output:\n${text.slice(0, 500)}`);
}

export function defaultLLMClient(): LLMClient {
    const endpoint = process.env.LLM_ENDPOINT || 'http://localhost:11434/v1';
    const model = process.env.LLM_MODEL || 'gemma4:31b-cloud';
    const apiKey = process.env.LLM_API_KEY || 'ollama';

    const supportsJsonMode = process.env.LLM_SUPPORTS_JSON_MODE
        ? process.env.LLM_SUPPORTS_JSON_MODE !== 'false'
        : !endpoint.includes('localhost') && !endpoint.includes('11434');

    return new LLMClient({ endpoint, model, apiKey, supportsJsonMode });
}
