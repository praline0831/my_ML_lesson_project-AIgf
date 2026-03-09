import { BaseLLMClient } from '../llm.js';
import { MessageType } from '../types.js';
export class OllamaClient extends BaseLLMClient {
    async doGenerate(messages) {
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
                    stream: false, // 必须加！Ollama 默认流式，非流式需要显式关闭
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
            return data.message.content; // ✅ chat API 返回 data.message.content
        }
        catch (error) {
            console.error('Ollama API 调用错误:', error);
            throw error;
        }
    }
}
//# sourceMappingURL=ollama.js.map