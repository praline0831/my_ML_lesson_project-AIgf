// 类型定义：Agent 系统的核心数据结构

/**
 * 消息类型枚举
 */
export enum MessageType {
    Human = 'human',
    AI = 'ai',
    Tool = 'tool',
    ToolResult = 'tool_result'
}

/**
 * 单条消息接口
 */
export interface Message {
    type: MessageType;
    content: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    timestamp: number;
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
    finalOutput: string;
    messages: Message[];
    steps: number;
    error?: string;
}

/**
 * 工具调用请求
 */
export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
    maxSteps?: number;
    verbose?: boolean;
    systemPrompt?: string;
}

/**
 * 工具接口（简化版，无泛型）
 */
export interface Tool {
    name: string;
    description: string;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}