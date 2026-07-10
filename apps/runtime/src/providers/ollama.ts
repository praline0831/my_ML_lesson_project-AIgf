import { BaseLLMClient } from '../llm.js';
import { Message, MessageType } from '../types.js';

export class OllamaClient extends BaseLLMClient {
    protected async doGenerate(messages: Message[]): Promise<string> {
        try {
            const messagesPayload = messages.map((msg) => {
                let role = 'assistant';
                if (msg.type === MessageType.System) role = 'system';
                else if (msg.type === MessageType.Human) role = 'user';
                return { role, content: msg.content };
            });

            const response = await fetch(`${this.config.endpoint}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: messagesPayload,
                    stream: false,
                    options: {
                        temperature: this.config.temperature ?? 0.7,
                        num_predict: this.config.maxTokens ?? 2048,
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama API 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            return data.message.content;
        } catch (error) {
            console.error('Ollama API 调用错误:', error);
            throw error;
        }
    }

    public async *generateStream(messages: Message[], systemPrompt?: string): AsyncIterable<string> {
        const fullMessages = this.buildMessages(messages, systemPrompt);
        yield* this.doGenerateStream(fullMessages);
    }

    protected async *doGenerateStream(messages: Message[]): AsyncIterable<string> {
        try {
            const messagesPayload = messages.map((msg) => {
                let role = 'assistant';
                if (msg.type === MessageType.System) role = 'system';
                else if (msg.type === MessageType.Human) role = 'user';
                return { role, content: msg.content };
            });

            const response = await fetch(`${this.config.endpoint}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: messagesPayload,
                    stream: true,
                    options: {
                        temperature: this.config.temperature ?? 0.7,
                        num_predict: this.config.maxTokens ?? 2048,
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama API 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('响应体为空');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                    } catch (e) {
                        // 忽略无效 JSON
                    }
                }
            }
        } catch (error) {
            console.error('Ollama 流式 API 调用错误:', error);
            throw error;
        }
    }
}