import { Tool } from './types.js';
/**
 * 创建工具的辅助函数
 */
export declare function createTool(name: string, description: string, execute: (args: Record<string, unknown>) => Promise<unknown>): Tool;
/**
 * 示例工具：EchoTool（调试用）
 */
export declare const echoTool: Tool;
/**
 * 示例工具：计算器（演示基础功能）
 */
export declare const calculatorTool: Tool;
//# sourceMappingURL=tools.d.ts.map