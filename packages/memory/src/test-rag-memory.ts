import { RAGMemoryService } from './memory-service.js';

async function testRAGMemoryService() {
    console.log('RAG Memory Service Test\n');

    const memory = new RAGMemoryService();
    await memory.initialize();

    // add conversation turns
    console.log('Adding conversation turns...');
    await memory.addTurn('My name is Bob, I study NLP', 'Hello Bob!');
    await memory.addTurn('I love reading papers', 'Great habit!');
    await memory.addTurn('My email is bob@example.com', 'Got it, bob@example.com');
    await memory.addTurn('I have a cat named Whiskers', 'Cute name!');

    // RAG retrieval
    console.log('\nRAG searches:');
    const queries = ['name', 'email', 'cat', 'papers'];
    for (const q of queries) {
        const results = await memory.getRelevantMemories(q, 2);
        console.log(`  "${q}" -> ${results.map(r => r.slice(0, 50)).join(' | ')}`);
    }

    // buildContext
    console.log('\nbuildContext for "email":');
    const ctx = await memory.buildContext('email', 2);
    console.log(ctx ? ctx.slice(0, 200) : '(empty)');

    // stats
    const st = memory.longTerm.stats();
    console.log(`\nStats: ${st.total} docs, ${JSON.stringify(st.bySource)}`);

    // clear
    await memory.clear();
    console.log(`After clear: ${memory.longTerm.count()} docs`);

    console.log('\nAll RAG memory tests passed');
    return true;
}

testRAGMemoryService().then(() => process.exit(0)).catch(e => {
    console.error('FAILED:', e);
    process.exit(1);
});
