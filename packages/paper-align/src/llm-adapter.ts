/**
 * 把外部的 LLMProvider（runtime 包 / OpenAI / 任意实现）适配成 paper-align 内部的 LLMClient
 *
 * 目的：让 paper-align agent 和 chat agent 共用同一个 LLM 实例
 *   - 模型名 / 温度 / endpoint 永远一致
 *   - 改一处即可
 */

import { ChatMessage, LLMClient } from './llm-client.js';

/**
 * 外部 LLM 最小化接口（duck typing，兼容 runtime 的 LLMProvider）
 */
export interface ExternalChatMessage {
    type: string; // 'human' | 'ai' | 'system' | 'tool' 等
    content: string;
}

export interface ExternalLLMProvider {
    generateText(messages: ExternalChatMessage[], systemPrompt?: string): Promise<string>;
    generateStream?(messages: ExternalChatMessage[], systemPrompt?: string): AsyncIterable<string>;
}

/**
 * 适配器：把 LLMProvider 包装成 LLMClient
 *
 * - 忽略 jsonMode 参数（外部 provider 自己处理）
 * - 把 paper-align 的 {role} 消息格式转成外部的 {type} 格式
 */
export class LLMProviderAdapter extends LLMClient {
    constructor(
        private external: ExternalLLMProvider,
        modelName: string = 'external'
    ) {
        // 占位 config，实际不会用
        super({ endpoint: 'adapter://external', model: modelName, apiKey: 'adapter' });
    }

    /**
     * 覆盖父类 chat 方法，直接走外部 provider
     * jsonMode = true 时，在 system prompt 里加 JSON 约束
     * 注意：Ollama 不支持 response_format，所以必须用 prompt 指令
     */
    async chat(messages: ChatMessage[], jsonMode: boolean = false): Promise<string> {
        const systemMsg = messages.find(m => m.role === 'system');
        const systemPrompt = systemMsg?.content ?? '';

        const converted: ExternalChatMessage[] = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                type: m.role === 'assistant' ? 'ai' : 'human',
                content: m.content,
            }));

        // jsonMode = true → 在 system prompt 末尾追加 JSON 约束
        const finalSystem = jsonMode
            ? `${systemPrompt}\n\nIMPORTANT: You must respond with ONLY valid JSON matching the schema. No markdown, no explanation, no text outside the JSON object.`.trim()
            : systemPrompt;

        return await this.external.generateText(converted, finalSystem || undefined);
    }
}
