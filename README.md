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
| **Human-in-the-loop** | 工具调用前弹出确认对话框，展示工具名和参数，用户批准后才执行（30 秒超时自动拒绝）；新增**交互式对齐**（`interactive_align`），LLM 自主判断何时需要搜索论文和代码对齐，引导用户完成搜索→选论文→定仓库→对齐全流程 |
| **Agent 间通信** | Chat Agent 通过 `align_paper` 工具委托 PaperAlign Agent 干活，共享同一 LLM 实例 |
| **RAG 持久化记忆** | `PersistentVectorStore`（自实现，JSON 持久化）+ 结构化 metadata；自动总结 |
| **Skills 框架** | Claude 风格的 Skill 注册/激活/指令注入；内置 webSearch / calculator / paperAlign |
| **论文检索** | arXiv API 集成；多轮 sub-query 生成 |
| **深度研究** | 多轮迭代检索 → 去重 → 摘要 → 综合；生成结构化研究报告 |
| **论文-代码对齐** | 两阶段论文解析（组件 → claims）→ 角色路由（architecture / training / inference 三种检索策略）→ 算子密集渲染（仅展示含 `torch.*` / `F.*` / `nn.*` 的行）→ 调用链自动展开（0 算子函数 → 回溯 `self.xxx` 调用）→ 算子锚点证据提取；对齐结果后自动生成**论文总结**（分核心贡献/支撑组件/实现细节三级展示）；支持**导出为 Markdown 报告** |
| **Markdown + LaTeX 渲染** | react-markdown + remark-gfm + remark-math + rehype-katex |
| **流式接口** | SSE (Server-Sent Events) 实时返回 token、节点轨迹、确认请求、错误 |
| **本地 LLM** | 通过 Ollama 运行本地模型（gemma4:31b-cloud / kimi-k2.5:cloud） |

---

## 系统架构

```
+----------------------------------------------------------------+
|                    Web 浏览器 (React 18 + Vite)                  |
|  · 论文搜索 / 深度对话 / 论文-代码对齐 / 知识库面板              |
|  · Human-in-the-loop 确认弹窗 · 执行轨迹 Timeline               |
|  · Markdown + LaTeX / 代码高亮                                   |
+----------------------+------------------------------------------+
                       | HTTP + SSE
                       v
+----------------------------------------------------------------+
|                  apps/gateway (Express)                          |
|  /chat/stream · /papers/* · /align/* · /memory/*                |
|  /chat/confirm (Human-in-the-loop) · /align/last-result          |
|                                                                  |
|  +- align_paper 工具 ------------------------------------------+ |
|  | Chat Agent --委托---> PaperAlignAgent                      | |
|  |             共享 LLM 实例 (getLLMProvider())               | |
|  +-------------------------------------------------------------+ |
+------+-------------------------------+--------------------------+
       |                               |
       v                               v
+-----------------------+   +------------------------------------+
|  apps/runtime          |   |  @agent/paper-align                |
|  +-------------------+ |   |  · 两阶段解析 (组件->claims)       |
|  | LangGraph StateGraph| |   |  · GitHub 仓库抓取 + 启发式排名   |
|  |                   | |   |  · 角色路由 (3种检索策略)          |
|  | retrieve (RAG)    | |   |  · 算子密集渲染 (仅 torch 行)      |
|  |    v              | |   |  · 调用链展开 (0算子→回溯)       |
|  | think (LLM)       | |   |  · LLM 复用 (LLMProviderAdapter)  |
|  |    v (conditional)| |   +------------------------------------+
|  | +----------+      | |   +------------------------------------+
|  | | act      |      | |   |  @agent/memory (持久化 RAG)        |
|  | | (tool)   |      | |   |  · PersistentVectorStore           |
|  | | +-HITL---+      | |   |  · JSON 持久化                     |
|  | | | 确认   |      | |   |  · 结构化 metadata                 |
|  | | +--------+      | |   +------------------------------------+
|  | +----+-----+      | |
|  |      v (loop)     | |   +------------------------------------+
|  | summarize (每3轮) | |   |  @agent/paper                      |
|  +-------------------+ |   |  · ArXiv 检索                      |
+-----------------------+   |  · 多轮深度研究                     |
                       |    +------------------------------------+
                       v
              +----------------------+
              |  Ollama (localhost)   |
              |  · gemma4:31b-cloud   |
              |  · Embeddings 服务    |
              +----------------------+
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
  |
  v
think 节点 -> 条件路由 -> act 节点
  |
  +- 生成确认 ID -> 存入 Agent.confirmQueue
  +- 通过 SSE 发送 {type:"confirm", id, name, args}
  +- 前端弹出 ConfirmDialog 对话框
  |   +- 显示工具名 (如 align_paper)
  |   +- 显示参数 (如 {"arxiv_id":"2106.09685"})
  |   +- 允许 / 拒绝 按钮
  |
  +- 用户点击"允许"
  |   +- POST /chat/confirm {id, decision:true}
  |       -> Agent.resolveConfirm() -> Promise resolve
  |       -> act 继续执行工具
  |
  +- 用户点击"拒绝"
  |   +- POST /chat/confirm {id, decision:false}
  |       -> act 返回"用户取消了工具调用"的 ToolMessage
  |       -> LLM 解释给用户
  |
  +- 30 秒无响应 -> 超时自动拒绝
```

