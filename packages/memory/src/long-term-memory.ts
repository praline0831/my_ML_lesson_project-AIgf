import { LocalVectorStore } from "./vector-store.js";

/**
 * 长期记忆：用户信息、兴趣、重要事件（RAG）
 */
export class LongTermMemory {
  private vectorStore: LocalVectorStore;

  constructor() {
    this.vectorStore = new LocalVectorStore();
  }

  /**
   * 添加事实型记忆（用户信息）
   */
  async addFact(key: string, value: string): Promise<void> {
    const text = `${key}: ${value}`;
    await this.vectorStore.add(text, "fact");
  }

  /**
   * 添加对话事件（可选）
   */
  async addEvent(description: string): Promise<void> {
    await this.vectorStore.add(description, "event");
  }

  /**
   * 检索相关长期记忆（RAG）
   */
  async search(query: string, k: number = 3): Promise<string[]> {
    return await this.vectorStore.search(query, k);
  }

  /**
   * 直接返回 LangChain Retriever 对象。调用者可以使用它执行
   * 向量检索，或者将其传给 LangChain 链 (RetrievalQAChain 等)，
   * 无需手动拼接 prompt。
   */
  getRetriever(options?: any) {
    return this.vectorStore.getRetriever(options);
  }

  /**
   * 清空长期记忆
   */
  async clear(): Promise<void> {
    await this.vectorStore.clear();
  }
}