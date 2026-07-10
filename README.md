# 论文-代码对齐助手 Agent

> 一个面向研究场景的全栈 AI Agent 系统：论文检索 · 深度研究 · 论文-代码对齐 · 多轮对话 · RAG 持久化记忆 · Agent 间通信 · Human-in-the-loop。

---

## 目录

- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [运行](#运行)
- [Human-in-the-loop 确认机制](#human-in-the-loop-确认机制)
- [Agent 间通信：align_paper 工具](#agent-间通信align_paper-工具)
- [API 端点](#api-端点)
- [Web UI 功能说明](#web-ui-功能说明)
- [应用模块](#应用模块)
  - [apps/gateway — API 网关](#appsgateway--api-网关)
  - [apps/runtime — Agent 运行时](#appsruntime--agent-运行时)
  - [apps/web — Web 前端](#appsweb--web-前端)
- [核心包](#核心包)
  - [@agent/paper — 论文检索 & 深度研究](#agentpaper--论文检索--深度研究)
  - [@agent/paper-align — 论文-代码对齐](#agentpaper-align--论文-代码对齐)
  - [@agent/memory — RAG 持久化记忆 + 论文知识库](#agentmemory--rag-持久化记忆--论文知识库)
- [Skills 系统](#skills-系统)
- [关键设计模式](#关键设计模式)
- [环境依赖](#环境依赖)
- [配置](#配置)
- [测试](#测试)
- [构建与部署](#构建与部署)

---

## 核心特性

| 模块 | 能力 |
|------|------|
| **LangGraph Agent** | StateGraph 状态图编排：`retrieve→think→(act→think)→summarize→END`；ReAct 工具调用；SSE 流式 |
| **Human-in-the-loop** | 工具调用前弹出确认对话框，展示工具名和参数，用户批准后才执行（30 秒超时自动拒绝） |
| **Agent 间通信** | Chat Agent 通过 `align_paper` 工具委托 PaperAlign Agent 干活，共享同一 LLM 实例 |
| **RAG 持久化记忆** | `PersistentVectorStore`（自实现，JSON 持久化）+ 结构化 metadata；自动总结 |
| **Skills 框架** | Claude 风格的 Skill 注册/激活/指令注入；内置 webSearch / calculator |
| **论文检索** | arXiv API 集成；多轮 sub-query 生成 |
| **深度研究** | 多轮迭代检索 → 去重 → 摘要 → 综合；生成结构化研究报告 |
| **论文-代码对齐** | 抽取论文 claim → 抓取 GitHub 仓库 → 抽取关键函数 → LLM 逐条对齐；行级证据定位 |
| **Markdown + LaTeX 渲染** | react-markdown + remark-gfm + remark-math + rehype-katex |
| **流式接口** | SSE (Server-Sent Events) 实时返回 token、节点轨迹、确认请求、错误 |
| **本地 LLM** | 通过 Ollama 运行本地模型（gemma4:31b-cloud / kimi-k2.5:cloud） |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web 浏览器 (React 18 + Vite)                  │
│  · 论文搜索 / 深度研究 / 对话 / 论文-代码对齐 / 知识库面板       │
│  · Human-in-the-loop 确认弹窗 · 执行轨迹 Timeline               │
│  · Markdown + LaTeX / 代码高亮                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP + SSE
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  apps/gateway (Express)                          │
│  /chat/stream · /papers/* · /align/* · /memory/*                │
│  /chat/confirm (Human-in-the-loop) · /align/last-result          │
│                                                                  │
│  ┌─ align_paper 工具 ────────────────────────────────────────┐  │
│  │ Chat Agent ──委托──→ PaperAlignAgent                      │  │
│  │             共享 LLM 实例 (getLLMProvider())               │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────┬────────────────────────────────┬─────────────────────────┘
       │                                │
       ▼                                ▼
┌────────────────────────┐    ┌──────────────────────────────┐
│  apps/runtime           │    │  @agent/paper-align          │
│  ┌────────────────────┐ │    │  · 论文解析 (maxChars=15000)│
│  │ LangGraph StateGraph│ │    │  · GitHub 仓库抓取          │
│  │                    │ │    │  · 单轮对齐 + 行级证据      │
│  │ retrieve (RAG)     │ │    │  · LLM 复用 (LLMProviderAdapter)│
│  │    ↓               │ │    └──────────────────────────────┘
│  │ think (LLM)        │ │
│  │    ↓ (conditional) │ │    ┌──────────────────────────────┐
│  │ ┌──────────┐       │ │    │  @agent/memory (持久化 RAG)  │
│  │ │ act      │       │ │    │  · PersistentVectorStore     │
│  │ │ (tool)   │       │ │    │  · JSON 持久化               │
│  │ │ ╠═HITL═══╣       │ │    │  · 结构化 metadata           │
│  │ │ ║ 确认   ║       │ │    └──────────────────────────────┘
│  │ │ ╚════════╝       │ │
│  │ └────┬─────┘       │ │    ┌──────────────────────────────┐
│  │      ↓ (loop)      │ │    │  @agent/paper                │
│  │ summarize (每3轮)  │ │    │  · ArXiv 检索                │
│  └────────────────────┘ │    │  · 多轮深度研究               │
└────────────────────────┘    └──────────────────────────────┘
                       │
                       ▼
              ┌──────────────────────┐
              │  Ollama (localhost)   │
              │  · gemma4:31b-cloud   │
              │  · Embeddings 服务    │
              └──────────────────────┘
```

---

## 快速开始

```bash
# 1. 克隆
git clone <repo-url> && cd my_project

# 2. 安装
npm install

# 3. 编译
npm run build

# 4. 启动 Ollama
ollama pull gemma4:31b-cloud
ollama pull shaw/dmeta-embedding-zh
ollama serve

# 5. 启动网关（终端 1）
npm run dev:gateway

# 6. 启动 Web（终端 2）
npm run dev:web
```

Web 默认运行在 `http://localhost:5173`，网关在 `http://localhost:4000`。

---

## 运行

```bash
npm run dev:gateway    # API 网关
npm run dev:runtime    # runtime（watch 模式）
npm run dev:web        # Web Vite dev server
npm run build          # 全量构建
npm run test           # 全量测试
```

---

## Human-in-the-loop 确认机制

### 触发条件

当 Chat Agent 的 LLM 决定调用外部工具时（`search_arxiv`、`deep_research`、`align_paper`、`calculator` 等），`act` 节点会在 **真正执行工具之前** 暂停，等待用户确认：

### 流程

```
LLM 输出 <tool>{"name":"...","args":{...}}</tool>
  │
  ▼
think 节点 → 条件路由 → act 节点
  │
  ├─ 生成确认 ID → 存入 Agent.confirmQueue
  ├─ 通过 SSE 发送 {type:"confirm", id, name, args}
  ├─ 前端弹出 ConfirmDialog 对话框
  │   ├─ 显示工具名 (如 align_paper)
  │   ├─ 显示参数 (如 {"arxiv_id":"2106.09685"})
  │   └─ 允许 / 拒绝 按钮
  │
  ├─ 用户点击"允许"
  │   └─ POST /chat/confirm {id, decision:true}
  │       → Agent.resolveConfirm() → Promise resolve
  │       → act 继续执行工具
  │
  ├─ 用户点击"拒绝"
  │   └─ POST /chat/confirm {id, decision:false}
  │       → act 返回"用户取消了工具调用"的 ToolMessage
  │       → LLM 解释给用户
  │
  └─ 30 秒无响应 → 超时自动拒绝
```

### 实现位置

| 层 | 文件 | 说明 |
|----|------|------|
| Runtime | `agent.ts:332` | `act` 节点创建 Promise → emit `onConfirm` → 等待决议 |
| Runtime | `agent.ts:99` | `Agent.confirmQueue` 静态 Map 存储待决请求 |
| Gateway | `server.ts:111` | `onConfirm` 回调发送 SSE 事件；`/chat/confirm` 端点注入决议 |
| Frontend | `UnifiedResearchApp.tsx:754` | `ConfirmDialog` 组件，显示工具名 + 参数 + 允许/拒绝按钮 |

### 覆盖范围

所有 `registerTool()` 注册的工具：

- `search_arxiv` — 搜索论文
- `deep_research` — 深度研究
- `align_paper` — 论文-代码对齐
- `calculator` — 数学计算

---

## Agent 间通信：align_paper 工具

### 架构

```
用户: "帮我对齐 2106.09685"
  │
  ▼
Chat Agent (LangGraph)
  │
  ├─ think 节点: LLM 看到 align_paper 工具
  ├─ act 节点: HITL 确认 → 执行工具
  │
  ├─ align_paper 工具 (gateway/server.ts)
  │   ├─ 通过 agent.getLLMProvider() 获取共享 LLM
  │   ├─ new LLMProviderAdapter(sharedProvider) 适配 PaperAlignAgent
  │   ├─ await PaperAlignAgent.align(arxivId, repoUrl)
  │   ├─ 注入 memory (自动持久化对齐结果)
  │   └─ 返回格式化文本
  │
  ├─ 结果存入 lastAlignReport → GET /align/last-result
  └─ 前端: 聊天输出 + 下方对齐面板同步更新
```

### 与 gateway 独立端点的关系

| 方式 | 入口 | 状态 |
|------|------|------|
| 聊天委托 | 对话框说"帮我对齐这篇论文" | ✅ 新实现，Agent 间通信 |
| 独立面板 | 填写 arXiv ID + GitHub URL → 点击"开始对齐" | ✅ 保留，SSE 流式进度 |
| 对齐结果 | 两种方式都写入 `lastAlignReport` | ✅ 前端自动同步 |

### 实现关键点

- **共享 LLM 实例**：`LLMProviderAdapter` 将 `OllamaAgent.getLLMProvider()` 适配为 `PaperAlignAgent` 需要的 `LLMClient`，保证模型/温度/endpoint 完全一致
- **JSON 截断保护**：论文正文截断为 15000 字符（原 50000），避免 LLM 输出被 token 上限截断
- **JSON 解析容错**：`extractJson` 自动去除 ` ```json ` 前缀、补全缺失括号

---

## API 端点

### 网关元信息

```bash
curl http://localhost:4000/
```

### 对话

```bash
# 阻塞
curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"解释一下 LoRA"}'

# 流式 (SSE) — 推荐
curl -X POST http://localhost:4000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"什么是 RAG？"}'
```

### Human-in-the-loop

```bash
# 批准工具调用
curl -X POST http://localhost:4000/chat/confirm \
  -H "Content-Type: application/json" \
  -d '{"id":"uuid-from-confirm-event","decision":true}'

# 拒绝
curl -X POST http://localhost:4000/chat/confirm \
  -H "Content-Type: application/json" \
  -d '{"id":"uuid-from-confirm-event","decision":false}'
```

### 论文检索

```bash
curl 'http://localhost:4000/papers/search?q=low%20rank%20adaptation&max=10'

curl -X POST http://localhost:4000/papers/deep-research \
  -H "Content-Type: application/json" \
  -d '{"topic":"LoRA 微调方法","rounds":3,"per_round":8}'
```

### 论文-代码对齐

```bash
# 流式对齐（独立面板使用）
curl -X POST http://localhost:4000/align/run \
  -H "Content-Type: application/json" \
  -d '{"arxiv_id":"2106.09685","repo_url":"https://github.com/microsoft/LoRA"}'

# 获取最近一次对齐报告（align_paper 工具写入）
curl http://localhost:4000/align/last-result

# 导出
curl -X POST http://localhost:4000/align/export \
  -H "Content-Type: application/json" \
  -d '{"markdown":"...","arxiv_id":"2106.09685"}' -o report.md
```

### 记忆系统

```bash
GET  /memory/stats          # 知识库统计
POST /memory/search         # 语义检索 { query, k }
GET  /memory/recent         # 最近 50 条
```

### SSE 事件格式

| 事件 | 字段 | 说明 |
|------|------|------|
| `type:"token"` | content | LLM 生成的文本 token |
| `type:"node"` | name, trace | 节点执行轨迹（retrieve/think/act/summarize）|
| `type:"confirm"` | id, name, args | 请求用户确认工具调用 |
| `type:"done"` | output, id | 对话完成 |
| `type:"error"` | error | 执行出错 |

---

## Web UI 功能说明

### 论文搜索
- arXiv 关键词检索
- 摘要、作者、PDF 链接
- 一键填入对齐面板

### 论文-代码对齐
- 左侧：每条 Claim 卡片（描述 + 状态徽章 + 行号）
- 右侧：代码查看器（语法高亮、行号重映射、焦点行高亮）
- 顶部统计：✅ 匹配 / 🟡 部分 / ❌ 偏差 / ❔ 缺失
- 聊天对齐结果自动同步到此面板

### 深度对话
- 多轮对话（Markdown + LaTeX 渲染）
- 工具调用结果展示
- 执行轨迹 Timeline：实时显示 `retrieve → think → act → ...` 的节点流转
- **Human-in-the-loop**：弹出确认对话框，展示工具名和参数
- 上下文注入：对齐结果自动加载到对话

### 知识库 (RAG Memory)
- 统计：知识条目总数 / 按来源分布
- 搜索：语义检索知识条目
- 最近条目列表

---

## 应用模块

### apps/gateway — API 网关

Express 服务器，统一对外暴露能力。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/chat` | 单次对话 |
| POST | `/chat/stream` | SSE 流式对话 |
| POST | `/chat/confirm` | Human-in-the-loop 确认 |
| GET | `/papers/search?q=&max=` | arXiv 检索 |
| POST | `/papers/deep-research` | 深度研究 |
| POST | `/papers/export-analysis` | 导出分析 |
| POST | `/align/run` | 对齐（SSE 流式）|
| POST | `/align/export` | 导出报告 |
| GET | `/align/last-result` | 最近一次对齐结果 |
| GET | `/memory/stats` | 知识库统计 |
| POST | `/memory/search` | 知识库检索 |
| GET | `/memory/recent` | 最近条目 |

### apps/runtime — Agent 运行时

核心基于 **LangGraph StateGraph**。

**GraphState 定义**：

```typescript
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  steps: Annotation<number>({
    reducer: (x, y) => x + y,
    default: () => 0,
  }),
  finalOutput: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => '',
  }),
  trace: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (_x, y) => y,
    default: () => 0,
  }),
});
```

**执行流程**：

```
START → [retrieve] (RAG 查询)
         → [think] (LLM 推理)
              → [act] (HITL 确认 → 执行 <tool>) → [think] (循环)
              → [summarize] (每 3 轮自动总结 → 写入长期记忆)
              → END
```

**Agent 类层次**：
- `Agent`（基类）— 定义 LangGraph StateGraph、tool 注册、confirmQueue、自动总结
- `OllamaAgent` — Ollama 适配（错误处理 + 兼容两种格式的 tool call 解析）

**关键能力**：
- 工具调度 + HITL 确认
- Skills 指令注入到 system prompt
- RAG 记忆：retrieve 节点自动检索长期记忆
- 自动总结：每 3 轮自动调用 LLM 总结
- 流式回调：onToken / onNode / onTrace / onConfirm / onMessage
- LLM 复用：getLLMProvider() 暴露 OllamaClient 实例

### apps/web — Web 前端

React 18 + Vite 单页应用。包含：
- **论文搜索**：arXiv 检索
- **论文-代码对齐**：匹配矩阵 + CodeViewer
- **深度对话**：Markdown 渲染 + Timeline + HITL 确认弹窗 + Memory 面板

---

## 核心包

### @agent/paper — 论文检索 & 深度研究

- `arxiv.ts`：arXiv API 客户端
- `deep-research.ts`：多轮深度研究编排
  - 关键词提取 + sub-query 生成
  - 论文去重 + 累积摘要 + 综合报告

### @agent/paper-align — 论文-代码对齐

**流程**：

```
arXiv ID → PaperParser (论文解析)
             │ → ar5iv HTML → 纯文本
             │ → LLM 抽取 claims (15 条, maxChars=15000)
             ▼
         RepoFetcher (GitHub API)
             │ → 文件树 + 候选 .py 文件
             ▼
         extractPythonFunctions (方法级提取)
             │ → class.method 拆分为独立条目
             ▼
         Aligner (单轮对齐)
             │ → LLM 逐条匹配 claim ↔ function
             │ → status + evidenceLine + reasoning
             ▼
         Reporter → AlignmentReport + Markdown
```

**LLM 适配**：

```typescript
// 共享 LLM 实例
const sharedProvider = agent.getLLMProvider();
const alignAgent = new PaperAlignAgent({
  llm: new LLMProviderAdapter(sharedProvider),
});
```

### @agent/memory — RAG 持久化记忆 + 论文知识库

**3 个核心类**：

| 类 | 职责 |
|----|------|
| `PersistentVectorStore` | 自实现向量存储；cosineSimilarity；JSON 序列化到 `data/memory/vectors.json` |
| `LongTermMemory` | 类型化知识接口：`addPaperClaim()` / `addCodeFunction()` / `addAlignmentResult()` / `addQa()` / `addSummary()` |
| `RAGMemoryService` | 统一入口；懒初始化 + 自动保存 |

---

## Skills 系统

仿 Claude "Skills" 机制——可注册的工具集，通过 `SkillsManager` 管理激活状态，自动把激活 skill 的 instructions 注入到 system prompt。

**核心 API**：

```typescript
const mgr = new SkillsManager();
mgr.register(calculatorSkill);
mgr.activate('calculator');
mgr.deactivate('web-search');
const systemPrompt = mgr.buildSystemPrompt();
const result = await mgr.invoke('calculator', { expression: '1+1' }, ctx);
```

**内置 Skills**：

| Skill | 功能 |
|-------|------|
| `webSearch` | 联网搜索 |
| `calculator` | 数学计算 |

---

## 关键设计模式

### 1. LLM Provider 抽象 + 适配器
`LLMProvider` 接口统一 `generateText` / `generateStream`。`LLMProviderAdapter` 让 paper-align agent 复用 runtime 的 LLM 实例。

### 2. 状态图驱动的 Agent
Agent 行为建模为 StateGraph 节点（retrieve / think / act / summarize），通过 Annotation 管理状态。LLM 输出 → 条件路由 → 状态更新。

### 3. SSE 流式响应
网关把内部回调（`StreamCallbacks`）桥接到 HTTP SSE。事件类型：`token` / `node` / `confirm` / `done` / `error`。

### 4. Human-in-the-loop
静态 `confirmQueue` + Promise 等待模式：act 节点创建 Promise → emit confirm 事件 → 等待 `/chat/confirm` 决议 → 继续或拒绝。

### 5. Agent 间通信
Chat Agent 通过 `agent.registerTool('align_paper', ...)` 将 PaperAlignAgent 封装为工具，通过 `agent.getLLMProvider()` 共享 LLM 实例。

### 6. 方法级代码提取
`extractPythonFunctions` 把 `class.method` 拆分为独立条目，对齐粒度精确到方法。

### 7. 绝对行号 ↔ 相对行号换算
`CodeViewer` 接收 `lineNumberStart` 映射函数体相对行号为文件绝对行号。

---

## 环境依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18.0.0 | 运行时 |
| npm | ≥ 9 | 包管理 |
| Ollama | 最新 | 本地 LLM / Embeddings |
| TypeScript | 5.7+ | 编译 |

```bash
ollama pull gemma4:31b-cloud
ollama pull shaw/dmeta-embedding-zh
ollama serve
```

---

## 配置

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_ENDPOINT` | `http://localhost:11434` | Ollama API 地址 |
| `LLM_MODEL` | `gemma4:31b-cloud` | 对话模型 |
| `LLM_API_KEY` | `ollama` | API Key |
| `LLM_MAX_TOKENS` | `8192` | 最大输出 token |
| `GITHUB_TOKEN` | 无 | GitHub API Token（避免 429 限流）|
| `HTTPS_PROXY` / `HTTP_PROXY` | 无 | 代理配置 |

---

## 测试

```bash
cd packages/memory && npm run test:rag
cd apps/runtime && npm test
cd packages/paper-align && npm test
```

---

## 构建与部署

```bash
# 全量构建
npm run build

# Gateway 生产
cd apps/gateway
npm run build && node dist/index.js

# Web 静态构建
cd apps/web && npm run build
# 产物在 apps/web/dist/
```
