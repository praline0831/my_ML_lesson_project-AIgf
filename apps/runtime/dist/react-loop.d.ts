import { Message, ToolCall } from './types.js';
/**
 * ReactLoop 配置项
 *
 * 通过 callback 模式，让 Agent 提供 LLM 和工具调用的实现
 */
export interface ReactLoopCallbacks {
    /**
     * 调用 LLM 获取思考结果
     *
     * @param context 最近 N 条消息
     * @returns LLM 的原始响应（可能是文本、JSON、Markdown 表格等）
     */
    think: (context: Message[]) => Promise<string>;
    /**
     * 解析 LLM 响应，判断是否为工具调用
     *
     * @param response LLM 原始响应
     * @returns 工具调用对象（或 null 表示生成最终回复）
     */
    parseToolCall: (response: string) => ToolCall | null;
    /**
     * 执行工具
     *
     * @param toolName 工具名
     * @param args 工具参数
     * @returns 工具执行结果
     */
    executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}
/**
 * ReAct 循环核心逻辑（纯函数式设计）
 *
 * 不依赖 Agent，只负责：
 * 1. 管理消息历史
 * 2. 控制循环次数
 * 3. 协调 think → parse → execute 的流程
 */
export declare class ReactLoop {
    private messages;
    private stepCount;
    private maxSteps;
    private callbacks;
    constructor(maxSteps: number | undefined, callbacks: ReactLoopCallbacks);
    /**
     * 添加消息（供 Agent 调用）
     */
    addMessage(message: Message): void;
    /**
     * 获取当前上下文（最近 N 条消息）
     */
    getContext(n?: number): Message[];
    /**
     * 执行 ReAct 循环
     */
    run(): Promise<{
        output: string;
        messages: Message[];
    }>;
    /**
     * 获取执行步数（用于统计）
     */
    getStepCount(): number;
}
//# sourceMappingURL=react-loop.d.ts.map