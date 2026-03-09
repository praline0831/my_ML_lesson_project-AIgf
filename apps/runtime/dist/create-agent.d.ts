import { OllamaAgent } from './agents/ollama-agent.js';
import { OllamaClient } from './providers/ollama.js';
export declare function createAgent(config?: {
    maxSteps?: number;
    verbose?: boolean;
    systemPrompt?: string;
    provider?: OllamaClient;
}): OllamaAgent;
//# sourceMappingURL=create-agent.d.ts.map