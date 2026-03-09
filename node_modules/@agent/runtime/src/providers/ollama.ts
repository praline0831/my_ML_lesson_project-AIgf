import { BaseLLMClient } from '../llm.js';
import { Message, MessageType } from '../types.js';

export class OllamaClient extends BaseLLMClient {
    protected async doGenerate(messages: Message[]): Promise<string> {
        try {
            const messagesPayload = messages.map((msg) => ({
                role: msg.type === MessageType.Human ? 'user' : 'assistant',
                content: msg.content,
            }));

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
}