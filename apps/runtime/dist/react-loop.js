import { MessageType } from './types.js';
/**
 * ReAct 循环核心逻辑（纯函数式设计）
 *
 * 不依赖 Agent，只负责：
 * 1. 管理消息历史
 * 2. 控制循环次数
 * 3. 协调 think → parse → execute 的流程
 */
export class ReactLoop {
    messages = [];
    stepCount = 0;
    maxSteps;
    callbacks;
    constructor(maxSteps = 10, callbacks) {
        this.maxSteps = maxSteps;
        this.callbacks = callbacks;
    }
    /**
     * 添加消息（供 Agent 调用）
     */
    addMessage(message) {
        this.messages.push(message);
    }
    /**
     * 获取当前上下文（最近 N 条消息）
     */
    getContext(n = 5) {
        return this.messages.slice(-n);
    }
    /**
     * 执行 ReAct 循环
     */
    async run() {
        while (this.stepCount < this.maxSteps) {
            // 1️⃣ 思考（调用 LLM）
            const context = this.getContext();
            const llmResponse = await this.callbacks.think(context);
            // 2️⃣ 解析（判断是工具调用还是最终回复）
            const toolCall = this.callbacks.parseToolCall(llmResponse);
            if (toolCall) {
                // 3️⃣ 动作（执行工具）
                const result = await this.callbacks.executeTool(toolCall.name, toolCall.args);
                // 4️⃣ 结果（添加 ToolResult 消息）
                this.messages.push({
                    type: MessageType.ToolResult,
                    content: String(result),
                    timestamp: Date.now()
                });
                this.stepCount++;
            }
            else {
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
     * 流式执行：在每轮回复时通过 onChunk 推送 token。需要 callbacks 提供 thinkStream。
     */
    async runStream(onChunk) {
        const thinkStream = this.callbacks.thinkStream;
        if (!thinkStream) {
            return this.run();
        }
        while (this.stepCount < this.maxSteps) {
            const context = this.getContext();
            const stream = thinkStream(context);
            let buffer = '';
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    buffer += value;
                    onChunk?.(value);
                }
            }
            finally {
                reader.releaseLock();
            }
            const toolCall = this.callbacks.parseToolCall(buffer);
            if (toolCall) {
                const result = await this.callbacks.executeTool(toolCall.name, toolCall.args);
                this.messages.push({
                    type: MessageType.ToolResult,
                    content: String(result),
                    timestamp: Date.now()
                });
                this.stepCount++;
            }
            else {
                return { output: buffer, messages: this.messages };
            }
        }
        return {
            output: `已达到最大步数 (${this.maxSteps})，任务未完成`,
            messages: this.messages
        };
    }
    /**
     * 获取执行步数（用于统计）
     */
    getStepCount() {
        return this.stepCount;
    }
}
//# sourceMappingURL=react-loop.js.map