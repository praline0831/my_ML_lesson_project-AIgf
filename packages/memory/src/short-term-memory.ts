import { ChatMessageHistory } from "langchain/stores/message/in_memory";

/**
 * 短期记忆：管理当前对话上下文
 */
export class ShortTermMemory {
    private history: ChatMessageHistory;

    constructor() {
        this.history = new ChatMessageHistory();
    }

    /**
     * 添加用户消息
     */
    async addUserMessage(content: string): Promise<void> {
        await this.history.addUserMessage(content);
    }

    /**
     * 添加 AI 消息
     */
    async addAIMessage(content: string): Promise<void> {
        await this.history.addAIMessage(content);
    }

    /**
     * 获取所有消息
     */
    async getMessages(): Promise<any[]> {
        return await this.history.getMessages();
    }

    /**
     * 获取最近 n 条消息
     */
    async getRecentMessages(n: number = 5): Promise<any[]> {
        const messages = await this.history.getMessages();
        return messages.slice(-n);
    }

    /**
     * 清空短期记忆（对话重置）
     */
    async clear(): Promise<void> {
        this.history = new ChatMessageHistory();
    }
}