import { LLMProvider } from './llm.js';
import { ReactLoop, ReactLoopCallbacks } from './react-loop.js';
import { AgentConfig, AgentResult, Message, MessageType } from './types.js';

// 工具注册表
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
export abstract class Agent {
  protected messages: Message[] = [];
  protected config: AgentConfig;
  protected toolRegistry: ToolRegistry = {};
  protected reactLoop?: ReactLoop;
  protected verbose: boolean = false;
  protected llm?: LLMProvider;

  constructor(config: AgentConfig = {}) {
    this.config = { maxSteps: 10, verbose: false, ...config };
    this.verbose = this.config.verbose ?? false;
  }

  /**
   * 注册工具
   */
  public registerTool(
    name: string,
    tool: (args: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.toolRegistry[name] = tool;
    this.log(`已注册工具: ${name}`);
  }

  public configureLLM(llm: LLMProvider): void {
    this.llm = llm;
    this.log(`LLM 提供商已配置: ${llm.constructor.name}`);
  }

  /**
   * 核心执行入口
   */
  public async run(input: string): Promise<AgentResult> {
    try {
      // 1. 添加用户输入
      this.addMessage(MessageType.Human, input);

      // 2. 创建 ReactLoop（传入 callbacks）
      this.reactLoop = new ReactLoop(
        this.config.maxSteps ?? 10,
        this.createCallbacks()
      );

      // 3. 将历史消息添加到 ReactLoop
      for (const msg of this.messages) {
        this.reactLoop.addMessage(msg);
      }

      // 4. 执行循环
      const result = await this.reactLoop.run();

      // 5. 添加 AI 最终回复
      this.addMessage(MessageType.AI, result.output);

      return {
        finalOutput: result.output,
        messages: [...this.messages],
        steps: this.reactLoop.getStepCount()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addMessage(MessageType.AI, `发生错误: ${errorMessage}`);
      return {
        finalOutput: `发生错误: ${errorMessage}`,
        messages: [...this.messages],
        steps: this.reactLoop?.getStepCount() ?? 0,
        error: errorMessage
      };
    }
  }

  /**
   * 添加消息（内部使用）
   */
  protected addMessage(
    type: MessageType,
    content: string
  ): void {
    this.messages.push({
      type,
      content,
      timestamp: Date.now()
    });
  }

  /**
   * 获取最近消息（供子类调用）
   */
  protected getRecentMessages(n: number = 10): Message[] {
    return this.messages.slice(-n);
  }

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
  protected async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.toolRegistry[name]) {
      throw new Error(`工具 "${name}" 未注册`);
    }
    return await this.toolRegistry[name](args);
  }

  protected async callLLM(messages: Message[]): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM 未配置，请调用 configureLLM');
    }
    return await this.llm.generateText(messages, this.config.systemPrompt);
  }

  /**
   * 日志输出（可选）
   */
  protected log(message: string): void {
    if (this.verbose) {
      console.log(`[Agent] ${message}`);
    }
  }
}