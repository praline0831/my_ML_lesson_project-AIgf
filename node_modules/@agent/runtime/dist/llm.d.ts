import { Message } from './types.js';
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
export declare abstract class BaseLLMClient implements LLMProvider {
    protected config: LLMConfig;
    constructor(config: LLMConfig);
    generateText(messages: Message[], systemPrompt?: string): Promise<string>;
    /**
     * 构建完整消息列表（添加 system prompt）
     */
    protected buildMessages(messages: Message[], systemPrompt?: string): Message[];
    /**
     * 实际调用 LLM 的方法（子类实现）
     */
    protected abstract doGenerate(messages: Message[]): Promise<string>;
}
export interface OllamaConfig extends LLMConfig {
    timeout?: number;
}
//# sourceMappingURL=llm.d.ts.map