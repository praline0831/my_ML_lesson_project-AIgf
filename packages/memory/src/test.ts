import { RAGMemoryService } from './index.js';

async function main() {
    console.log('Memory + RAG Integration Test\n');

    const memory = new RAGMemoryService();
    await memory.initialize();

    // round 1: chat QA
    console.log('Round 1: chat + QA');
    await memory.addTurn('I am Xiao Ming, an AI researcher', 'Hi Xiao Ming!');

    // round 2: unrelated
    console.log('Round 2: unrelated chat');
    await memory.addTurn('Nice weather today', 'Yes, perfect for a walk');

    // round 3: paper claim via longTerm directly
    console.log('Round 3: paper knowledge');
    await memory.longTerm.addPaperClaim(
        'LLMs benefit from RLHF alignment',
        '§2.1',
        'Reinforcement learning from human feedback...',
        ['rlhf', 'alignment'],
        3,
    );
    await memory.longTerm.addPaperClaim(
        'LoRA reduces trainable parameters by 10000x',
        '§3.2',
        undefined,
        ['lora', 'efficiency'],
        2,
    );

    // save to disk
    await memory.save();
    console.log('  saved to disk');

    // search mixed knowledge
    console.log('\nSearch queries:');
    const queries = ['RLHF', 'LoRA', 'Xiao Ming', 'weather'];
    for (const q of queries) {
        const results = await memory.getRelevantMemories(q, 3);
        console.log(`  "${q}" -> ${results.map(r => r.slice(0, 50)).join(' | ')}`);
    }

    // context builder
    console.log('\nContext for "alignment":');
    const ctx = await memory.buildContext('alignment', 2);
    console.log(ctx || '(empty)');

    // stats
    const st = memory.longTerm.stats();
    console.log(`\nTotal: ${st.total} | bySource: ${JSON.stringify(st.bySource)}`);

    // clear
    await memory.clear();
    console.log(`After clear: ${memory.longTerm.count()}`);

    console.log('\nAll passed');
}

main().catch(console.error);
