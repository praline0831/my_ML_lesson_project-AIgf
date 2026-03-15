import { ReactLoop } from './react-loop.js';
import { MessageType } from './types.js';
// ✅ 使用包名别名
import { RAGMemoryService } from '@agent/memory';
/**
 * Agent 基类
 *
 * 职责：
 * 1. 管理消息历史（messages）
 * 2. 注册工具（toolRegistry）
 * 3. 提供 run(input) 统一入口
 * 4. 封装 ReactLoop 的 callbacks（调用 LLM/工具）
 */
export class Agent {
    messages = [];
    memory;
    config;
    toolRegistry = {};
    reactLoop;
    verbose = false;
    llm;
    constructor(config = {}) {
        this.config = { maxSteps: 10, verbose: false, ...config };
        this.verbose = this.config.verbose ?? false;
        this.memory = new RAGMemoryService();
    }
    /**
     * 注册工具
     */
    registerTool(name, tool) {
        this.toolRegistry[name] = tool;
        this.log(`已注册工具: ${name}`);
    }
    configureLLM(llm) {
        this.llm = llm;
        this.log(`LLM 提供商已配置: ${llm.constructor.name}`);
    }
    /**
     * 核心执行入口
     */
    async run(input) {
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
                const retriever = this.memory.getRetriever({ k: 5, searchType: 'mmr' });
                // ① 直接调用检索
                const docs = await retriever.getRelevantDocuments(input);
                console.log('🔍 retriever 文档：', docs);
                // 可以将 docs 拼接到 context 或传给 LLM
                // 这里我们把检索出的文档当作工具消息插入；
                context = context.concat(docs.map((d) => ({ type: MessageType.Tool, content: d.pageContent || d.content || String(d) })));
                // ② 注册为工具，让模型在 ReactLoop 里可自主检索
                this.registerTool('retrieve', async ({ query }) => retriever.getRelevantDocuments(query));
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
            this.reactLoop = new ReactLoop(this.config.maxSteps ?? 10, this.createCallbacks());
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
        }
        catch (error) {
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
     * 流式执行：通过 onChunk 逐段推送 AI 回复，适合 SSE/Web 实时展示
     */
    async runStream(input, onChunk) {
        try {
            this.addMessage(MessageType.Human, input);
            let context = this.getRecentMessages(10);
            if (this.memory) {
                const relevant = await this.memory.getRelevantMemories(input, 3);
                const retriever = this.memory.getRetriever({ k: 5, searchType: 'mmr' });
                const docs = await retriever.getRelevantDocuments(input);
                context = context.concat(docs.map((d) => ({ type: MessageType.Tool, content: d.pageContent || d.content || String(d) })));
                this.registerTool('retrieve', async ({ query }) => retriever.getRelevantDocuments(query));
            }
            this.reactLoop = new ReactLoop(this.config.maxSteps ?? 10, this.createCallbacks());
            for (const msg of this.messages) {
                this.reactLoop.addMessage(msg);
            }
            const result = await this.reactLoop.runStream(onChunk);
            this.addMessage(MessageType.AI, result.output);
            if (this.memory) {
                await this.memory.addTurn(input, result.output);
            }
            return {
                finalOutput: result.output,
                messages: [...this.messages],
                steps: this.reactLoop.getStepCount()
            };
        }
        catch (error) {
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
    addMessage(type, content) {
        this.messages.push({
            type,
            content,
            timestamp: Date.now()
        });
    }
    /**
     * 获取最近消息（供子类调用）
     */
    getRecentMessages(n = 10) {
        return this.messages.slice(-n);
    }
    /**
     * 工具调用辅助方法（供 callbacks 使用）
     */
    async callTool(name, args) {
        if (!this.toolRegistry[name]) {
            throw new Error(`工具 "${name}" 未注册`);
        }
        return await this.toolRegistry[name](args);
    }
    async callLLM(messages) {
        if (!this.llm) {
            throw new Error('LLM 未配置，请调用 configureLLM');
        }
        return await this.llm.generateText(messages, this.config.systemPrompt);
    }
    /**
     * 日志输出（可选）
     */
    log(message) {
        if (this.verbose) {
            console.log(`[Agent] ${message}`);
        }
    }
}
//# sourceMappingURL=agent.js.map