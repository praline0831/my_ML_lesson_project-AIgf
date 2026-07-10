# 论文-代码对齐助手Agent

> 一个面向研究场景的全栈 AI Agent 系统：论文检索 · 深度研究 · 论文-代码对齐 · 多轮对话 · RAG 持久化记忆 · 工具/Skill 扩展。

---

## 目录

- [项目概览](#项目概览)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [技术栈详解](#技术栈详解)
- [环境依赖与安装](#环境依赖与安装)
- [运行](#运行)
- [API 端点](#api-端点)
- [Web UI 功能说明](#web-ui-功能说明)
- [应用模块](#应用模块)
  - [apps/gateway — API 网关](#appsgateway--api-网关)
  - [apps/runtime — Agent 运行时](#appsruntime--agent-运行时)
  - [apps/web — Web 前端](#appsweb--web-前端)
  - [apps/desktop — Electron 桌面端](#appsdesktop--electron-桌面端)
- [核心包](#核心包)
  - [@agent/paper — 论文检索 & 深度研究](#agentpaper--论文检索--深度研究)
  - [@agent/paper-align — 论文-代码对齐](#agentpaper-align--论文-代码对齐)
  - [@agent/memory — RAG 持久化记忆 + 论文知识库](#agentmemory--rag-持久化记忆--论文知识库)
- [Skills 系统](#skills-系统)
- [Prompt 工程](#prompt-工程)
- [关键设计模式](#关键设计模式)
- [配置](#配置)
- [测试](#测试)
- [构建与部署](#构建与部署)
- [路线图](#路线图)

---

## 项目概览

Your Agent 是一个**全栈、多 Agent 协作的 AI 系统**，围绕"论文研究 + 代码验证"这一核心场景设计：

- **研究侧**：自动从 arXiv 检索论文、多轮深度研究、抽取关键声明、验证声明与对应开源代码实现是否一致
- **对话侧**：基于 **LangGraph StateGraph** 的多轮对话——`retrieve → think → (act/invoke_skill → think) → summarize`
- **RAG 侧**：持久化向量知识库，自动存储论文声明、代码片段、问答结果，支持跨会话检索
- **交互侧**：Web 前端（代码高亮、Markdown/LaTeX 渲染、知识库面板）

整套系统以 **TypeScript Monorepo (Lerna + npm workspaces)** 组织，模块之间通过 `@agent/*` 命名空间解耦，运行时通过 Express 网关 + SSE 流式响应统一对外暴露能力。

---

## 核心特性

| 模块 | 能力 |
|------|------|
| **LangGraph Agent** | StateGraph 状态图编排：`retrieve→think→(act/invoke_skill→think)→summarize`；ReAct tool calling；SSE 流式 |
| **RAG 持久化记忆** | `PersistentVectorStore`（自实现，JSON 持久化）+ Ollama Embeddings；结构化 metadata（source/type/tags）；自动总结 |
| **Skills 框架** | Claude 风格的 Skill 注册/激活/指令注入；内置 webSearch / calculator / fileRead |
| **论文检索** | arXiv API 集成；关键词提取（中英停用词）；多轮 sub-query 生成 |
| **深度研究** | 多轮迭代检索 → 去重 → 摘要 → 综合；生成结构化研究报告 |
| **论文-代码对齐** | 抽取论文 claim → 抓取 GitHub 仓库 → 抽取关键函数 → LLM 逐条对齐；行级证据定位 |
| **VSCode 风格代码查看** | prism-react-renderer 语法高亮；行号重映射；焦点行 ±3 行上下文窗高亮；自动滚动 |
| **Markdown + LaTeX 渲染** | react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight |
| **流式接口** | SSE (Server-Sent Events) 实时返回 token、节点轨迹、错误 |
| **多 LLM 适配** | OpenAI / Anthropic / Ollama（本地）— 通过 providers.yaml 配置 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web 浏览器 (React 18 + Vite)                  │
│  · 论文搜索 / 深度研究 / 论文-代码对齐 / 对话 / 知识库面板       │
│  · 代码高亮 (prism-react-renderer) · Markdown + LaTeX 渲染       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP + SSE
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  apps/gateway (Express + ws)                     │
│  /chat/stream · /papers/* · /align/run · /memory/*               │
└──────┬────────────────────────────────┬─────────────────────────┘
       │                                │
       ▼                                ▼
┌────────────────────────┐    ┌──────────────────────────────┐
│  apps/runtime           │    │  @agent/paper-align          │
│  ┌────────────────────┐ │    │  · 论文解析                  │
│  │ LangGraph StateGraph│ │    │  · GitHub 抓取              │
│  │ ┌──────┐           │ │    │  · 单轮对齐                  │
│  │ │retrieve│ (RAG)   │ │    │  · 注入 Memory              │
│  │ └──┬───┘           │ │    └──────────────────────────────┘
│  │    ▼               │ │
│  │ ┌──────┐           │ │    ┌──────────────────────────────┐
│  │ │ think│ (LLM)     │ │    │  @agent/memory (持久化 RAG)  │
│  │ └──┬───┘           │ │    │  · PersistentVectorStore     │
│  │    ▼ (conditional) │ │    │    (data/memory/vectors.json)│
│  │ ┌──────┐ ┌──────┐ │ │    │  · Ollama Embeddings         │
│  │ │ act  │ │invoke│ │ │    │  · 结构化 metadata:           │
│  │ │(tool)│ │(skill)│ │ │    │    source/type/tags/title    │
│  │ └──┬───┘ └──┬────┘ │ │    │  · 自动保存每轮对话          │
│  │    ▼        ▼      │ │    └──────────────────────────────┘
│  │  ┌──────────┐      │ │
│  │  │ summarize│ (每5轮)│ │    ┌──────────────────────────────┐
│  │  └──────────┘      │ │    │  @agent/paper                │
│  └────────────────────┘ │    │  · ArXiv 检索                │
└────────────────────────┘    │  · 多轮深度研究               │
                              └──────────────────────────────┘
                       │
                       ▼
              ┌──────────────────────┐
              │  Ollama (localhost)   │
              │  · 大模型推理          │
              │  · Embeddings 服务     │
              │  · dmeta-embedding-zh│
              └──────────────────────┘
```

---

## 技术栈详解

### 前端

| 技术 | 用途 |
|------|------|
| **React 18.3** | 组件化 UI 框架（function component + hooks）|
| **Vite 5.4** | 开发服务器 + 构建（dev 启动 < 1s）|
| **TypeScript 5.7** | 全栈类型安全；strict 模式 |

### 后端

| 技术 | 用途 |
|------|------|
| **Express 4.21** | HTTP 网关 |
| **ws 8.18** | WebSocket 支持 |
| **cors 2.8** | 跨域 |
| **tsx 4.16** | TS 直接执行（开发态无需预编译）|
| **Lerna 7** | Monorepo 编排（lerna run build / test）|

### Agent / AI 编排

| 技术 | 用途 |
|------|------|
| **LangGraph 0.2** (`@langchain/langgraph`) | 状态图驱动的 Agent 编排；`StateGraph` / `Annotation` / `START` / `END` |
| **LangChain 0.3** (`langchain`) | 链式调用、PromptTemplate、输出解析 |
| **@langchain/core 0.3** | `BaseMessage` / `HumanMessage` / `AIMessage` / `ToolMessage` 等基础类型 |
| **@langchain/community 0.3** | Community 集成（VectorStore、Loader 等）|
| **@langchain/ollama 0.1** | Ollama LLM 与 Embeddings 集成 |

### 记忆与 RAG

| 技术 | 用途 |
|------|------|
| **PersistentVectorStore**（自实现）| 余弦相似度搜索 + JSON 文件持久化 (`data/memory/vectors.json`) |
| **Ollama Embeddings** | 通过 HTTP 调用本地 `shaw/dmeta-embedding-zh` 模型生成向量 |
| **uuid 11** | 文档 ID 生成 |

### 实时通信

| 技术 | 用途 |
|------|------|
| **SSE (Server-Sent Events)** | 单向流式推送 token / 节点轨迹 / 错误 |
| **WebSocket** (`ws`) | 双向通信（echo 服务）|

### 知识库面板

| 技术 | 用途 |
|------|------|
| **RAG Memory** | `PersistentVectorStore` 自实现向量存储 + Ollama Embeddings (dmeta-embedding-zh) |
| **结构化 metadata** | 每条知识带 `source`(paper/chat/alignment) / `type`(claim/code/qa/summary) / `tags` / `title` |
| **类型化接口** | `addPaperClaim()` / `addCodeFunction()` / `addQa()` / `addSummary()` |

---
## 环境依赖与安装

### 必备

| 依赖 | 版本 | 用途 |
|------|------|------|
| **Node.js** | ≥ 18.0.0 | 运行时（package.json 声明）|
| **npm** | ≥ 9 | 包管理 |
| **Ollama** | 最新 | 本地 LLM / Embeddings 服务（http://localhost:11434）|
| **Git** | 最新 | 克隆子仓库（paper-align 需要）|
| **TypeScript** | 5.7+ | 编译（dev 自动调用）|

### Ollama 模型准备

```bash
# 拉取对话模型
ollama pull gemma4:31b-cloud
# 或
ollama pull kimi-k2.5:cloud

# 拉取嵌入模型（中文优先）
ollama pull shaw/dmeta-embedding-zh

# 启动服务
ollama serve
```

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/your-agent.git
cd your-agent

# 2. 安装依赖（workspaces 自动装所有 packages + apps）
npm install

# 3. 启动 Ollama
ollama serve

# 4. 编译各包
npm run build

# 5. 启动网关
npm run dev:gateway

# 6. 启动 Web（另一终端）
npm run dev:web
```

Web 默认运行在 `http://localhost:5173`，网关在 `http://localhost:4000`。

---

## 运行

### 根级脚本

```bash
npm run dev:gateway    # 启动 API 网关
npm run dev:runtime    # 启动 runtime（watch 模式）
npm run dev:desktop    # 启动 Electron 桌面端
npm run dev:web        # 启动 Web Vite dev server
npm run build          # lerna run build — 所有包构建
npm run test           # lerna run test — 所有包跑测试
```

### 单独跑某个包

```bash
cd apps/gateway && npm run dev
cd packages/paper-align && npm run test
```

---

## API 端点

### 网关元信息

```bash
curl http://localhost:4000/
```

返回所有可用端点清单。

### 对话

```bash
# 阻塞版
curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"解释一下 LoRA 的原理"}'

# 流式版（SSE）
curl -X POST http://localhost:4000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"什么是 RAG？"}'
```

### 论文检索

```bash
# 简单检索
curl 'http://localhost:4000/papers/search?q=low%20rank%20adaptation&max=10'

# 深度研究
curl -X POST http://localhost:4000/papers/deep-research \
  -H "Content-Type: application/json" \
  -d '{"topic":"LoRA 微调方法","rounds":3,"per_round":8}'
```

### 论文-代码对齐

```bash
# SSE 流式对齐
curl -X POST http://localhost:4000/align/run \
  -H "Content-Type: application/json" \
  -d '{"arxiv_id":"2106.09685","repo_url":"https://github.com/microsoft/LoRA"}'

# 导出报告
curl -X POST http://localhost:4000/align/export \
  -H "Content-Type: application/json" \
  -d '{"markdown":"...","arxiv_id":"2106.09685"}' \
  -o report.md
```

---

## Web UI 功能说明

### 4 个 Tab

#### 1. Chat

- 多轮对话
- Markdown 渲染（GFM + LaTeX）
- 工具调用结果展示
- 流式 token 实时显示

#### 2. Search

- 论文搜索结果列表
- 摘要、作者、PDF 链接
- 一键触发"深度研究"或"分析"

#### 3. Research

- 输入研究主题
- 进度条 + 实时日志
- 完成后展示综合报告（Markdown）
- 一键下载 `.md` 报告

#### 4. Align（论文-代码对齐）

- 左侧：每条 Claim 卡片（描述 + 状态徽章 + 证据 + 行号）
- 右侧：`<CodeViewer />` 渲染对应代码文件
  - 顶部 tab 显示文件路径 + 语言
  - 左侧行号
  - 焦点行（深蓝 + ◀ 标记）—— Claim 的 evidenceLine
  - 上下文窗 ±3 行（浅蓝）
  - 整个方法体（浅灰）
  - 自动滚动到焦点行
- 顶部统计：✅ 匹配 / ⚠ 部分 / ❌ 偏差 / ⊘ 缺失

### CodeViewer 关键特性

- **行号重映射** (`lineNumberStart`)：函数体相对行号 → 文件绝对行号
- **焦点行滚动**：`useEffect` 监听 `focusLine`，`scrollIntoView({block:"center"})`
- **上下文窗高亮**：通过 prism-react-renderer 的 `getLineProps` 自定义行 className
- **VSCode Dark 主题**：`<Highlight theme={themes.vsDark} ...>`

---

## 应用模块

### apps/gateway — API 网关

Express + WebSocket 服务器，统一对外暴露 runtime / paper / paper-align 三大子系统的能力。

**主要端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/chat` | 单次对话（返回完整结果）|
| POST | `/chat/stream` | SSE 流式对话（实时 token + 节点轨迹）|
| GET | `/papers/search?q=&max=` | arXiv 关键词检索 |
| POST | `/papers/deep-research` | 深度研究（多轮迭代）|
| POST | `/papers/analysis` | 论文深度分析（单篇）|
| POST | `/papers/export` | 导出 Markdown |
| POST | `/align/run` | 论文-代码对齐（SSE 流式）|
| POST | `/align/export` | 导出对齐报告 |
| GET | `/memory/stats` | 知识库统计（总数 / 按来源 / 按类型） |
| POST | `/memory/search` | 知识库语义检索 `{ query, k }` |
| GET | `/memory/recent` | 最近 50 条知识条目 |
| WS | `/ws` | WebSocket echo |

**SSE 事件格式**：

```
data: {"type":"token","content":"你"}\n\n
data: {"type":"node","name":"retrieve","trace":"..."}\n\n
data: {"type":"done","output":"...","steps":2}\n\n
data: {"type":"error","error":"..."}\n\n
```

### apps/runtime — Agent 运行时

Agent 的核心实现，基于 **LangGraph 状态图**。

**GraphState 定义**（展示 LangGraph `Annotation.Root` + 自定义 reducer）：

```typescript
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),   // 追加而非覆盖
    default: () => [],
  }),
  steps: Annotation<number>({
    reducer: (x, y) => x + y,          // 累加
    default: () => 0,
  }),
  finalOutput: Annotation<string>({
    reducer: (_x, y) => y,             // 覆盖
    default: () => '',
  }),
  trace: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),   // 追加轨迹
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (_x, y) => y,             // 覆盖（外部维护）
    default: () => 0,
  }),
});
```

**Agent 类层次**：

- `Agent`（基类）— 定义 LangGraph StateGraph、tool 注册、自动总结
- `OllamaAgent` — Ollama 适配（错误处理 + Ollama 风格 tool call 解析）

**执行流程**（展示 LangGraph 有向图）：

```
START → [retrieve] (RAG 查询)
         → [think] (LLM 推理)
              → [act] (执行 <tool>) → [think] (循环)
              → [invoke_skill] (执行 <skill>) → [think] (循环)
              → [summarize] (每 5 轮对话自动总结 → 写入长期记忆)
              → END
```

每一条边都是显式定义的 `addEdge` / `addConditionalEdges`。

**关键能力**：

- 工具调度：LLM 输出 `<tool>{"name":"...","args":{...}}</tool>` → 注册表查找 → 执行
- Skills 注入：通过 `SkillsManager.buildSystemPrompt()` 把激活 skill 的 instructions 拼接到 system prompt
- RAG 记忆：`retrieve` 节点在每次 think 前自动检索长期记忆并注入上下文
- 自动总结：`summarize` 节点每 5 轮自动调用 LLM 总结对话要点，存入向量知识库
- 流式：通过 `StreamCallbacks { onToken, onNode, onTrace }` 实时反馈
- LLM 复用：`OllamaAgent.getLLMProvider()` 暴露底层 provider，供 paper-align 等其他 agent 共用同一实例

### apps/web — Web 前端

React 18 + Vite 单页应用。根组件 `App` 嵌入 `PaperApp`，PaperApp 内部通过 tab 切换 4 个视图：

- **Chat**：多轮对话，显示 markdown 渲染 + 工具调用结果
- **Search**：arXiv 论文检索（关键字 + 列表）
- **Research**：深度研究（多轮迭代 + 进度条 + 综合报告 + Markdown 导出）
- **Align**：嵌入 `<AlignApp />`，跳转到论文-代码对齐页面

### apps/desktop — Electron 桌面端

Electron 应用，复用 web 端代码。（占位，未实现）

---

## 核心包

### @agent/memory — RAG 持久化记忆 + 论文知识库

**3 个核心类**：

| 类 | 职责 |
|----|------|
| `PersistentVectorStore` | 自实现向量存储；`add()` / `addBatch()` / `search()` / `cosineSimilarity()`；JSON 序列化到磁盘 |
| `LongTermMemory` | 类型化知识接口：`addPaperClaim()` / `addCodeFunction()` / `addAlignmentResult()` / `addQa()` / `addSummary()` |
| `RAGMemoryService` | 统一入口；懒初始化 + 自动保存；`addTurn(user, ai)` 写入 QA + 持久化 |

**持久化**：
```
data/memory/vectors.json  ← 每次 addTurn() / addBatch() 自动写入
```
重启时 `initialize()` 读取 JSON 重建向量索引，完全不丢失。

**元数据结构**：

```typescript
{
  source: 'paper' | 'chat' | 'alignment' | 'summary',  // 来源
  type: 'claim' | 'code' | 'qa' | 'function' | 'summary',  // 内容类型
  title?: string,    // 标题（如论文名）
  tags?: string[],   // 关键词标签
  importance?: 1|2|3,
  timestamp: number,
}
```

**检索方式**：
- `search(query, k)` — 全局语义搜索
- `searchBySource(source, query, k)` — 按来源过滤
- `searchByType(type, query, k)` — 按类型过滤

### @agent/paper — 论文检索 & 深度研究

**核心模块**：

- **`arxiv.ts`**：arXiv API 客户端（搜索、获取元数据、PDF 下载）
- **`deep-research.ts`**：多轮深度研究编排
  - 关键词提取（中英停用词表 + 词频统计）
  - 多轮 sub-query 生成
  - 论文去重（按 arxiv id 去版本号）
  - 累积检索 → 每轮总结 → 最终综合（由 LLM 完成）
- **`exporter.ts`**：生成 Markdown 报告（支持下载）
- **`service.ts`**：`ArxivService` / `DeepResearchService` 高层封装

### @agent/paper-align — 论文-代码对齐

最复杂的子系统。流程：

```
arXiv URL / ID
  │
  ▼
[1] paper-parser.ts   ──  PDF 解析 → 纯文本
  │                          → LLM 抽取 Claim（描述 + 位置 + 原文引用）
  ▼
[2] repo-fetcher.ts   ──  GitHub 仓库克隆（git clone 或 tarball）
  │                          → 文件树 + 候选 .py 文件
  ▼
[3] key-function-selector.ts  ──  LLM 选出最相关的 10-20 个函数
  │                                   → 方法级 def 提取（class 内 def 独立成行）
  ▼
[4] aligner.ts        ──  分批（4 claim / 批）喂给 LLM
  │                          → 输出 claimIndex / functionIndex / status / evidenceLine
  ▼
[5] reporter.ts       ──  生成 Markdown 报告
```

**行级证据定位（核心特性）**：

对齐 prompt 要求 LLM 输出 `evidenceLine`（证据在函数体内的相对行号），最终展示时换算为文件绝对行号：

```typescript
fileLine = startLine + evidenceLine - 1
```

这样 UI 可以精确高亮"α/r 缩放"那行，而不是整个 LoRALinear 类。

**LLM 适配**（`llm-adapter.ts`）：

```typescript
// 复用 OllamaAgent 的 LLM 实例，保证两个 agent 用同一模型
const llm = ollamaAgent.getLLMProvider();
const aligner = new PaperAlignAgent({ llm });
```

**类型定义**（`types.ts`）：

```typescript
interface PaperClaim {
    description: string;
    location: string;     // 论文中位置（§4.1 / Eq.3）
    quote?: string;       // 原文引用
}

interface CodeFunction {
    file: string;
    name: string;         // "LoRALinear.forward" or 顶层 def
    startLine: number;    // 1-based
    endLine: number;      // 0-based (不含)
    signature: string;
    body: string;
    kind?: 'def' | 'class';
    parentName?: string;  // 方法所属类
}

interface AlignmentRow {
    claim: PaperClaim;
    matchedFunction?: CodeFunction;
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    note: string;
    confidence: number;
    evidence?: string;
    evidenceLine?: number;
}
```

### @agent/memory — RAG 持久化记忆 + 论文知识库

持久化向量记忆系统。对话中的论文声明、代码片段、问答自动存入向量数据库，
下次检索可自动召回相关上下文。基于 **自实现 PersistentVectorStore + Ollama 本地 embedding**。

**核心特性**：
- **自动持久化**：`PersistentVectorStore` 序列化到 `data/memory/vectors.json`，服务重启不丢失
- **结构化存储**：每条记忆带 `source`（paper/chat/alignment）、`type`（claim/code/qa/summary/fact）、`tags`、`title` 等 metadata
- **按来源/类型检索**：`searchBySource('paper', query)`、`searchByType('claim', query)`
- **自动总结**：LangGraph `summarize` node 每 5 轮对话自动调用 LLM 总结并存入 long-term memory
- **对齐注入**：`/align/run` 完成后自动将 claims + matched code 写入向量库
- **前端知识库面板**：在 Web UI 查看统计、搜索、浏览最近条目

**文件：`packages/memory/src/`**

| 文件 | 职责 |
|---|---|
| `vector-store.ts` | `PersistentVectorStore` — 自实现向量存储，余弦相似度搜索，JSON 持久化 |
| `long-term-memory.ts` | `LongTermMemory` — 结构化知识条目，`addPaperClaim()` / `addCodeFunction()` / `addQa()` 等类型化接口 |
| `memory-service.ts` | `RAGMemoryService` — 统一入口，自动初始化 + 自动保存 |
| `short-term-memory.ts` | `ShortTermMemory` — ChatMessageHistory 包装（保留兼容）|

---

## Skills 系统

仿 Claude "Skills" 机制——可注册的工具集，通过 `SkillsManager` 管理激活状态，自动把激活 skill 的 instructions 注入到 system prompt。

**核心 API**：

```typescript
const mgr = new SkillsManager();
mgr.register(calculatorSkill);    // 注册
mgr.activate('calculator');       // 激活
mgr.deactivate('web-search');     // 停用
mgr.setActive(['calculator', 'file-read']);  // 批量设置

// 给 Agent 用：
const systemPrompt = mgr.buildSystemPrompt();

// 或直接调用：
const result = await mgr.invoke('calculator', { expression: '1+1' }, ctx);
```

**内置 Skills**：

| Skill | 功能 | 参数 |
|-------|------|------|
| `webSearch` | 联网搜索 | `{ query: string }` |
| `calculator` | 数学计算 | `{ expression: string }` |
| `fileRead` | 读文件 | `{ path: string }` |

**配置驱动**（`config/tools.yaml`）：

```yaml
tools:
  - name: web_search
    description: Search the web for information
    module: skills/web-search
    params:
      query: string
  - name: calculator
    description: Perform mathematical calculations
    module: skills/calculator
    params:
      expression: string
  - name: file_read
    description: Read content from a file
    module: skills/file-read
    params:
      path: string
```

**响应式设计**：`SkillsManager` 内置 listeners 集合，状态变更时 `emit()` 通知订阅者（UI 可同步更新激活状态）。

---

## Prompt 工程

项目内多处以结构化 Prompt 引导 LLM 行为：

### 1. 论文 Claim 抽取 Prompt

要求 LLM 从论文正文输出结构化 JSON：

```json
{
  "claims": [
    {
      "description": "LoRA 权重更新的低秩分解公式",
      "location": "§4.1",
      "quote": "For a pre-trained weight matrix W0 ∈ R^{d×k}, we constrain its update by representing the latter with a low-rank decomposition W0 + ΔW = W0 + BA..."
    }
  ]
}
```

**技巧**：要求带 `location`（出处）和 `quote`（原文引用），便于后续验证。

### 2. 关键函数选择 Prompt

给定函数列表 + 论文摘要，让 LLM 输出最相关的 N 个函数索引：

```json
{ "selectedIndices": [3, 7, 12, ...] }
```

### 3. Claim-Function 对齐 Prompt（最复杂）

**分批**（4 个 claim / 批）避免超 token；强制要求：

- 先 `reasoning` 描述找到的证据（哪行 / 哪个标识符）
- 再给 `status`（match/partial/mismatch/missing）
- 给出 `evidence` 关键片段（≤100 字）
- **核心**：`evidenceLine`（证据所在函数体相对行号）

### 4. 工具调用 Prompt

Ollama 风格的工具调用格式：

```xml
<tool>{"action":"tool_call","action_input":{"name":"calculator","args":{"expression":"1+1"}}}</tool>
```

解析时优先匹配 `<tool>...</tool>` 标签，回退到直接 JSON 解析。

### 5. JSON 解析策略（多层容错）

`extractJson` 函数多级 fallback：

1. 直接 `JSON.parse`
2. 抽取 ```` ```json ... ``` ```` 代码块
3. 智能补全缺失的闭合括号 / 引号

---

## 关键设计模式

### 1. Monorepo + Project References

`tsconfig.base.json` 开启 `composite: true`，各包用 `references` 互相依赖，实现跨包增量构建。

### 2. LLM Provider 抽象 + 适配器

`LLMProvider` 接口统一 3 个能力：`generateText` / `generateStream` / 可选 `embedQuery`。具体实现（OpenAI / Anthropic / Ollama）继承 `BaseLLMClient`。`LLMProviderAdapter` 让 `paper-align agent` 复用 `runtime` 的 LLM 实例。

### 3. 状态图驱动的 Agent

不写 if-else 循环，而是把 Agent 行为建模为 StateGraph 节点（llm / tool / decide / retrieve），通过 Annotation 管理状态。LLM 输出 → 决定走哪个节点 → 状态更新。

### 4. SSE 流式响应

网关把内部回调（`StreamCallbacks`）桥接到 HTTP SSE，浏览器端用 `EventSource` 接收。事件类型：`token` / `node` / `done` / `error`。

### 5. Method-Level 代码提取

`extractPythonFunctions` 不把 `class LoRALinear` 整段当一个函数，而是把内部 `def forward` 拆成 `LoRALinear.forward` 独立条目，使对齐粒度精确到方法。

### 6. 绝对行号 ↔ 相对行号换算

`CodeViewer` 接收 `lineNumberStart` 把函数体的相对行号映射为文件绝对行号；`evidenceLine` 也做同样换算——保证左 claim 选中和右代码高亮严格对齐。

---

## 配置

### `config/providers.yaml`

```yaml
providers:
  - name: openai
    type: llm
    api_key: ${OPENAI_API_KEY}
    models: [gpt-4o, gpt-4-turbo, gpt-3.5-turbo]
  - name: anthropic
    type: llm
    api_key: ${ANTHROPIC_API_KEY}
    models: [claude-3-5-sonnet, claude-3-opus]
  - name: local
    type: llm
    base_url: http://localhost:11434
    models: [kimi-k2.5:cloud, mistral]
```

### `config/tools.yaml`

```yaml
tools:
  - name: web_search
    description: Search the web for information
    module: skills/web-search
    params: { query: string }
  - name: calculator
    description: Perform mathematical calculations
    module: skills/calculator
    params: { expression: string }
  - name: file_read
    description: Read content from a file
    module: skills/file-read
    params: { path: string }
```

### `tsconfig.base.json` 关键选项

- `target: ES2022` + `lib: ES2022`
- `module: NodeNext` + `moduleResolution: NodeNext`（纯 ESM）
- `strict: true` + `noImplicitReturns: true`
- `composite: true`（Project References）
- `incremental: true`（增量构建）
- `esModuleInterop: true`

---

## 测试

每个包都有独立测试入口：

```bash
# memory 三个测试
cd packages/memory
npm run test:short    # 短期记忆
npm run test:long     # 长期记忆
npm run test:rag      # RAG 端到端

# runtime
cd apps/runtime && npm test

# paper-align
cd packages/paper-align && npm test
```

测试通过 `tsx` 直接执行（无需预编译）。

---

## 构建与部署

```bash
# 全量构建（Lerna 编排）
npm run build

# 单包构建
cd packages/paper-align && npm run build

# Gateway 生产模式
cd apps/gateway
npm run build
npm start   # node dist/index.js

# Web 静态构建
cd apps/web
npm run build
# 产物在 apps/web/dist/，可托管到任意静态服务
```

### 部署拓扑建议

```
[CDN/Nginx]  → 静态资源（web/dist）+ 反代 /api → [Gateway 容器]
                                                     ↓
                                          [Ollama 容器 / 主机]
                                          [Git (for paper-align)]
```

---

## 路线图

- [ ] **多模态对齐**：把论文图表/公式（image）也纳入 claim 抽取
- [ ] **跨会话记忆增强**：支持时间衰减、自动过期、手动编辑知识条目
- [ ] **Skills 市场**：UI 上可视化注册/启用 skill
- [ ] **Prompt 版本管理**：把 prompt 模板化到独立文件，git 追踪
- [ ] **评估基准**：内置论文-代码对齐的评估脚本（precision/recall）
- [ ] **分布式 Agent**：LangGraph 多 agent 协作
- [ ] **实时协作**：多用户同步研究（CRDT）

---

## 致谢

- [LangChain](https://github.com/langchain-ai/langchainjs) · [LangGraph](https://github.com/langchain-ai/langgraph)
- [Ollama](https://ollama.ai/)
- [PixiJS](https://pixijs.com/) · [Live2D](https://www.live2d.com/)
- [prism-react-renderer](https://github.com/FormidableLabs/prism-react-renderer)
</tool_call>
