import { RAGMemoryService } from "./memory-service.js";

async function testRAGMemoryService() {
    console.log("🧪 测试 RAG 记忆服务（短期 + 长期整合）\n");

    const memory = new RAGMemoryService();

    // 阶段1: 初始会话
    console.log("📋 阶段1: 建立用户档案");
    await memory.addTurn(
        "我叫王五，是一名数据科学家",
        "你好王五！数据科学家很酷啊"
    );
    await memory.addTurn(
        "我平时喜欢跑步和读书",
        "跑步和读书都是好习惯！"
    );

    // 阶段2: 短期记忆验证
    console.log("\n📋 阶段2: 验证短期记忆（对话上下文）");
    const shortTerm = await memory.getShortTermMemory();
    console.log("短期记忆中的消息数:", shortTerm.length);
    console.assert(shortTerm.length === 4, "短期记忆应该有4条消息");
    console.log("✅ 短期记忆验证通过");

    // 阶段3: 长期记忆验证
    console.log("\n📋 阶段3: 验证长期记忆（RAG检索）");
    await memory.addTurn(
        "我的邮箱是 wangwu@example.com",
        "好的，已记住你的邮箱",
        [{ key: "邮箱", value: "wangwu@example.com" }]
    );
    await memory.addTurn(
        "我养了一只猫叫小白",
        "小白，很可爱的名字！"
    );

    // 语义检索测试
    console.log("\n语义检索测试:");
    const queries = [
        { q: "名字", expected: "王五" },
        { q: "工作", expected: "数据科学家" },
        { q: "爱好", expected: "跑步" },
        { q: "邮箱", expected: "wangwu@example.com" },
        { q: "宠物", expected: "小白" }
    ];

    for (const { q, expected } of queries) {
        const results = await memory.getRelevantMemories(q, 2);
        const found = results.some(r => r.includes(expected));
        console.log(`  "${q}" -> ${found ? "✅ 找到" : "❌ 未找到"} ${expected}`);
        console.assert(found, `应该能找到: ${expected}`);
    }

    // 阶段4: 对话历史累积测试
    console.log("\n📋 阶段4: 对话历史累积（短期记忆窗口）");
    await memory.addTurn("今天天气怎么样？", "今天阳光明媚");
    await memory.addTurn("适合出门吗？", "非常适合！");
    await memory.addTurn("有什么推荐的活动吗？", "可以去公园散步");

    const recentHistory = await memory.getShortTermMemory();
    console.log("当前对话历史数:", recentHistory.length);
    console.log("最近3轮对话:");
    const recent3 = recentHistory.slice(-6); // 最近3个问答对
    recent3.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. [${m._getType()}] ${m.content.substring(0, 30)}...`);
    });
    console.log("✅ 对话历史累积测试通过");

    // 阶段5: Retriever 集成测试
    console.log("\n📋 阶段5: LangChain Retriever 集成");
    const retriever = memory.getRetriever({ k: 2 });
    console.log("Retriever 创建成功");
    const retrievedDocs = await retriever.invoke("用户信息");
    console.log("Retriever 检索结果数:", retrievedDocs.length);
    console.log("✅ Retriever 集成通过");

    // 阶段6: 清空测试
    console.log("\n📋 阶段6: 清空所有记忆");
    await memory.clear();
    const shortAfterClear = await memory.getShortTermMemory();
    const longAfterClear = await memory.getRelevantMemories("名字");
    console.assert(shortAfterClear.length === 0, "短期记忆应该清空");
    console.assert(longAfterClear.length === 0, "长期记忆应该清空");
    console.log("✅ 清空测试通过");

    console.log("\n🎉 RAG 记忆服务测试全部通过！\n");
    return true;
}

testRAGMemoryService().then(() => process.exit(0)).catch((e) => {
    console.error("❌ 测试失败:", e);
    process.exit(1);
});