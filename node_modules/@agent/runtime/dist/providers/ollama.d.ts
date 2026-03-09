import { BaseLLMClient } from '../llm.js';
import { Message } from '../types.js';
export declare class OllamaClient extends BaseLLMClient {
    protected doGenerate(messages: Message[]): Promise<string>;
}
//# sourceMappingURL=ollama.d.ts.map