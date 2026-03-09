// 类型
export type {
    AgentConfig,
    AgentResult,
    Message,
    MessageType,
    ToolCall
} from './types.js';

// 核心类
export { Agent } from './agent.js';
export { BaseLLMClient } from './llm.js';
export type { LLMConfig, LLMProvider } from './llm.js';
export { ReactLoop } from './react-loop.js';
export type { ReactLoopCallbacks } from './react-loop.js';

// 工具相关（不导出 Tool 类型，只导出函数/实例）
export { calculatorTool, createTool, echoTool } from './tools.js';

// 子类和工厂
export { OllamaAgent } from './agents/ollama-agent.js';
export { OllamaClient } from './providers/ollama.js';

// 工厂函数
export { createAgent } from './create-agent.js';
