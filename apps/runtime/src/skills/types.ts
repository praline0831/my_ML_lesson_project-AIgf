/**
 * Skill 类型定义（Claude 风格）
 *
 * 一个 Skill 是一个可被模型按需激活的"能力包"：
 * - name:           唯一标识
 * - description:    供模型判断何时使用
 * - instructions:   激活时注入到 LLM 系统提示中的指令
 * - parameters:     参数声明（用于在 system prompt 中告知模型参数结构）
 * - execute:        实际执行逻辑
 *
 * 与 Tool 的区别：
 * - Tool 是一次性原子调用（LLM 输出 <tool>...</tool>）
 * - Skill 是一组指令 + 可选的执行入口，激活后改变 LLM 行为
 *   必要时 LLM 仍可在 skill 内部调用 tool
 */

import type { LLMProvider } from '../llm.js';
import type { ToolRegistry } from '../agent.js';
import type { Agent } from '../agent.js';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
}

/**
 * Skill 执行上下文
 *
 * Skill 的 execute 可以访问 LLM、ToolRegistry 和当前 Agent。
 * 允许 Skill 内部继续调用 LLM 或使用已注册的工具。
 */
export interface SkillContext {
  llm: LLMProvider;
  tools: ToolRegistry;
  agent: Agent;
}

/**
 * Skill 接口
 */
export interface Skill {
  /** 唯一名称（英文，下划线/短横线分隔） */
  name: string;
  /** 供 LLM 判断何时激活/调用 */
  description: string;
  /** 激活时追加到 system prompt 的指令 */
  instructions?: string;
  /** 参数声明（仅用于在 prompt 中告知 LLM） */
  parameters?: SkillParameter[];
  /** 是否默认激活 */
  enabledByDefault?: boolean;
  /**
   * 执行入口。可选：
   * - 不提供 execute：skill 仅为"指令包"，激活后只影响 LLM 行为
   * - 提供 execute：LLM 可通过 <skill>{"name":"x","args":{...}}</skill> 直接调用
   */
  execute?: (args: Record<string, unknown>, ctx: SkillContext) => Promise<unknown>;
}
