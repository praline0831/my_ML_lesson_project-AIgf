import { RAGMemoryService } from "./index.js";

async function main() {
    console.log("🌟 测试开始：短期 + 长期记忆 RAG\n");

    const memory = new RAGMemoryService();

    // 第一轮：添加事实（长期记忆） + 对话（短期记忆）
    console.log("📝 轮次 1：初次介绍（建立长期记忆）");
    await memory.addTurn(
        "我叫小明，是一名 AI 研究员，喜欢研究大语言模型",
        "你好小明！AI 研究员很酷，我最喜欢和聪明的人聊天了",
        [{ key: "name", value: "小明" }, { key: "profession", value: "AI 研究员" }]
    );

    // 第二轮：无关对话（短期记忆）
    console.log("\n📝 轮次 2：聊天气（短期记忆）");
    await memory.addTurn(
        "今天天气真好",
        "是啊，阳光明媚，适合出去散步"
    );

    // 第三轮：新事实（长期记忆）
    console.log("\n📝 轮次 3：添加新兴趣（更新长期记忆）");
    await memory.addTurn(
        "我最近开始学习钢琴，已经能弹《River Flows in You》了",
        "太棒了！音乐能让人心情愉悦，你弹得一定很美",
        [{ key: "hobby", value: "钢琴" }, { key: "song", value: "River Flows in You" }]
    );

    // 中间插入更多短期对话
    console.log("\n📝 轮次 4-6：无关对话（短期记忆）");
    await memory.addTurn("你觉得 AI 会取代人类吗？", "AI 是工具，人类才是创造者");
    await memory.addTurn("今天吃了什么？", "我吃了意大利面");
    await memory.addTurn("喜欢什么颜色？", "我喜欢蓝色，像大海一样宁静");

    // 第七轮：测试短期记忆（对话上下文）
    console.log("\n📝 轮次 7：测试短期记忆（对话上下文）");
    const shortMemories = await memory.getShortTermMemory();
    console.log("🎯 短期记忆（最近 3 条对话）:");
    const recentShort = await memory["shortTerm"].getRecentMessages(3);
    recentShort.forEach((msg: any, i: number) => {
        console.log(`  ${i + 1}. [${msg._getType()}] ${msg.content}`);
    });

    // 第八轮：测试长期记忆（RAG）
    console.log("\n📝 轮次 8：测试长期记忆（RAG 检索）");
    const queries = [
        "我叫什么名字？",
        "我从事什么工作？",
        "我最近在学什么？",
        "我喜欢什么颜色？"
    ];

    for (const query of queries) {
        console.log(`\n❓ 查询: "${query}"`);
        const relevant = await memory.getRelevantMemories(query, 2);
        console.log("✅ 检索到的长期记忆:");
        relevant.forEach((mem: string, i: number) => {
            console.log(`  ${i + 1}. ${mem}`);
        });
    }

    // 第九轮：测试清空记忆
    console.log("\n🗑️ 测试清空记忆");
    await memory.clear();
    console.log("✅ 短期记忆已清空");
    console.log("✅ 长期记忆已清空");

    console.log("\n✅ 测试完成！");
    console.log("💡 关键点:");
    console.log("  - 短期记忆：对话上下文（轮次 7）");
    console.log("  - 长期记忆：用户事实（轮次 8）");
    console.log("  - RAG：向量检索，不是简单返回文本");
}

main().catch(console.error);