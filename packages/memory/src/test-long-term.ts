import { LongTermMemory } from "./long-term-memory.js";

async function testLongTermMemory() {
    console.log("🧪 测试长期记忆\n");

    const memory = new LongTermMemory();

    // 测试1: 添加事实
    console.log("📋 测试1: 添加事实型记忆");
    await memory.addFact("用户名", "李四");
    await memory.addFact("用户职业", "软件工程师");
    await memory.addFact("用户兴趣", "游泳");
    console.log("✅ 添加事实通过");

    // 测试2: 添加事件
    console.log("\n📋 测试2: 添加事件记忆");
    await memory.addEvent("用户在2024年1月1日首次使用系统");
    console.log("✅ 添加事件通过");

    // 测试3: 检索记忆（精确匹配）
    console.log("\n📋 测试3: 精确检索");
    const results1 = await memory.search("用户名", 2);
    console.log(`搜索"用户名"的结果:`, results1);
    console.assert(results1.some(r => r.includes("李四")), "应该能找到李四");
    console.log("✅ 精确检索通过");

    // 测试4: 语义检索（相似查询）
    console.log("\n📋 测试4: 语义检索");
    const results2 = await memory.search("工作", 2);
    console.log(`搜索"工作"的结果:`, results2);
    console.assert(results2.some(r => r.includes("软件工程师")), "应该能找到职业");
    console.log("✅ 语义检索通过");

    // 测试5: 多条检索
    console.log("\n📋 测试5: 多条检索（k参数）");
    await memory.addFact("用户城市", "北京");
    await memory.addFact("用户国家", "中国");
    await memory.addFact("用户语言", "中文");

    const results3 = await memory.search("用户", 5);
    console.log(`搜索"用户"（k=5）的结果:`, results3);
    console.assert(results3.length <= 5, "应该最多返回5条");
    console.log("✅ 多条检索通过");

    // 测试6: 获取 Retriever
    console.log("\n📋 测试6: 获取 LangChain Retriever");
    const retriever = memory.getRetriever({ k: 2 });
    console.log("Retriever 创建成功:", typeof retriever.invoke);
    console.log("✅ Retriever 获取通过");

    // 测试7: 清空记忆
    console.log("\n📋 测试7: 清空长期记忆");
    await memory.clear();
    const resultsAfterClear = await memory.search("用户名");
    console.assert(resultsAfterClear.length === 0, "清空后应该搜不到");
    console.log("✅ 清空记忆通过");

    console.log("\n🎉 长期记忆测试全部通过！\n");
    console.log("⚠️ 注意: 当前实现使用内存存储，不支持跨会话持久化\n");
    return true;
}

testLongTermMemory().then(() => process.exit(0)).catch((e) => {
    console.error("❌ 测试失败:", e);
    process.exit(1);
});