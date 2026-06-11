import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { v4 as uuidv4 } from "uuid";

/**
 * LangChain 兼容的 Embeddings 实现
 */
class LangChainEmbeddings {
  async _embed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const res = await fetch("http://localhost:11434/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "shaw/dmeta-embedding-zh:latest",
          prompt: text,
        }),
      });
      if (!res.ok) throw new Error("Ollama Embeddings failed");
      const data = await res.json();
      embeddings.push(data.embedding);
    }
    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this._embed([text]))[0];
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return await this._embed(documents);
  }
}

export class LocalVectorStore {
  private store: MemoryVectorStore;

  constructor() {
    this.store = new MemoryVectorStore(new LangChainEmbeddings());
  }

  async add(text: string, role: "user" | "ai" | "fact" | "event"): Promise<void> {
    await this.store.addDocuments([{
      pageContent: `[${role.toUpperCase()}] ${text}`,
      metadata: { role, timestamp: Date.now() },
      id: uuidv4(),
    }]);
  }

  async search(query: string, k: number = 3): Promise<string[]> {
    // 先 embed query
    const embeddings = new LangChainEmbeddings();
    const queryEmbedding = await embeddings.embedQuery(query);

    // 用 _queryVectors 检索（这是 protected 方法，但可以调用）
    // LangChain v0.3 的 _queryVectors 返回带 similarity 的结果
    const results = await (this.store as any)._queryVectors(queryEmbedding, k);

    return results.map((r: any) => r.content);
  }

  async clear(): Promise<void> {
    this.store = new MemoryVectorStore(new LangChainEmbeddings());
  }

  /**
   * 返回 LangChain Retriever 实例，可用于链或作为工具。
   * `options` 与 `MemoryVectorStore.asRetriever` 参数一致，如 `{ k, searchType, filter }`。
   * 这里不指定具体返回类型以避免类型依赖问题。
   */
  getRetriever(options?: any) {
    return this.store.asRetriever(options as any);
  }
}