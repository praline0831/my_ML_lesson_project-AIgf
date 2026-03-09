import { Agent } from '../agent.js';
import { LLMProvider } from '../llm.js';
import { ReactLoopCallbacks } from '../react-loop.js';
import { AgentConfig } from '../types.js';
/**
 * OpenAI Agent 实现
 */
export declare class OpenAIAgent extends Agent {
    private llmProvider;
    constructor(config: AgentConfig, llmProvider: LLMProvider);
    protected createCallbacks(): ReactLoopCallbacks;
}
//# sourceMappingURL=openai-agent.d.ts.map