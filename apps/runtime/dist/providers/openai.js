import { BaseLLMClient } from '../llm.js';
export class OpenAIClient extends BaseLLMClient {
    constructor(config) {
        super(config);
    }
    async doGenerate(messages) {
        // 实际实现中，这里调用 OpenAI API
        // 暂用模拟响应
        const lastMessage = messages[messages.length - 1];
        return `我收到了你的消息: "${lastMessage.content}"（模拟 OpenAI 回复）`;
    }
}
//# sourceMappingURL=openai.js.map