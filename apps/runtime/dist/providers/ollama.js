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
        }
        catch (error) {
            console.error('Ollama API 调用错误:', error);
            throw error;
        }
    }
    /**
     * 流式生成：返回 ReadableStream，每 chunk 为一段文本
     */
    generateStream(messages, systemPrompt) {
        const fullMessages = this.buildMessages(messages, systemPrompt);
        const messagesPayload = fullMessages.map((msg) => ({
            role: msg.type === MessageType.Human ? 'user' : 'assistant',
            content: msg.content,
        }));
        const self = this;
        return new ReadableStream({
            async start(controller) {
                try {
                    const response = await fetch(`${self.config.endpoint}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: self.config.model,
                            messages: messagesPayload,
                            stream: true,
                            options: {
                                temperature: self.config.temperature ?? 0.7,
                                num_predict: self.config.maxTokens ?? 2048,
                            },
                        }),
                    });
                    if (!response.ok) {
                        const err = await response.text();
                        controller.error(new Error(`Ollama API 请求失败: ${response.status} - ${err}`));
                        return;
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed)
                                continue;
                            try {
                                const data = JSON.parse(trimmed);
                                const content = data.message?.content;
                                if (typeof content === 'string' && content) {
                                    controller.enqueue(content);
                                }
                            }
                            catch {
                                // 忽略非 JSON 行
                            }
                        }
                    }
                    controller.close();
                }
                catch (e) {
                    controller.error(e);
                }
            },
        });
    }
}
//# sourceMappingURL=ollama.js.map