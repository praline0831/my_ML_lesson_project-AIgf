import { RAGMemoryService } from '@agent/memory';
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, CompiledStateGraph, END, START, StateGraph } from '@langchain/langgraph';
import { LLMProvider } from './llm.js';
import { Skill, SkillContext, SkillsManager } from './skills/index.js';
import { AgentConfig, AgentResult, Message, MessageType } from './types.js';

/**
 * 工具注册表
 */
export type ToolRegistry = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

/**
 * LangGraph 状态定义
 *
 * - messages: 对话历史
 * - steps: 已执行步数
 * - finalOutput: 最终输出
 * - trace: 每个节点的执行轨迹（用于演示）
 * - turnCount: 会话轮次计数（用于自动总结）
 */
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  steps: Annotation<number>({
    reducer: (x, y) => x + y,
    default: () => 0,
  }),
  finalOutput: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => '',
  }),
  trace: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (_x, y) => y,
    default: () => 0,
  }),
});

function toLangChainMessage(msg: Message): BaseMessage {
  switch (msg.type) {
    case MessageType.Human:
      return new HumanMessage(msg.content);
    case MessageType.AI:
      return new AIMessage(msg.content);
    case MessageType.Tool:
    case MessageType.ToolResult:
      return new ToolMessage({ content: msg.content, tool_call_id: msg.timestamp?.toString() ?? 'tool' });
    default:
      return new HumanMessage(msg.content);
  }
}

/**
 * 流式回调：当节点完成时被调用（用于实时显示执行轨迹）
 */
export interface StreamCallbacks {
  onNode?: (nodeName: string, data: unknown) => void;
  onToken?: (token: string) => void;   // LLM 输出 token 时
  onTrace?: (trace: string[]) => void;
}

/**
 * Agent 基类 - LangGraph 版
 */
export abstract class Agent {
  protected messages: Message[] = [];
  protected turnCount: number = 0;
  protected memory?: RAGMemoryService;
  protected config: AgentConfig;
  protected toolRegistry: ToolRegistry = {};
  protected toolDescriptions: { name: string; description: string }[] = [];
  protected verbose: boolean = false;
  protected llm?: LLMProvider;
  protected graph?: CompiledStateGraph<any, any, any, any>;
  protected streamCallbacks?: StreamCallbacks;
  /** Skill 管理器（Claude 风格） */
  protected skills: SkillsManager = new SkillsManager();

  constructor(config: AgentConfig = {}) {
    this.config = { maxSteps: 10, verbose: false, ...config };
    this.verbose = this.config.verbose ?? false;
    this.memory = new RAGMemoryService();
  }

  public registerTool(
    name: string,
    tool: ((args: Record<string, unknown>) => Promise<unknown>) | { name: string; description: string; execute: (args: Record<string, unknown>) => Promise<unknown> },
  ): void {
    if (typeof tool === 'object' && tool !== null && 'execute' in tool) {
      this.toolRegistry[tool.name] = tool.execute;
      this.toolDescriptions.push({ name: tool.name, description: tool.description });
      this.log(`已注册工具: ${tool.name}`);
    } else if (typeof tool === 'function') {
      this.toolRegistry[name] = tool;
      this.log(`已注册工具: ${name}`);
    }
  }

  public addToolDescription(name: string, description: string): void {
    this.toolDescriptions.push({ name, description });
  }

  public configureLLM(llm: LLMProvider): void {
    this.llm = llm;
    this.log(`LLM 提供商已配置: ${llm.constructor.name}`);
  }

  /**
   * 注册一个 Skill
   */
  public registerSkill(skill: Skill): void {
    this.skills.register(skill);
    this.log(`已注册 Skill: ${skill.name}`);
  }

  /**
   * 激活一个 Skill（之后其 instructions 会注入到 LLM 的 system prompt）
   */
  public activateSkill(name: string): void {
    this.skills.activate(name);
    this.log(`已激活 Skill: ${name}`);
  }

  /**
   * 停用一个 Skill
   */
  public deactivateSkill(name: string): void {
    this.skills.deactivate(name);
    this.log(`已停用 Skill: ${name}`);
  }

  /**
   * 获取 RAGMemoryService 实例，用于外部注入知识（如对齐结果）
   */
  public getMemory(): RAGMemoryService | undefined {
    return this.memory;
  }

