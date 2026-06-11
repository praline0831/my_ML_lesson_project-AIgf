import { ShortTermMemory } from "./short-term-memory.js";

async function testShortTermMemory() {
    console.log("🧪 测试短期记忆\n");

    const memory = new ShortTermMemory();

    // 测试1: 添加用户消息
    console.log("📋 测试1: 添加用户消息");
    await memory.addUserMessage("我叫张三");
    const msgs1 = await memory.getMessages();
    console.assert(msgs1.length === 1, "应该有1条消息");
    console.assert(msgs1[0].content === "我叫张三", "消息内容应该匹配");
    console.log("✅ 添加用户消息通过");

    // 测试2: 添加AI消息
    console.log("\n📋 测试2: 添加AI消息");
    await memory.addAIMessage("你好张三！");
    const msgs2 = await memory.getMessages();
    console.assert(msgs2.length === 2, "应该有2条消息");
    console.log("✅ 添加AI消息通过");

    // 测试3: 获取所有消息
    console.log("\n📋 测试3: 获取所有消息");
    console.log("所有消息:", msgs2.map((m: any) => `[${m._getType()}] ${m.content}`));
    console.log("✅ 获取所有消息通过");

    // 测试4: 获取最近n条消息（窗口测试）
    console.log("\n📋 测试4: 获取最近消息（滑动窗口）");
    await memory.addUserMessage("我今天25岁");
    await memory.addAIMessage("好的，记住了！");

    const recent1 = await memory.getRecentMessages(2);
    console.log("最近2条:", recent1.map((m: any) => `[${m._getType()}] ${m.content}`));
    console.assert(recent1.length === 2, "应该返回2条");

    const recent3 = await memory.getRecentMessages(3);
    console.log("最近3条:", recent3.map((m: any) => `[${m._getType()}] ${m.content}`));
    console.assert(recent3.length === 3, "应该返回3条");
    console.log("✅ 滑动窗口通过");

    // 测试5: 清空记忆
    console.log("\n📋 测试5: 清空短期记忆");
    await memory.clear();
    const msgsAfterClear = await memory.getMessages();
    console.assert(msgsAfterClear.length === 0, "清空后应该没有消息");
    console.log("✅ 清空记忆通过");

    console.log("\n🎉 短期记忆测试全部通过！\n");
    return true;
}

testShortTermMemory().then(() => process.exit(0)).catch((e) => {
    console.error("❌ 测试失败:", e);
    process.exit(1);
});