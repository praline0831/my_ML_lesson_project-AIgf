import { PersistentVectorStore } from './vector-store.js';

export interface KnowledgeItem {
    id: string;
    content: string;
    metadata: {
        /** 'paper' | 'chat' | 'alignment' | 'summary' | 'fact' */
        source: string;
        /** 'claim' | 'code' | 'qa' | 'summary' | 'fact' | 'function' */
        type: string;
        title?: string;
        tags?: string[];
        importance?: 1 | 2 | 3;
        timestamp: number;
        [key: string]: unknown;
    };
}

interface SearchResult {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
}

function textForClaim(description: string, location: string, quote?: string): string {
    let t = `[Paper Claim] ${description}`;
    if (quote) t += ` (${quote.slice(0, 200)})`;
    t += ` @ ${location}`;
    return t;
}

function textForFunction(name: string, file: string, signature: string, body: string): string {
    const snippet = body.replace(/\s+/g, ' ').slice(0, 300);
    return `[Code Function] ${name} in ${file} | signature: ${signature} | body: ${snippet}`;
}

function textForQa(question: string, answer: string): string {
    return `[QA] Q: ${question} | A: ${answer.slice(0, 500)}`;
}

function textForSummary(topic: string, summary: string): string {
    return `[Summary] ${topic}: ${summary.slice(0, 500)}`;
}

export class LongTermMemory {
    private store: PersistentVectorStore;

    constructor(path?: string) {
        this.store = new PersistentVectorStore(path);
    }

    async initialize(): Promise<void> {
        await this.store.initialize();
    }

    // ─── Typed adders ───────────────────────────

    async addPaperClaim(
        description: string,
        location: string,
        quote?: string,
        tags?: string[],
        importance?: 1 | 2 | 3,
    ): Promise<string> {
        return await this.store.add(textForClaim(description, location, quote), {
            source: 'paper',
            type: 'claim',
            tags: tags || [],
            importance: importance || 2,
            description,
            location,
        });
    }

    async addCodeFunction(
        name: string,
        file: string,
        signature: string,
        body: string,
        tags?: string[],
    ): Promise<string> {
        return await this.store.add(textForFunction(name, file, signature, body), {
            source: 'paper',
            type: 'function',
            tags: tags || [],
            name,
            file,
        });
    }

    async addAlignmentResult(
        claimDescription: string,
        claimLocation: string,
        functionName: string,
        functionFile: string,
        status: string,
        tags?: string[],
    ): Promise<string> {
        const content = `[Alignment] "${claimDescription}" ↔ ${functionName} in ${functionFile} (${status})`;
        return await this.store.add(content, {
            source: 'alignment',
            type: 'claim',
            tags: tags || [],
            status,
            claimDescription,
            functionName,
            functionFile,
        });
    }

    async addQa(question: string, answer: string, tags?: string[]): Promise<string> {
        return await this.store.add(textForQa(question, answer), {
            source: 'chat',
            type: 'qa',
            tags: tags || [],
            question,
        });
    }

    async addFact(key: string, value: string, tags?: string[]): Promise<string> {
        return await this.store.add(`[Fact] ${key}: ${value}`, {
            source: 'chat',
            type: 'fact',
            tags: tags || [],
            key,
        });
    }

    async addSummary(topic: string, summary: string, tags?: string[]): Promise<string> {
        return await this.store.add(textForSummary(topic, summary), {
            source: 'summary',
            type: 'summary',
            tags: tags || [],
            topic,
        });
    }

    // ─── Batch ─────────────────────────────────

    async addAlignmentBatch(
        rows: { claim: string; location: string; functionName?: string; functionFile?: string; status: string }[],
        paperTitle?: string,
    ): Promise<void> {
        const items = rows.map(r => {
            const content = r.functionName
                ? `[Alignment] "${r.claim}" ↔ ${r.functionName} in ${r.functionFile} (${r.status})`
                : `[Alignment] "${r.claim}" → no match (${r.status})`;
            return {
                content,
                metadata: {
                    source: 'alignment',
                    type: 'claim',
                    tags: paperTitle ? [paperTitle] : [],
                    status: r.status,
                    claimDescription: r.claim,
                    functionName: r.functionName,
                    functionFile: r.functionFile,
                },
            };
        });
        await this.store.addBatch(items);
    }

    // ─── Search & retrieval ────────────────────

    async search(query: string, k: number = 5, filter?: (meta: Record<string, unknown>) => boolean): Promise<SearchResult[]> {
        return await this.store.search(query, k, filter);
    }

    async searchBySource(source: string, query: string, k: number = 5): Promise<SearchResult[]> {
        return await this.store.search(query, k, m => (m.source as string) === source);
    }

    async searchByType(type: string, query: string, k: number = 5): Promise<SearchResult[]> {
        return await this.store.search(query, k, m => (m.type as string) === type);
    }

    // ─── Admin ─────────────────────────────────

    getAll(): KnowledgeItem[] {
        return this.store.getAll().map(d => ({
            id: d.id,
            content: d.content,
            metadata: d.metadata as KnowledgeItem['metadata'],
        }));
    }

    stats() {
        return this.store.stats();
    }

    count(): number {
        return this.store.count();
    }

    clear(): void {
        this.store.clear();
    }

    async save(): Promise<void> {
        await this.store.save();
    }

    async delete(id: string): Promise<boolean> {
        return this.store.delete(id);
    }
}
