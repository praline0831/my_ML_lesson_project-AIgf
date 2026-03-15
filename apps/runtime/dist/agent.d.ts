import { LLMProvider } from './llm.js';
import { ReactLoop, ReactLoopCallbacks } from './react-loop.js';
import { AgentConfig, AgentResult, Message, MessageType } from './types.js';
import { RAGMemoryService } from '@agent/memory';
type ToolRegistry = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
/**
 * Agent 基类
 *
 * 职责：
 * 1. 管理消息历史（messages）
 * 2. 注册工具（toolRegistry）
 * 3. 提供 run(input) 统一入口
 * 4. 封装 ReactLoop 的 callbacks（调用 LLM/工具）
 */
export declare abstract class Agent {
    protected messages: Message[];
    protected memory?: RAGMemoryService;
    protected config: AgentConfig;
    protected toolRegistry: ToolRegistry;
    protected reactLoop?: ReactLoop;
    protected verbose: boolean;
    protected llm?: LLMProvider;
    constructor(config?: AgentConfig);
    /**
     * 注册工具
     */
    registerTool(name: string, tool: (args: Record<string, unknown>) => Promise<unknown>): void;
    configureLLM(llm: LLMProvider): void;
    /**
     * 核心执行入口
     */
    run(input: string): Promise<AgentResult>;
    /**
     * 流式执行：通过 onChunk 逐段推送 AI 回复，适合 SSE/Web 实时展示
     */
    runStream(input: string, onChunk: (chunk: string) => void): Promise<AgentResult>;
    /**
     * 添加消息（内部使用）
     */
    protected addMessage(type: MessageType, content: string): void;
    /**
     * 获取最近消息（供子类调用）
     */
    protected getRecentMessages(n?: number): Message[];
    /**
     * 【核心！】创建 ReactLoop callbacks
     *
     * 子类必须实现：
     * - think: 调用 LLM
     * - parseToolCall: 解析工具调用
     * - executeTool: 执行注册的工具
     */
    protected abstract createCallbacks(): ReactLoopCallbacks;
    /**
     * 工具调用辅助方法（供 callbacks 使用）
     */
    protected callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    protected callLLM(messages: Message[]): Promise<string>;
    /**
     * 日志输出（可选）
     */
    protected log(message: string): void;
}
export {};
//# sourceMappingURL=agent.d.ts.map