### 实现位置

| 层 | 文件 | 说明 |
|----|------|------|
| Runtime | `agent.ts:332` | `act` 节点创建 Promise -> emit `onConfirm` -> 等待决议 |
| Runtime | `agent.ts:99` | `Agent.confirmQueue` 静态 Map 存储待决请求 |
| Gateway | `server.ts:111` | `onConfirm` 回调发送 SSE 事件；`/chat/confirm` 端点注入决议 |
| Frontend | `UnifiedResearchApp.tsx:754` | `ConfirmDialog` 组件，显示工具名 + 参数 + 允许/拒绝按钮 |

### 覆盖范围

所有 `registerTool()` 注册的工具：

- `search_arxiv` -- 搜索论文
- `deep_research` -- 深度研究
- `align_paper` -- 论文-代码对齐（直接给定 arXiv ID）
- `interactive_align` -- **交互式论文-代码对齐**（给定论文主题/名称，引导用户完成搜索→选论文→定仓库→对齐）
- `calculator` -- 数学计算

---

## Agent 间通信：align_paper 工具

### 架构

```
用户: "帮我对齐 2106.09685"
  |
  v
Chat Agent (LangGraph)
  |
  +- think 节点: LLM 看到 align_paper 工具
  +- act 节点: HITL 确认 -> 执行工具
  |
  +- align_paper 工具 (gateway/server.ts)
  |   +- 通过 agent.getLLMProvider() 获取共享 LLM
  |   +- new LLMProviderAdapter(sharedProvider) 适配 PaperAlignAgent
  |   +- await PaperAlignAgent.align(arxivId, repoUrl)
  |   +- 注入 memory (自动持久化对齐结果)
  |   +- 返回格式化文本
  |
  +- 结果存入 lastAlignReport -> GET /align/last-result
  +- 前端: 聊天输出 + 下方对齐面板同步更新
```

### 与 gateway 独立端点的关系

| 方式 | 入口 | 状态 |
|------|------|------|
| 聊天委托 | 对话框说"帮我对齐这篇论文" | 新实现，Agent 间通信 |
| 独立面板 | 填写 arXiv ID + GitHub URL -> 点击"开始对齐" | 保留，SSE 流式进度 |
| 对齐结果 | 两种方式都写入 `lastAlignReport` | 前端自动同步 |

### 实现关键点

- **共享 LLM 实例**：`LLMProviderAdapter` 将 `OllamaAgent.getLLMProvider()` 适配为 `PaperAlignAgent` 需要的 `LLMClient`，保证模型/温度/endpoint 完全一致
- **JSON 输出容错**：`repairJson` 自动修复 LLM 输出中的 stray quotes、stray parens、缺失括号、截断内容
- **max_tokens**：设为 8192，避免长函数体被截断导致对齐失败

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

# 流式 (SSE) -- 推荐
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

### 深度对话
- 多轮对话（Markdown + LaTeX 渲染）
- 工具调用结果展示
- 执行轨迹 Timeline：实时显示 `retrieve -> think -> act -> ...` 的节点流转
- **Human-in-the-loop**：弹出确认对话框，展示工具名和参数
- 上下文注入：对齐结果自动加载到对话

### 论文-代码对齐
- 左侧：每条 Claim 卡片（描述 + 状态徽章 + 行号）
- 右侧：代码查看器（语法高亮、行号重映射、焦点行高亮）
- 顶部统计：匹配 / 部分 / 偏差 / 缺失
- **论文总结**：对齐结果下方展示可折叠的论文总结面板，按重要度（核心贡献/支撑组件/实现细节）分条列出声明
- **导出报告**：支持一键导出为 Markdown (.md) 文件
- 聊天对齐结果自动同步到此面板

### 交互式对齐
- **LLM 自主触发**：Agent 识别用户意图（如"帮我对齐LoRA""分析一下Transformer的代码实现"），自主调用 `interactive_align` 工具
- **引导式流程**：搜索 arXiv → 展示结果（可点击的论文卡片）→ 选择论文 → 自动检测/手动输入 GitHub 仓库 → 执行对齐
- **执行轨迹同步**：交互式对齐的每一步（搜索 arXiv / 检测仓库 / 代码对齐 / 解析论文 / 提取函数）都注入到聊天区 **Agent 执行轨迹 Timeline** 中，统一可视化

