import { Agent } from '../agent.js';
import { OllamaClient } from '../providers/ollama.js';
import { ReactLoopCallbacks } from '../react-loop.js';
import { AgentConfig, Message } from '../types.js';

/**
 * Ollama Agent 实现
 */
export class OllamaAgent extends Agent {
    private llmProvider: OllamaClient; // ← 改为具体类型

    constructor(config: AgentConfig, llmProvider: OllamaClient) {
        super(config);
        this.llmProvider = llmProvider;
        this.configureLLM(llmProvider);
    }

    protected createCallbacks(): ReactLoopCallbacks {
        // ✅ 保存 this 引用（OllamaAgent 实例）
        const self = this;

        return {
            think: async (context: Message[]): Promise<string> => {
                return await self.llm!.generateText(context, self.config.systemPrompt);
            },
            thinkStream: async function* (this: OllamaAgent, context: Message[]) {
                if (!self.llm?.generateStream) {
                    throw new Error("LLM provider does not support streaming.");
                }
                yield* self.llm.generateStream(context, self.config.systemPrompt);
            },
            parseToolCall: (response: string) => {
                // 示例：简单解析 JSON 格式的工具调用
                try {
                    const parsed = JSON.parse(response);
                    if (parsed.action && parsed.action === 'tool_call') {
                        return {
                            name: parsed.action_input.name,
                            args: parsed.action_input.args
                        };
                    }
                } catch {
                    // 不是 JSON 格式，视为文本回复
                }
                return null;
            },
            executeTool: async (name: string, args: Record<string, unknown>) => {
                return await self.callTool(name, args);
            }
        };
    }

    /**
     * 覆盖 callLLM 方法，处理 Ollama 特定逻辑（如重试、错误处理）
     */
    protected async callLLM(messages: Message[]): Promise<string> {
        try {
            return await super.callLLM(messages);
        } catch (error) {
            if (error instanceof Error && error.message.includes('Ollama API 请求失败')) {
                throw new Error('Ollama 连接失败，请确保服务已启动 (ollama serve)');
            }
            throw error;
        }
    }
}