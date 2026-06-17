/**
 * Skills 演示脚本
 *
 * 演示如何：
 * 1. 注册/激活 Skill
 * 2. Skill 的 instructions 自动注入 LLM system prompt
 * 3. LLM 可通过 <skill>...</skill> 标签调用 Skill
 * 4. 切换激活状态
 */

import { Agent } from './agent.js';
import { OllamaClient } from './providers/ollama.js';
import {
  builtinSkills,
  webSearchSkill,
  calculatorSkill,
  fileReadSkill,
  SkillsManager,
  Skill,
} from './skills/index.js';
import { AgentConfig } from './types.js';

class SkillDemoAgent extends Agent {
  constructor(config: AgentConfig) {
    super(config);
  }
}

async function section(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60) + '\n');
}

async function main() {
  // ──── 1. 直接使用 SkillsManager（不依赖 Agent）────
  await section('1️⃣  SkillsManager 独立使用');

  const mgr = new SkillsManager();
  mgr.register(webSearchSkill);
  mgr.register(calculatorSkill);
  mgr.register(fileReadSkill);

  console.log('已注册:', mgr.getAll().map((s) => s.name).join(', '));
  console.log('默认激活:', mgr.getActive().map((s) => s.name).join(', ') || '(无)');

  // 手动激活
  mgr.activate('web_search');
  mgr.activate('calculator');
  console.log('激活 web_search + calculator 后:', mgr.getActive().map((s) => s.name).join(', '));

  console.log('\n—— 注入到 LLM 的 system prompt 片段 ——');
  console.log(mgr.buildSystemPrompt());

  // 直接调用 calculator（不走 LLM）
  console.log('\n—— 直接调用 calculator ——');
  const result = await mgr.invoke(
    'calculator',
    { expression: '(3 + 5) * 2' },
    {
      llm: {} as any,
      tools: {},
      agent: {} as any,
    }
  );
  console.log('结果:', result);

  // ──── 2. 接入 Agent，LLM 自动用 <skill> 标签调用 ────
  await section('2️⃣  接入 Agent：LLM 通过 <skill> 标签调用');

  const llm = new OllamaClient({
    apiKey: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'gemma4:31b-cloud',
    temperature: 0.3,
    maxTokens: 2048,
  });

  const agent = new SkillDemoAgent({
    maxSteps: 5,
    verbose: true,
    systemPrompt: '你是一个乐于助人的助手。',
  });
  agent.configureLLM(llm);

  // 一行注册全部内置 skill
  for (const skill of builtinSkills) {
    agent.registerSkill(skill);
  }
  // 激活 calculator + web_search（file-read 默认不激活）
  agent.activateSkill('calculator');
  agent.activateSkill('web_search');

  // 打印 LangGraph 图（注意多了 invoke_skill 节点）
  console.log('📊 当前图结构：');
  console.log(agent.printGraph());

  // 跑一个"用 calculator 算 1+2*3"的问题
  const input = process.argv[2] || '请帮我计算 1 + 2 * 3 等于多少？';
  console.log(`\n👤 用户: ${input}`);
  process.stdout.write('\n🤖 AI: ');

  for await (const chunk of agent.runStream(input)) {
    if (Array.isArray(chunk)) {
      const [marker, output] = chunk;
      if (marker === '__DONE__') {
        console.log('\n\n✅ 完成，最终输出:');
        console.log(output);
      }
    } else {
      // 节点 trace
      console.log(`\n\n${'─'.repeat(50)}\n${chunk}\n${'─'.repeat(50)}`);
      process.stdout.write('🤖 AI: ');
    }
  }

  // ──── 3. 动态切换激活状态 ────
  await section('3️⃣  动态切换激活状态');

  const unsub = mgr.subscribe(() => {
    console.log('🔔 状态变化，当前激活:', mgr.getActive().map((s) => s.name).join(', '));
  });

  mgr.activate('file_read');
  mgr.deactivate('web_search');
  mgr.toggle('calculator'); // 关
  mgr.toggle('calculator'); // 开
  unsub();
}

main().catch((e) => {
  console.error('❌ 错误:', e);
  process.exit(1);
});
