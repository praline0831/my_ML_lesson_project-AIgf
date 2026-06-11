import { calculatorTool, createAgent, echoTool } from './index.js';

async function main() {
    console.log('🚀 启动 Agent 测试...\n');

    try {
        // 创建 Agent（使用默认本地 Ollama 配置）
        const agent = createAgent({
            verbose: true,
            maxSteps: 5
        });

        // 注册工具
        agent.registerTool('echo', echoTool.execute);
        agent.registerTool('calculator', calculatorTool.execute);

        // 测试 1：简单问答
        console.log('📝 测试 1：简单问答');
        const result1 = await agent.run('你好，请介绍一下你自己');
        console.log('✅ 输出:', result1.finalOutput);
        console.log('📊 步骤数:', result1.steps, '\n');

        // 测试 2：使用工具
        console.log('📝 测试 2：使用计算器工具');
        const result2 = await agent.run('请计算 3 * (5 + 2) 等于多少？');
        console.log('✅ 输出:', result2.finalOutput);
        console.log('📊 步骤数:', result2.steps, '\n');

        // 测试 3：回显工具
        console.log('📝 测试 3：使用回显工具');
        const result3 = await agent.run('请用 echo 工具回显："Hello Ollama"');
        console.log('✅ 输出:', result3.finalOutput);
        console.log('📊 步骤数:', result3.steps, '\n');

        console.log('🎉 所有测试完成！');
    } catch (error) {
        console.error('❌ 错误:', error);
    }
}

main();