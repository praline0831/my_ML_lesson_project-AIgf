import { Message, MessageType } from './types.js';

/**
 * LLM 提供商接口
 */
export interface LLMProvider {
    /**
     * 生成文本
     * 
     * @param messages 对话历史
     * @param systemPrompt 系统提示词（可选）
     * @returns 生成的文本
     */
    generateText(messages: Message[], systemPrompt?: string): Promise<string>;

    /**
     * 流式生成文本（可选，用于支持流式响应）
     */
    generateStream?(messages: Message[], systemPrompt?: string): ReadableStream<string>;
}

/**
 * LLM 提供商配置
 */
export interface LLMConfig {
    apiKey: string;
    endpoint: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * 基础 LLM 客户端（抽象类）
 */
export abstract class BaseLLMClient implements LLMProvider {
    protected config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
    }

    public async generateText(messages: Message[], systemPrompt?: string): Promise<string> {
        const fullMessages = this.buildMessages(messages, systemPrompt);
        return await this.doGenerate(fullMessages);
    }

    /**
     * 构建完整消息列表（添加 system prompt）
     */
    protected buildMessages(messages: Message[], systemPrompt?: string): Message[] {
        const fullMessages: Message[] = [];

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

    /**
     * 实际调用 LLM 的方法（子类实现）
     */
    protected abstract doGenerate(messages: Message[]): Promise<string>;
}

export interface OllamaConfig extends LLMConfig {
    timeout?: number;
}