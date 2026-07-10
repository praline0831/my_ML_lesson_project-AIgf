import { LongTermMemory } from './long-term-memory.js';

export interface MemoryConfig {
    /** Directory to persist vector store JSON */
    persistDir?: string;
}

/**
 * Unified memory service.
 *
 * - Short-term memory (conversation context) is handled by the agent's own
 *   `messages` array in LangGraph state — no separate ShortTermMemory needed.
 * - Long-term memory: persistent vector store for papers, code, facts, QA.
 */
export class RAGMemoryService {
    longTerm: LongTermMemory;
    private config?: MemoryConfig;
    private inited = false;

    constructor(config?: MemoryConfig) {
        this.config = config;
        this.longTerm = new LongTermMemory();
    }

    async initialize(): Promise<void> {
        if (this.inited) return;
        await this.longTerm.initialize();
        this.inited = true;
    }

    private async ensureInit(): Promise<void> {
        if (!this.inited) await this.initialize();
    }

    /**
     * Add a single conversation turn as a QA memory entry.
     */
    async addTurn(userMsg: string, aiMsg: string, tags?: string[]): Promise<void> {
        await this.ensureInit();
        if (!userMsg || !aiMsg) return;
        await this.longTerm.addQa(userMsg, aiMsg, tags);
        await this.longTerm.save();
    }

    /**
     * Retrieve relevant memories for a user query (RAG).
     */
    async getRelevantMemories(query: string, k: number = 5): Promise<string[]> {
        await this.ensureInit();
        const results = await this.longTerm.search(query, k);
        return results.map(r => r.content);
    }

    /**
     * Get formatted context string for injection into the LLM prompt.
     */
    async buildContext(query: string, k: number = 3): Promise<string> {
        await this.ensureInit();
        const results = await this.longTerm.search(query, k);
        if (results.length === 0) return '';
        const lines = results.map((r, i) =>
            `[${i + 1}] (${r.metadata.source as string}/${r.metadata.type as string}) ${r.content}`,
        );
        return `\n## Relevant Knowledge\n${lines.join('\n')}\n`;
    }

    async clear(): Promise<void> {
        await this.ensureInit();
        this.longTerm.clear();
    }

    async save(): Promise<void> {
        await this.ensureInit();
        await this.longTerm.save();
    }
}