  /**
   * 直接获取 SkillsManager（高级用法：例如想自定义 invoke 上下文）
   */
  public getSkillsManager(): SkillsManager {
    return this.skills;
  }

  /**
   * 构建 Skill 调用的上下文（供内部节点使用）
   */
  protected buildSkillContext(): SkillContext {
    if (!this.llm) {
      throw new Error('LLM 未配置，请先调用 configureLLM');
    }
    return {
      llm: this.llm,
      tools: this.toolRegistry,
      agent: this,
    };
  }

  /**
   * 设置流式回调
   */
  public setStreamCallbacks(cbs: StreamCallbacks): void {
    this.streamCallbacks = cbs;
  }

  protected async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.toolRegistry[name]) {
      throw new Error(`工具 "${name}" 未注册`);
    }
    return await this.toolRegistry[name](args);
  }

  protected async callLLM(messages: Message[]): Promise<string> {
    if (!this.llm) {
      throw new Error('LLM 未配置，请调用 configureLLM');
    }
    return await this.llm.generateText(messages, this.composeSystemPrompt());
  }

  /**
   * 组合 system prompt：用户配置 + 已激活 Skill instructions + 注册工具列表
   */
  protected composeSystemPrompt(): string | undefined {
    const parts: string[] = [];
    if (this.config.systemPrompt) parts.push(this.config.systemPrompt);

    // 工具列表
    if (this.toolDescriptions.length > 0) {
      const lines = this.toolDescriptions.map(
        (t, i) => `  ${i + 1}. \`${t.name}\`: ${t.description}`,
      );
      parts.push(
        `## Available Tools\nCall a tool by outputting: <tool>{"name":"...","args":{...}}</tool>\n${lines.join('\n')}`,
      );
    }

    // Skill instructions
    const skillPrompt = this.skills.buildSystemPrompt();
    if (skillPrompt) parts.push(skillPrompt);

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  /**
   * 流式调用 LLM（如果 LLM 支持）
   */
  protected async *callLLMStream(messages: Message[]): AsyncIterable<string> {
    if (!this.llm) {
      throw new Error('LLM 未配置，请调用 configureLLM');
    }
    // 生成 system prompt
    const systemPrompt = this.composeSystemPrompt();
    if (this.llm.generateStream) {
      yield* this.llm.generateStream(messages, systemPrompt);
    } else {
      // 退化为一次性生成
      const text = await this.llm.generateText(messages, systemPrompt);
      yield text;
    }
  }

  protected parseToolCall(response: string): { name: string; args: Record<string, unknown> } | null {
    const match = response.match(/<tool>([\s\S]*?)<\/tool>/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  /**
   * 【核心】构建 LangGraph 状态图
   */
  private buildGraph() {
    const self = this;
    const workflow = new StateGraph(GraphState)
      // 1. retrieve 节点
      .addNode('retrieve', async (state) => {
        const lastUser = [...state.messages].reverse().find((m) => m instanceof HumanMessage);
        const query = lastUser?.content?.toString() ?? '';
        const context: BaseMessage[] = [];
        let traceEntry = `🔍 [retrieve] 查询: "${query}"`;
        if (self.memory && query) {
          const relevant = await self.memory.getRelevantMemories(query, 3);
          traceEntry += ` → 找到 ${relevant.length} 条相关记忆`;
          for (const r of relevant) {
            context.push(new ToolMessage({ content: r, tool_call_id: 'rag' }));
          }
        } else {
          traceEntry += ' → 无相关记忆';
        }
        return { messages: context, steps: 0, trace: [traceEntry] };
      })

      // 2. think 节点（流式）
      .addNode('think', async (state) => {
        const msgs: Message[] = state.messages.map((m) => ({
          type: m instanceof HumanMessage
            ? MessageType.Human
            : m instanceof ToolMessage
              ? MessageType.ToolResult
              : MessageType.AI,
          content: m.content.toString(),
          timestamp: Date.now(),
        }));

        // 收集流式输出
        let fullResponse = '';
        for await (const token of self.callLLMStream(msgs)) {
          fullResponse += token;
          self.streamCallbacks?.onToken?.(token);
        }

        return {
          messages: [new AIMessage(fullResponse)],
          steps: 1,
          trace: [`🤖 [think] LLM 回复 (${fullResponse.length} 字符)`],
        };
      })

      // 3. act 节点
      .addNode('act', async (state) => {
        const lastAI = [...state.messages].reverse().find((m) => m instanceof AIMessage);
        const content = lastAI?.content?.toString() ?? '';
        const toolCall = self.parseToolCall(content);

        if (!toolCall) {
          return {
            finalOutput: content,
            steps: 1,
            trace: ['✅ [act] 无工具调用，结束'],
          };
        }

        const traceEntry = `🔧 [act] 调用工具: ${toolCall.name}(${JSON.stringify(toolCall.args)})`;
        const result = await self.callTool(toolCall.name, toolCall.args);
        return {
          messages: [new ToolMessage({ content: String(result), tool_call_id: toolCall.name })],
          steps: 1,
          trace: [traceEntry, `   ↳ 工具返回: ${String(result).slice(0, 100)}...`],
        };
      })

      // 4. summarize 节点 - 每 N 轮自动总结对话并写入长期记忆
      .addNode('summarize', async (state) => {
        const turnCount = state.turnCount || 1;
        if (turnCount % 3 !== 0) {
          return { trace: ['⏭️ [summarize] 未到总结轮次，跳过'] };
        }
        const msgs = state.messages;
        if (msgs.length < 4) {
          return { trace: ['⏭️ [summarize] 对话太短，跳过'] };
        }
        // 取最近 2 轮对话
        const recent = msgs.slice(-4).map(m =>
          `${m instanceof HumanMessage ? 'User' : 'AI'}: ${(m.content?.toString() ?? '').slice(0, 200)}`,
        ).join('\n');
        const summaryPrompt = `Briefly summarise the key topics and facts in this conversation snippet (1-2 sentences, in English or Chinese):\n${recent}`;
        try {
          const summary = await self.callLLM([
            { type: MessageType.Human, content: summaryPrompt, timestamp: Date.now() },
          ]);
          await self.memory?.longTerm.addSummary('conversation', summary);
          return {
            trace: [`📝 [summarize] 自动总结已存储: ${summary.slice(0, 100)}...`],
            turnCount: turnCount,
          };
        } catch {
          return { trace: ['⚠️ [summarize] 总结生成失败'] };
        }
      })

      // 5. invoke_skill 节点 - 执行 LLM 在 <skill>...</skill> 中请求的 Skill
      .addNode('invoke_skill', async (state) => {
        const lastAI = [...state.messages].reverse().find((m) => m instanceof AIMessage);
        const content = lastAI?.content?.toString() ?? '';
        const skillCall = self.skills.parseSkillCall(content);

        if (!skillCall) {
          // 防御：理论上路由到这里就一定有 <skill>
          return {
            finalOutput: content,
            steps: 1,
            trace: ['⚠️ [invoke_skill] 路由异常：无 <skill> 标签，回退结束'],
          };
        }

        const traceEntry = `🎯 [invoke_skill] 调用 Skill: ${skillCall.name}(${JSON.stringify(skillCall.args)})`;
        try {
          const ctx = self.buildSkillContext();
          const result = await self.skills.invoke(skillCall.name, skillCall.args, ctx);
          return {
            messages: [
              new ToolMessage({
                content: typeof result === 'string' ? result : JSON.stringify(result),
                tool_call_id: `skill:${skillCall.name}`,
              }),
            ],
            steps: 1,
            trace: [
              traceEntry,
              `   ↳ Skill 返回: ${String(result).slice(0, 100)}${String(result).length > 100 ? '...' : ''}`,
            ],
          };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          return {
            messages: [
              new ToolMessage({
                content: `Skill "${skillCall.name}" 执行失败: ${errMsg}`,
                tool_call_id: `skill:${skillCall.name}:error`,
              }),
            ],
            steps: 1,
            trace: [traceEntry, `   ↳ 错误: ${errMsg}`],
          };
        }
      })

      .addEdge(START, 'retrieve')
      .addEdge('retrieve', 'think')
      .addConditionalEdges('think', (state) => {
        const lastAI = [...state.messages].reverse().find((m) => m instanceof AIMessage);
        const content = lastAI?.content?.toString() ?? '';
        // 优先匹配 <skill>，其次 <tool>
        if (self.skills.parseSkillCall(content)) return 'invoke_skill';
        if (self.parseToolCall(content)) return 'act';
        // 无论正常结束还是超出步数，都走 summarize 做一次清理
        return 'summarize';
      })
      .addEdge('act', 'think')
      .addEdge('invoke_skill', 'think')
      .addEdge('summarize', END);

    return workflow.compile();
  }

  /**
   * 执行（一次性返回）
   */
  public async run(input: string): Promise<AgentResult> {
    try {
      this.addMessage(MessageType.Human, input);
      if (!this.graph) this.graph = this.buildGraph();
      this.turnCount = (this.turnCount ?? 0) + 1;

      const initialMessages = this.messages.map(toLangChainMessage);
      const finalState = await this.graph.invoke({
        messages: initialMessages,
        steps: 0,
        finalOutput: '',
        trace: [],
        turnCount: this.turnCount,
      });

      const lastAI = [...finalState.messages].reverse().find((m) => m instanceof AIMessage);
      const output = finalState.finalOutput || lastAI?.content?.toString() || '';

      this.addMessage(MessageType.AI, output);
      if (this.memory) await this.memory.addTurn(input, output);

      this.streamCallbacks?.onTrace?.(finalState.trace);

      return {
        finalOutput: output,
        messages: [...this.messages],
        steps: finalState.steps,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addMessage(MessageType.AI, `发生错误: ${errorMessage}`);
      return {
        finalOutput: `发生错误: ${errorMessage}`,
        messages: [...this.messages],
        steps: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * 【演示】流式执行：边执行边输出 LLM token 和节点轨迹
   */
  public async *runStream(input: string): AsyncGenerator<string | string[] | { node: string; trace: string }, void, unknown> {
    this.addMessage(MessageType.Human, input);
    if (!this.graph) this.graph = this.buildGraph();
    this.turnCount = (this.turnCount ?? 0) + 1;

    const initialMessages = this.messages.map(toLangChainMessage);
    const initialState = { messages: initialMessages, steps: 0, finalOutput: '', trace: [], turnCount: this.turnCount };

    // 累积状态
    let accumulated = initialState;

    // 用 graph.stream 逐节点返回
    // LangGraph 0.2 的 stream 返回 Promise<ReadableStream>，需要 [Symbol.asyncIterator]
    const streamPromise = this.graph.stream(initialState) as any;
    const stream = await streamPromise;
    for await (const chunk of stream) {
      // 调试：输出 chunk 结构（稳定后删掉）
      if (this.verbose) console.error('[stream-chunk] keys:', Object.keys(chunk), 'event:', (chunk as any).event, 'name:', (chunk as any).name);
      for (const [nodeName, nodeState] of Object.entries(chunk)) {
        const update = nodeState as any;
        accumulated = { ...accumulated, ...update };

        // trace 经过 reducer 累积后可能是全量历史，取最后一个（当前节点新增的）
        const traceArr: string[] | undefined = update.trace;
        if (traceArr && Array.isArray(traceArr) && traceArr.length > 0) {
          for (const t of traceArr) {
            yield { node: nodeName, trace: t };
          }
        }
      }
    }

    const lastAI = [...accumulated.messages].reverse().find((m) => m instanceof AIMessage);
    const output = accumulated.finalOutput || lastAI?.content?.toString() || '';

    this.addMessage(MessageType.AI, output);
    if (this.memory) await this.memory.addTurn(input, output);

    yield ['__DONE__', output];  // 结束标记 + 最终输出
  }

  /**
   * 【演示1】打印 Mermaid 图（最直观的 LangGraph 优势）
   */
  public printGraph(): string {
    if (!this.graph) this.graph = this.buildGraph();
    const mermaid = this.graph.getGraph().drawMermaid();
    return mermaid;
  }

  /**
   * 【演示2】可视化一次完整执行的轨迹
   */
  public async runWithTrace(input: string): Promise<{
    output: string;
    trace: string[];
    steps: number;
  }> {
    const callbacks: StreamCallbacks = {
      onToken: (token) => process.stdout.write(token),  // 实时打印 token
    };
    this.setStreamCallbacks(callbacks);

    console.log('\n┌─ 执行轨迹 ─────────────────────');
    const result = await this.run(input);
    console.log('\n└───────────────────────────────\n');

    return {
      output: result.finalOutput,
      trace: [],  // 可以从 state 中拿
      steps: result.steps,
    };
  }

  protected addMessage(type: MessageType, content: string): void {
    this.messages.push({ type, content, timestamp: Date.now() });
  }

  protected log(message: string): void {
    if (this.verbose) {
      console.log(`[Agent] ${message}`);
    }
  }
}
