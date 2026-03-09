import { ReactLoop } from './react-loop.js';
import { MessageType } from './types.js';
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
    config;
    toolRegistry = {};
    reactLoop;
    verbose = false;
    llm;
    constructor(config = {}) {
        this.config = { maxSteps: 10, verbose: false, ...config };
        this.verbose = this.config.verbose ?? false;
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
            // 1. 添加用户输入
            this.addMessage(MessageType.Human, input);
            // 2. 创建 ReactLoop（传入 callbacks）
            this.reactLoop = new ReactLoop(this.config.maxSteps ?? 10, this.createCallbacks());
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