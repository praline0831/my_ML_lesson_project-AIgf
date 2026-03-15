import { BaseLLMClient } from '../llm.js';
import { Message } from '../types.js';
export declare class OllamaClient extends BaseLLMClient {
    protected doGenerate(messages: Message[]): Promise<string>;
    /**
     * 流式生成：返回 ReadableStream，每 chunk 为一段文本
     */
    generateStream(messages: Message[], systemPrompt?: string): ReadableStream<string>;
}
//# sourceMappingURL=ollama.d.ts.map