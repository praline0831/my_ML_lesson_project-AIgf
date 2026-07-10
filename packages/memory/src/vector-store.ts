import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { normalize, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_DIR = resolve(process.cwd(), 'data', 'memory');
const DEFAULT_PATH = resolve(STORAGE_DIR, 'vectors.json');

interface StoredDoc {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function embedOllama(text: string): Promise<number[]> {
    const res = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'shaw/dmeta-embedding-zh:latest',
            prompt: text,
        }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings error: ${res.status}`);
    const data = await res.json();
    return data.embedding as number[];
}

export class PersistentVectorStore {
    private docs: StoredDoc[] = [];
    private path: string;
    private dirty = false;

    constructor(path?: string) {
        this.path = path || DEFAULT_PATH;
    }

    async initialize(): Promise<void> {
        if (!existsSync(STORAGE_DIR)) {
            mkdirSync(STORAGE_DIR, { recursive: true });
        }
        await this.load();
    }

    async add(
        content: string,
        metadata: Record<string, unknown> = {},
    ): Promise<string> {
        const embedding = await embedOllama(normalizeText(content));
        const id = uuidv4();
        this.docs.push({
            id,
            content,
            metadata: { ...metadata, timestamp: Date.now() },
            embedding,
        });
        this.dirty = true;
        return id;
    }

    async addBatch(
        items: { content: string; metadata?: Record<string, unknown> }[],
    ): Promise<string[]> {
        const texts = items.map(i => normalizeText(i.content));
        const embeddings = await Promise.all(texts.map(embedOllama));
        const ids: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const id = uuidv4();
            this.docs.push({
                id,
                content: items[i].content,
                metadata: { ...items[i].metadata, timestamp: Date.now() },
                embedding: embeddings[i],
            });
            ids.push(id);
        }
        this.dirty = true;
        return ids;
    }

    async search(
        query: string,
        k: number = 5,
        filter?: (meta: Record<string, unknown>) => boolean,
    ): Promise<{ content: string; metadata: Record<string, unknown>; score: number; id: string }[]> {
        const qEmbed = await embedOllama(normalizeText(query));
        const filtered = filter
            ? this.docs.filter(d => filter(d.metadata))
            : this.docs;
        const scored = filtered
            .map(d => ({ ...d, score: cosineSimilarity(qEmbed, d.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        return scored.map(d => ({
            id: d.id,
            content: d.content,
            metadata: d.metadata,
            score: d.score,
        }));
    }

    getAll(): StoredDoc[] {
        return [...this.docs];
    }

    getById(id: string): StoredDoc | undefined {
        return this.docs.find(d => d.id === id);
    }

    delete(id: string): boolean {
        const idx = this.docs.findIndex(d => d.id === id);
        if (idx === -1) return false;
        this.docs.splice(idx, 1);
        this.dirty = true;
        return true;
    }

    clear(): void {
        this.docs = [];
        this.dirty = true;
    }

    stats(): { total: number; bySource: Record<string, number>; byType: Record<string, number> } {
        const bySource: Record<string, number> = {};
        const byType: Record<string, number> = {};
        for (const d of this.docs) {
            const s = (d.metadata.source as string) || 'unknown';
            const t = (d.metadata.type as string) || 'unknown';
            bySource[s] = (bySource[s] || 0) + 1;
            byType[t] = (byType[t] || 0) + 1;
        }
        return { total: this.docs.length, bySource, byType };
    }

    count(): number {
        return this.docs.length;
    }

    async save(): Promise<void> {
        if (!this.dirty) return;
        if (!existsSync(STORAGE_DIR)) {
            mkdirSync(STORAGE_DIR, { recursive: true });
        }
        writeFileSync(this.path, JSON.stringify(this.docs, null, 2), 'utf-8');
        this.dirty = false;
    }

    private async load(): Promise<void> {
        if (!existsSync(this.path)) return;
        try {
            const raw = readFileSync(this.path, 'utf-8');
            this.docs = JSON.parse(raw);
        } catch {
            this.docs = [];
        }
        this.dirty = false;
    }
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}
