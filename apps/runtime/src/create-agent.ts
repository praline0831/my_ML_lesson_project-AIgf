import { OllamaAgent } from './agents/ollama-agent.js';
import { OllamaClient } from './providers/ollama.js';

// ... existing createAgent function ...
export function createAgent(config: {
    maxSteps?: number;
    verbose?: boolean;
    systemPrompt?: string;
    provider?: OllamaClient;
} = {}) {
    if (config.provider) {
        return new OllamaAgent(
            {
                maxSteps: config.maxSteps ?? 10,
                verbose: config.verbose ?? false,
                systemPrompt: config.systemPrompt
            },
            config.provider
        );
    }

    // 默认 Ollama 客户端
    const llm = new OllamaClient({
        apiKey: 'not-used',
        endpoint: 'http://localhost:11434',
        model: 'gpt-oss:120b-cloud',
        temperature: 0.7,
        maxTokens: 2048
    });

    return new OllamaAgent(
        {
            maxSteps: config.maxSteps ?? 10,
            verbose: config.verbose ?? false,
            systemPrompt: config.systemPrompt
        },
        llm
    );
}