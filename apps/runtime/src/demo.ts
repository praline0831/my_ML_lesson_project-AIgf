/**
 * LangGraph 演示脚本
 *
 * 展示 LangGraph 的三大优势：
 * 1. 流程可视化（Mermaid 图）
 * 2. 节点执行轨迹
 * 3. LLM 流式输出
 */
import { Agent } from './agent.js';
import { paperTools } from './paper-tools.js';
import { OllamaClient } from './providers/ollama.js';
import { calculatorTool, echoTool } from './tools.js';
import { AgentConfig } from './types.js';

class DemoAgent extends Agent {
  constructor(config: AgentConfig) {
    super(config);
    // 注册几个工具
    for (const tool of paperTools) {
      this.registerTool(tool.name, tool.execute);
    }
    this.registerTool('echo', echoTool.execute);
    this.registerTool('calculator', calculatorTool.execute);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  🎯 LangGraph Agent 演示');
  console.log('═══════════════════════════════════════════════\n');

  // 创建 Ollama Agent
  const llm = new OllamaClient({
    apiKey: 'ollama',  // Ollama 不需要 key，但接口要求
    endpoint: 'http://localhost:11434',
    model: 'gemma4:31b-cloud',
    temperature: 0.7,
    maxTokens: 2048,
  });

  const agent = new DemoAgent({ maxSteps: 5, verbose: true });
  agent.configureLLM(llm);

  // ──── 演示 1：打印 Mermaid 图 ────
  console.log('📊 【演示1】Mermaid 流程图：');
  console.log('─────────────────────────────────');
  const mermaid = agent.printGraph();
  console.log(mermaid);
  console.log('─────────────────────────────────');
  console.log('💡 把上面这段复制到 https://mermaid.live 看图\n');

  // ──── 演示 2：流式执行 + 节点轨迹 ────
  console.log('🚀 【演示2】流式执行（边跑边输出）：');
  console.log('─────────────────────────────────\n');

  const input = process.argv[2] || '你好，搜索 5 篇关于 transformer 的论文';
  console.log(`👤 用户: ${input}\n`);

  let nodeCount = 0;
  process.stdout.write('🤖 AI: ');

  for await (const chunk of agent.runStream(input)) {
    if (Array.isArray(chunk)) {
      // 结束标记
      const [marker, output] = chunk;
      if (marker === '__DONE__') {
        console.log('\n\n✅ 执行完成');
        console.log(`📝 最终输出: ${output.slice(0, 200)}...`);
      }
    } else if (typeof chunk === 'string') {
      // 节点 trace
      nodeCount++;
      console.log(`\n\n${'='.repeat(50)}`);
      console.log(`📍 节点 #${nodeCount} 执行`);
      console.log(`${'='.repeat(50)}`);
      console.log(chunk);
      process.stdout.write('🤖 AI: ');
    }
  }

  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  ✅ 演示结束');
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