### 知识库 (RAG Memory)
- 统计：知识条目总数 / 按来源分布
- 搜索：语义检索知识条目
- 最近条目列表

---

## 应用模块

### apps/gateway -- API 网关

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
| POST | `/align/interactive/start` | 交互式对齐（SSE，搜索→选论文→定仓库→对齐）|
| POST | `/align/interactive/respond` | 交互式对齐用户响应 |
| GET | `/memory/stats` | 知识库统计 |
| POST | `/memory/search` | 知识库检索 |
| GET | `/memory/recent` | 最近条目 |

### apps/runtime -- Agent 运行时

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
START -> [retrieve] (RAG 查询)
         -> [think] (LLM 推理)
              -> [act] (HITL 确认 -> 执行 <tool>) -> [think] (循环)
              -> [summarize] (每 3 轮自动总结 -> 写入长期记忆)
              -> END
```

**Agent 类层次**：
- `Agent`（基类）-- 定义 LangGraph StateGraph、tool 注册、confirmQueue、自动总结
- `OllamaAgent` -- Ollama 适配（错误处理 + 兼容两种格式的 tool call 解析）

**关键能力**：
- 工具调度 + HITL 确认
- Skills 指令注入到 system prompt
- RAG 记忆：retrieve 节点自动检索长期记忆
- 自动总结：每 3 轮自动调用 LLM 总结
- 流式回调：onToken / onNode / onTrace / onConfirm / onMessage
- LLM 复用：getLLMProvider() 暴露 OllamaClient 实例

### apps/web -- Web 前端

React 18 + Vite 单页应用。包含四个模块：
- **论文搜索**：arXiv 检索
- **深度对话**：Markdown 渲染 + Timeline + HITL 确认弹窗
- **论文-代码对齐**：匹配矩阵 + CodeViewer
- **知识库**：RAG Memory 面板

---

## 核心包

### @agent/paper -- 论文检索 & 深度研究

- `arxiv.ts`：arXiv API 客户端
- `deep-research.ts`：多轮深度研究编排
  - 关键词提取 + sub-query 生成
  - 论文去重 + 累积摘要 + 综合报告

### @agent/paper-align -- 论文-代码对齐

**两阶段论文解析**：

```
arXiv ID -> PaperParser (两阶段提取)
              Phase 1: 从 abstract/intro 提取 3-5 个核心组件
              Phase 2: 对每个组件提取 2-4 条 claim + 原文引用
              -> 输出: ComponentResult[] (含组件名/优先级/描述)
```

论文文本截断策略：保留 head(35%) + middle(40%) + tail(25%)，确保方法部分不被丢弃。

**函数提取与排名**：

```
GitHub repo -> RepoFetcher (文件树 + 候选 .py 文件)
                -> extractPythonFunctions (方法级提取)
                -> rankByHeuristic: 根据文件名/函数名与论文标题+组件的关键词匹配度排名
                -> 取 top 30 函数供对齐
```

不再使用 LLM 筛选函数（KeyFunctionSelector），改为纯启发式评分，避免昂贵的 LLM 调用和重要函数被误过滤。

**对齐管线**：

```
每条 claim 独立处理:

  1. 角色路由 (Role Detection)
     -> 检测 claim 关键词: loss/training → "training" 角色
                           sample/reverse → "inference" 角色
                           attention/conv → "architecture" 角色
     -> 角色决定检索权重: training 角色对 *_step 名称权重 +15

  2. 算子检索 (Operator Retrieval)
     -> claim 分词 → 检查函数名/路径/签名 + body 关键词 + torch 算子密度
     -> top 5 候选函数

  3. 类-方法展开 + 调用链展开 (expandWithClass)
     -> 候选是方法 → 加入父类
     -> 候选是类 → 加入所有方法
     -> 候选函数有 0 个 torch 算子 (包装器) → 解析 self.xxx 调用,加入被调者

  4. 算子密集渲染 (Dense Operator Rendering)
     -> 类: 显示 params(可训练参数) + torch 算子摘要,不显示 body
     -> 方法: 仅显示包含 torch.* / F.* / nn.* 的行 (带行号 L42),最多 8 行
     -> 0 算子函数标注 "(no torch ops — wrapper/container)"

  5. LLM 判定 (Per-Claim)
     -> 温度 0.7, 禁止按名称/docstring 匹配,强制按 torch 算子匹配
     -> 找不到对应算子 → status:"mismatch" (不强行造假)
     -> 输出 functionIndex + status + evidence(实际算子)

  6. 算子锚点证据提取 (buildEvidenceSpan)
     -> 解析 claim 中数学算子 (sqrt, matmul, softmax, ...)
     -> 在目标函数 body 中搜索含该算子的行
     -> 截取 [命中行-3, 命中行+3] 作为证据片段
     -> 无数学算子 → 回退到 torch 密集行
