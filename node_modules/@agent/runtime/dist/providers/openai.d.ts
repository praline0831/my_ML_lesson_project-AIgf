import { BaseLLMClient, LLMConfig } from '../llm.js';
import { Message } from '../types.js';
export declare class OpenAIClient extends BaseLLMClient {
    constructor(config: LLMConfig);
    protected doGenerate(messages: Message[]): Promise<string>;
}
//# sourceMappingURL=openai.d.ts.map