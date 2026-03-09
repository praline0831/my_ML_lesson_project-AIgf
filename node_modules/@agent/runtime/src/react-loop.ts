import { Message, MessageType, ToolCall } from './types.js';

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
export class ReactLoop {
  private messages: Message[] = [];
  private stepCount = 0;
  private maxSteps: number;
  private callbacks: ReactLoopCallbacks;

  constructor(maxSteps = 10, callbacks: ReactLoopCallbacks) {
    this.maxSteps = maxSteps;
    this.callbacks = callbacks;
  }

  /**
   * 添加消息（供 Agent 调用）
   */
  public addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 获取当前上下文（最近 N 条消息）
   */
  public getContext(n: number = 5): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * 执行 ReAct 循环
   */
  public async run(): Promise<{ output: string; messages: Message[] }> {
    while (this.stepCount < this.maxSteps) {
      // 1️⃣ 思考（调用 LLM）
      const context = this.getContext();
      const llmResponse = await this.callbacks.think(context);

      // 2️⃣ 解析（判断是工具调用还是最终回复）
      const toolCall = this.callbacks.parseToolCall(llmResponse);

      if (toolCall) {
        // 3️⃣ 动作（执行工具）
        const result = await this.callbacks.executeTool(
          toolCall.name,
          toolCall.args
        );

        // 4️⃣ 结果（添加 ToolResult 消息）
        this.messages.push({
          type: MessageType.ToolResult,
          content: String(result),
          timestamp: Date.now()
        });

        this.stepCount++;
      } else {
        // 直接返回最终回复
        return {
          output: llmResponse,
          messages: this.messages
        };
      }
    }

    // 超出最大步数
    return {
      output: `已达到最大步数 (${this.maxSteps})，任务未完成`,
      messages: this.messages
    };
  }

  /**
   * 获取执行步数（用于统计）
   */
  public getStepCount(): number {
    return this.stepCount;
  }
}