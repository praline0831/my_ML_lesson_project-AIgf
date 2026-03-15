import { LongTermMemory } from "./long-term-memory.js";
import { ShortTermMemory } from "./short-term-memory.js";
import { LocalVectorStore } from "./vector-store.js";


export class MemoryService {
  private vectorStore: LocalVectorStore;

  constructor() {
    this.vectorStore = new LocalVectorStore();
  }

  async addTurn(userMsg: string, aiMsg: string): Promise<void> {
    await this.vectorStore.add(userMsg, "user");
    await this.vectorStore.add(aiMsg, "ai");
  }

  async getRelevantMemories(userQuery: string): Promise<string[]> {
    return await this.vectorStore.search(userQuery, 2);
  }

  async clear(): Promise<void> {
    await this.vectorStore.clear();
  }
}

/**
 * RAG Memory Service（短期 + 长期记忆统一管理）
 */
export class RAGMemoryService {
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;

  constructor() {
    this.shortTerm = new ShortTermMemory();
    this.longTerm = new LongTermMemory();
  }

  /**
   * 添加对话轮次（同时更新短期 + 长期记忆）
   */
  async addTurn(userMsg: string, aiMsg: string, facts?: { key: string; value: string }[]): Promise<void> {
    // 更新短期记忆
    await this.shortTerm.addUserMessage(userMsg);
    await this.shortTerm.addAIMessage(aiMsg);

    // 更新长期记忆（如果有事实）
    if (facts) {
      for (const fact of facts) {
        await this.longTerm.addFact(fact.key, fact.value);
      }
    }
  }

  /**
   * 获取短期记忆（对话上下文）
   */
  async getShortTermMemory(): Promise<any[]> {
    return await this.shortTerm.getMessages();
  }

  /**
   * 检索长期记忆（RAG）
   */
  async getRelevantMemories(query: string, k: number = 3): Promise<string[]> {
    return await this.longTerm.search(query, k);
  }

  /**
   * 获取长期记忆对应的 Retriever，可直接用于 LangChain 的检索链。
   */
  getRetriever(options?: any) {
    return this.longTerm.getRetriever(options);
  }

  /**
   * 清空所有记忆
   */
  async clear(): Promise<void> {
    await this.shortTerm.clear();
    await this.longTerm.clear();
  }
}