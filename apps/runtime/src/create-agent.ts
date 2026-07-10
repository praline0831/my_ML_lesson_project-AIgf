import { OllamaAgent } from './agents/ollama-agent.js';
import { OllamaClient } from './providers/ollama.js';
import { builtinSkills } from './skills/index.js';

export function createAgent(config: {
    maxSteps?: number;
    verbose?: boolean;
    systemPrompt?: string;
    provider?: OllamaClient;
} = {}) {
    const agent = new OllamaAgent(
        {
            maxSteps: config.maxSteps ?? 10,
            verbose: config.verbose ?? false,
            systemPrompt: config.systemPrompt,
        },
        config.provider ?? new OllamaClient({
            apiKey: 'not-used',
            endpoint: 'http://localhost:11434',
            model: 'gemma4:31b-cloud',
            temperature: 0.7,
            maxTokens: 8192,
        }),
    );

    // 注册内置 Skills
    for (const skill of builtinSkills) {
        agent.registerSkill(skill);
    }
    agent.activateSkill('calculator');
    agent.activateSkill('web_search');

    return agent;
}
