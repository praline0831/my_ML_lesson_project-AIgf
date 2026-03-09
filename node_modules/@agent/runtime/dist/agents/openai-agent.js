import { Agent } from '../agent.js';
/**
 * OpenAI Agent 实现
 */
export class OpenAIAgent extends Agent {
    llmProvider;
    constructor(config, llmProvider) {
        super(config);
        this.llmProvider = llmProvider;
        this.configureLLM(llmProvider);
    }
    createCallbacks() {
        return {
            think: async (context) => {
                return await this.callLLM(context);
            },
            parseToolCall: (response) => {
                // 示例：简单解析 JSON 格式的工具调用
                try {
                    const parsed = JSON.parse(response);
                    if (parsed.action && parsed.action === 'tool_call') {
                        return {
                            name: parsed.action_input.name,
                            args: parsed.action_input.args
                        };
                    }
                }
                catch {
                    // 不是 JSON 格式，视为文本回复
                }
                return null;
            },
            executeTool: async (name, args) => {
                return await this.callTool(name, args);
            }
        };
    }
}
//# sourceMappingURL=openai-agent.js.map