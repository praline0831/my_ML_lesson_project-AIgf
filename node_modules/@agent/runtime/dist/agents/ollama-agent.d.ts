import { Agent } from '../agent.js';
import { OllamaClient } from '../providers/ollama.js';
import { ReactLoopCallbacks } from '../react-loop.js';
import { AgentConfig, Message } from '../types.js';
/**
 * Ollama Agent 实现
 */
export declare class OllamaAgent extends Agent {
    private llmProvider;
    constructor(config: AgentConfig, llmProvider: OllamaClient);
    protected createCallbacks(): ReactLoopCallbacks;
    /**
     * 覆盖 callLLM 方法，处理 Ollama 特定逻辑（如重试、错误处理）
     */
    protected callLLM(messages: Message[]): Promise<string>;
}
//# sourceMappingURL=ollama-agent.d.ts.map