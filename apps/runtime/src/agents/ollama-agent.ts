import { Agent } from '../agent.js';
import { OllamaClient } from '../providers/ollama.js';
import { AgentConfig, Message } from '../types.js';

/**
 * Ollama Agent 实现
 *
 * 通过覆盖父类方法适配 Ollama 特定行为：
 * - callLLM: 错误处理（连接失败提示）
 * - parseToolCall: 解析 Ollama 输出的 JSON 格式工具调用
 */
export class OllamaAgent extends Agent {
    private llmProvider: OllamaClient;

    constructor(config: AgentConfig, llmProvider: OllamaClient) {
        super(config);
        this.llmProvider = llmProvider;
        this.configureLLM(llmProvider);
    }

    /**
     * 获取底层 LLM provider（供其他模块复用，如 paper-align agent）
     * 这样可以保证两个 agent 共用同一个模型配置
     */
    public getLLMProvider(): OllamaClient {
        return this.llmProvider;
    }

    /**
     * Ollama 特定的错误处理
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

    /**
     * 解析 Ollama 风格的工具调用
     *
     * 兼容两种格式：
     *   1. 简单: <tool>{"name":"...","args":{...}}</tool>（推荐，system prompt 中的格式）
     *   2. 旧式: {"action": "tool_call", "action_input": {"name": "...", "args": {...}}}
     */
    protected parseToolCall(response: string): { name: string; args: Record<string, unknown> } | null {
        try {
            // 先尝试在 <tool> 标签里找 JSON
            const tagMatch = response.match(/<tool>([\s\S]*?)<\/tool>/);
            const jsonStr = tagMatch ? tagMatch[1] : response;
            const parsed = JSON.parse(jsonStr);

            // 格式1: 直接 {name, args}
            if (parsed.name && typeof parsed.name === 'string') {
                return {
                    name: parsed.name,
                    args: parsed.args ?? {},
                };
            }

            // 格式2: {action: "tool_call", action_input: {name, args}}
            if (parsed.action === 'tool_call' && parsed.action_input) {
                return {
                    name: parsed.action_input.name,
                    args: parsed.action_input.args ?? {},
                };
            }
        } catch {
            // 不是 JSON，视为普通文本
        }
        return null;
    }
}
