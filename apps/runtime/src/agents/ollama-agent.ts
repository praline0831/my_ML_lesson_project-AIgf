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
        return {
            think: async (context: Message[]): Promise<string> => {
                return await this.callLLM(context);
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
            executeTool: async (name, args) => {
                return await this.callTool(name, args);
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