/**
 * 极简 LLM 客户端
 *
 * 适配 OpenAI 兼容接口（OpenAI / DeepSeek / Ollama / vLLM 等都可用）
 * 设计目标：让对齐 agent 不依赖 runtime 包，可以独立 npm test
 */

export interface LLMConfig {
    /** 接口地址，例如 https://api.openai.com/v1 或 http://localhost:11434/v1 */
    endpoint: string;
    /** 模型名 */
    model: string;
    /** API Key（Ollama 可填 "ollama"） */
    apiKey: string;
    /** 温度，越低越稳定（对齐任务建议 0.1-0.3） */
    temperature?: number;
    /** 最大输出 token */
    maxTokens?: number;
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

        if (jsonMode) {
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
            throw new Error(`LLM 请求失败: ${response.status} ${err}`);
        }

        const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('LLM 返回为空');
        }
        return content;
    }

    /**
     * 便捷方法：让 LLM 返回 JSON 对象
     * 内部会做轻量 JSON 提取（兼容模型在 ```json ``` 块中输出的情况）
     */
    async chatJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
        const text = await this.chat(messages, true);
        return extractJson<T>(text);
    }
}

/**
 * 从模型输出中提取 JSON
 * - 优先尝试整体解析
 * - 失败则尝试抽取 ``` json ... ``` 代码块
 * - 再失败则尝试抽取第一个 {...} 块
 * - 如果 {...} 块解析失败且末尾不完整，尝试智能补全再解析
 */
export function extractJson<T>(text: string): T {
    const trimmed = text.trim();

    // 策略1: 直接解析
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        // 继续尝试
    }

    // 策略2: 抽 ``` json ... ``` 或 ``` ... ```
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
        try {
            return JSON.parse(codeBlock[1].trim()) as T;
        } catch {
            // 继续尝试
        }
    }

    // 策略3: 抽第一个 { ... } 块并智能补全
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        let candidate = trimmed.slice(firstBrace, lastBrace + 1);

        // 先直接试一次
        try {
            return JSON.parse(candidate) as T;
        } catch {
            // 继续尝试补全
        }

        // 补全缺失的闭合符号（模型输出被截断时常见，比如 max_tokens 不够）
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
                // fallthrough to error
            }
        }
    }

    throw new Error(`无法从 LLM 输出解析 JSON:\n${text.slice(0, 500)}`);
}

/**
 * 默认客户端：从环境变量构造
 *
 * 支持的环境变量：
 *   LLM_ENDPOINT  e.g. https://api.openai.com/v1
 *   LLM_MODEL     e.g. gpt-4o-mini
 *   LLM_API_KEY   e.g. sk-xxx
 */
export function defaultLLMClient(): LLMClient {
    const endpoint = process.env.LLM_ENDPOINT || 'http://localhost:11434/v1';
    const model = process.env.LLM_MODEL || 'gemma4:31b-cloud';
    const apiKey = process.env.LLM_API_KEY || 'ollama';

    return new LLMClient({ endpoint, model, apiKey });
}
