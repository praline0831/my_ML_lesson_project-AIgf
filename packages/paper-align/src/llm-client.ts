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

    async chat(messages: ChatMessage[], jsonMode: boolean = false): Promise<string> {
        const url = `${this.config.endpoint.replace(/\/$/, '')}/chat/completions`;

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages,
            temperature: this.config.temperature ?? 0.2,
            max_tokens: this.config.maxTokens ?? 2048,
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

    async chatJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
        const text = await this.chat(messages, true);
        return extractJson<T>(text);
    }
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
        try {
            return JSON.parse(codeBlock[1].trim()) as T;
        } catch {
        }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        let candidate = trimmed.slice(firstBrace, lastBrace + 1);

        try {
            return JSON.parse(candidate) as T;
        } catch {
        }

        const openBraces = (candidate.match(/\{/g) || []).length;
        const closeBraces = (candidate.match(/\}/g) || []).length;
        const openBrackets = (candidate.match(/\[/g) || []).length;
        const closeBrackets = (candidate.match(/\]/g) || []).length;

        const missingBraces = openBraces - closeBraces;
        const missingBrackets = openBrackets - closeBrackets;

        if (missingBraces > 0 || missingBrackets > 0) {
            const suffix = '}'.repeat(Math.max(0, missingBraces)) + ']'.repeat(Math.max(0, missingBrackets));
            candidate += suffix;
            try {
                return JSON.parse(candidate) as T;
            } catch {
            }
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
