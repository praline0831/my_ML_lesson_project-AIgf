// Long-term memory storage and retrieval

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  embeddings?: number[];
}

export class LongTermMemory {
  private memories: MemoryEntry[] = [];

  async add(content: string): Promise<void> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      timestamp: Date.now(),
    };
    this.memories.push(entry);
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    return this.memories
      .slice()
      .sort(() => 0.5 - Math.random()) // Placeholder for similarity search
      .slice(0, limit);
  }
}