```

**匹配哲学**：LLM 被训练为编译器/调试器，而非搜索引擎。
- 旧：根据函数名/类名/docstring 匹配（概念映射）→ 大量假阳性
- 新：追踪 `torch.*` / `F.*` / `nn.*` 数据流向（算子映射）→ 找不到就是 mismatch

`mismatch` 不是系统的失败，而是**论文的创新点确实没在开源代码里实现**的信号。

**LLM 容错**：

```typescript
// repairJson: 修复 LLM 输出的常见 JSON 错误
// - 数组元素间的 stray quotes
// - 字符串末尾的 stray closing parens
// - 缺失的闭合括号/花括号
// - 截断的尾部内容
```

**LLM 适配**：

```typescript
// 共享 LLM 实例
const sharedProvider = agent.getLLMProvider();
const alignAgent = new PaperAlignAgent({
  llm: new LLMProviderAdapter(sharedProvider),
});
```

### @agent/memory -- RAG 持久化记忆 + 论文知识库

**3 个核心类**：

| 类 | 职责 |
|----|------|
| `PersistentVectorStore` | 自实现向量存储；cosineSimilarity；JSON 序列化到 `data/memory/vectors.json` |
| `LongTermMemory` | 类型化知识接口：`addPaperClaim()` / `addCodeFunction()` / `addAlignmentResult()` / `addQa()` / `addSummary()` |
| `RAGMemoryService` | 统一入口；懒初始化 + 自动保存 |

---

## Skills 系统

仿 Claude "Skills" 机制--可注册的工具集，通过 `SkillsManager` 管理激活状态，自动把激活 skill 的 instructions 注入到 system prompt。

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
| `paper_align` | 论文-代码对齐（封装 PaperAlignAgent，复用 LLM 实例） |

`paper_align` skill 通过 `LLMProviderAdapter(ctx.llm)` 复用上下文中的 LLM 实例，支持传入 `arxiv_id` 和可选 `repo_url`，返回结构化对齐报告（含组件、claim、行级证据）。

---

## 关键设计模式

### 1. LLM Provider 抽象 + 适配器
`LLMProvider` 接口统一 `generateText` / `generateStream`。`LLMProviderAdapter` 让 paper-align agent 复用 runtime 的 LLM 实例。

### 2. 状态图驱动的 Agent
Agent 行为建模为 StateGraph 节点（retrieve / think / act / summarize），通过 Annotation 管理状态。LLM 输出 -> 条件路由 -> 状态更新。

### 3. SSE 流式响应
网关把内部回调（`StreamCallbacks`）桥接到 HTTP SSE。事件类型：`token` / `node` / `confirm` / `done` / `error`。

### 4. Human-in-the-loop
静态 `confirmQueue` + Promise 等待模式：act 节点创建 Promise -> emit confirm 事件 -> 等待 `/chat/confirm` 决议 -> 继续或拒绝。

### 5. Agent 间通信
Chat Agent 通过 `agent.registerTool('align_paper', ...)` 将 PaperAlignAgent 封装为工具，通过 `agent.getLLMProvider()` 共享 LLM 实例。

### 6. 两阶段论文解析
先提取核心组件（3-5 个），再对每个组件提取 claims（2-4 条），避免一次性提取遗漏细节。

### 7. 算子映射 + 动态证据
LLM 被训练为编译器：根据 claim 中的数学算子（sqrt/matmul/softmax）在函数体中搜索对应的 `torch.*` / `F.*` / `nn.*` 调用。找不到则标记 `mismatch`（说明论文创新点未在代码中实现）。证据片段以命中算子行为锚点，截取 ±3 行生成，杜绝 LLM 编造行号。

### 8. 绝对行号 <-> 相对行号换算
`CodeViewer` 接收 `lineNumberStart` 映射函数体相对行号为文件绝对行号。

### 9. 交互式对齐流程
通过独立的 SSE 端点 `/align/interactive/start` 实现多步引导流程，不依赖 LangGraph 图。架构分为：
- **会话层**：`InteractiveSession` 管理状态（confirm_search → showing_results → asking_repo → aligning → done）
- **通信层**：SSE 推送 `ia_ask_confirm` / `ia_show_papers` / `ia_ask_repo` / `ia_node`（注入 Timeline） / `ia_done` 事件
- **工具层**：Agent 通过 `interactive_align` 工具自主触发，前端自动跳过通用确认对话框，直接启动交互式面板

---

## 环境依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 18.0.0 | 运行时 |
| npm | >= 9 | 包管理 |
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
