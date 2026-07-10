import { LongTermMemory } from './long-term-memory.js';

async function testLongTermMemory() {
    console.log('Long-Term Memory Test\n');

    const memory = new LongTermMemory();
    await memory.initialize();

    // 1: add facts
    console.log('Test 1: addFact');
    await memory.addFact('name', 'Alice');
    await memory.addFact('profession', 'ML engineer');
    await memory.addFact('hobby', 'hiking');
    console.log(`  stored: ${memory.count()}`);

    // 2: semantic search
    console.log('\nTest 2: semantic search');
    const r1 = await memory.search('work', 3);
    console.log(`  "work" -> ${r1.map(r => r.content.slice(0, 60)).join(' | ')}`);

    // 3: paper claims
    console.log('\nTest 3: paper claims');
    await memory.addPaperClaim(
        'Multi-head self-attention with RoPE',
        '§3.1',
        'We apply rotary position embeddings to Q and K',
        ['attention', 'transformer'],
        3,
    );
    const r2 = await memory.search('attention', 3);
    console.log(`  "attention" -> ${r2.length} results`);

    // 4: code functions
    console.log('\nTest 4: code functions');
    await memory.addCodeFunction(
        'MultiHeadAttention', 'model.py',
        'def forward(self, x):', 'q = self.q_proj(x); k = self.k_proj(x); ...',
        ['attention', 'transformer'],
    );
    const r3 = await memory.search('MultiHeadAttention', 3);
    console.log(`  code search -> ${r3.length} results`);

    // 5: search by source
    console.log('\nTest 5: searchBySource(paper)');
    const r4 = await memory.searchBySource('paper', 'attention', 5);
    console.log(`  paper -> ${r4.length} results`);

    // 6: alignment
    console.log('\nTest 6: alignment batch');
    await memory.addAlignmentBatch([
        { claim: 'Multi-head attention', location: '§3.1', functionName: 'MultiHeadAttention', functionFile: 'model.py', status: 'match' },
        { claim: 'Cross-entropy loss', location: '§3.3', status: 'missing' },
    ], 'My Paper');
    const r5 = await memory.search('loss', 3);
    console.log(`  alignment search -> ${r5.length} results`);

    // 7: stats
    const st = memory.stats();
    console.log(`\nStats: ${st.total} docs | sources=${JSON.stringify(st.bySource)} | types=${JSON.stringify(st.byType)}`);

    // 8: clear
    await memory.clear();
    console.log(`After clear: ${memory.count()} docs`);

    console.log('\nAll tests passed');
    return true;
}

testLongTermMemory().then(() => process.exit(0)).catch(e => {
    console.error('FAILED:', e);
    process.exit(1);
});
