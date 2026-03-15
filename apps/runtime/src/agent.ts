import { LLMProvider } from './llm.js';
import { ReactLoop, ReactLoopCallbacks } from './react-loop.js';
import { AgentConfig, AgentResult, Message, MessageType } from './types.js';
// ✅ 使用包名别名
import { RAGMemoryService } from '@agent/memory';
// …其余代码不变…

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
  protected memory?: RAGMemoryService;
  protected config: AgentConfig;
  protected toolRegistry: ToolRegistry = {};
  protected reactLoop?: ReactLoop;
  protected verbose: boolean = false;
  protected llm?: LLMProvider;

  constructor(config: AgentConfig = {}) {
    this.config = { maxSteps: 10, verbose: false, ...config };
    this.verbose = this.config.verbose ?? false;
    this.memory = new RAGMemoryService();
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
      // 1. 添加用户输入到历史
      this.addMessage(MessageType.Human, input);

      // 2a. 从记忆中检索相关内容
      let context = this.getRecentMessages(10); // 最近对话作为初始上下文
      if (this.memory) {
        // 简单检索：得到字符串数组
        const relevant = await this.memory.getRelevantMemories(input, 3);
        console.log('📚 简单检索结果:', relevant);

        // —— 使用 getRetriever ——（内存包的类型可能未同步，为避免编译错误先转成 any）
        const retriever = (this.memory as any).getRetriever({ k: 5, searchType: 'mmr' });

        // ① 直接调用检索
        const docs = await retriever.getRelevantDocuments(input);
        console.log('🔍 retriever 文档：', docs);
        // 可以将 docs 拼接到 context 或传给 LLM
        // 这里我们把检索出的文档当作工具消息插入；
        context = context.concat(docs.map((d: any) => ({ type: MessageType.Tool, content: d.pageContent || d.content || String(d) })));

        // ② 注册为工具，让模型在 ReactLoop 里可自主检索
        this.registerTool('retrieve', async ({ query }) =>
          retriever.getRelevantDocuments(query as string)
        );

        // ③（可选）创建一个 LangChain 链，一次性完成 RAG
        // import { ConversationalRetrievalQAChain } from 'langchain/chains';
        // import { ChatMessageHistory } from 'langchain/stores/message/in_memory';
        // const qa = ConversationalRetrievalQAChain.fromLLM(this.llm!, retriever, {
        //   memory: new ChatMessageHistory(),
        // });
        // const qaRes = await qa.call({ question: input, chat_history: context });
        // console.log('📘 通过链获得答案：', qaRes.text);
      }

      // 2b. 组装 ReactLoop（回调由子类实现）
      this.reactLoop = new ReactLoop(
        this.config.maxSteps ?? 10,
        this.createCallbacks()
      );

      // 3. 将消息历史添加到循环
      for (const msg of this.messages) {
        this.reactLoop.addMessage(msg);
      }

      // 4. 运行思考循环
      const result = await this.reactLoop.run();

      // 5. 存储输出并更新记忆
      this.addMessage(MessageType.AI, result.output);
      if (this.memory) {
        await this.memory.addTurn(input, result.output);
      }

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