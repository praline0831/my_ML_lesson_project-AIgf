import { MessageType } from './types.js';
/**
 * 基础 LLM 客户端（抽象类）
 */
export class BaseLLMClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async generateText(messages, systemPrompt) {
        const fullMessages = this.buildMessages(messages, systemPrompt);
        return await this.doGenerate(fullMessages);
    }
    /**
     * 构建完整消息列表（添加 system prompt）
     */
    buildMessages(messages, systemPrompt) {
        const fullMessages = [];
        // 添加系统提示
        if (systemPrompt) {
            fullMessages.push({
                type: MessageType.AI,
                content: systemPrompt,
                timestamp: Date.now()
            });
        }
        // 添加历史消息
        fullMessages.push(...messages);
        return fullMessages;
    }
}
//# sourceMappingURL=llm.js.map