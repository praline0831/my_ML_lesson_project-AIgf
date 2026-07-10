/**
 * 论文-代码对齐 Agent - 类型定义
 */

/**
 * 从论文中抽取的一个"声明"（claim）
 * 例如：某个公式、某个超参选择、某个实验设置
 */
export interface PaperClaim {
    /** 声明的简短描述 */
    description: string;
    /** 论文中的具体出处（章节、公式编号、表格编号） */
    location: string;
    /** 原始引用文本（可选，用于追溯） */
    quote?: string;
    /** 分类标签：formula / algorithm / loss / hyperparam / training / data / arch */
    type?: ClaimType;
    /** 重要度 1-3，3 = 核心方法 */
    importance?: 1 | 2 | 3;
}

export type ClaimType =
    | 'formula'
    | 'algorithm'
    | 'loss'
    | 'hyperparam'
    | 'training'
    | 'data'
    | 'arch';

/**
 * 论文的解析结果
 */
export interface ParsedPaper {
    arxivId: string;
    title: string;
    authors: string[];
    abstract: string;
    /** 关联的 GitHub 仓库地址（从摘要/comment 抽出） */
    repoUrl?: string;
    /** 论文方法/实验部分的全文（已清洗） */
    bodyText: string;
    /** 抽取出的关键声明列表 */
    claims: PaperClaim[];
}

/**
 * 一个代码函数的"摘要"
 * 出于 token 限制，不存完整源码，只存签名 + 核心实现
 */
export interface CodeFunction {
    /** 文件路径（相对 repo 根） */
    file: string;
    /** 函数名 / 类名.方法名 */
    name: string;
    /** 起始行号（1-based, 含） */
    startLine: number;
    /** 结束行号（0-based, 不含 = 下一行行号） */
    endLine: number;
    /** 函数签名 */
    signature: string;
    /** 函数核心实现（已截断到合理长度） */
    body: string;
    /** def 还是 class（默认 'def'，旧数据可能没有） */
    kind?: 'def' | 'class';
    /** 方法所属的类名（顶层 def 没有） */
    parentName?: string;
    /** 是否被选为"关键函数" */
    isKey?: boolean;
}

/**
 * 一行对齐结果
 */
export interface AlignmentRow {
    claim: PaperClaim;
    /** 对齐到的代码函数（可能为空，表示缺失） */
    matchedFunction?: CodeFunction;
    /** 一致性：match / partial / mismatch / missing */
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    /** LLM 给出的简短说明 */
    note: string;
    /** 置信度 0-1 */
    confidence: number;
    /** LLM 推理过程（调试用） */
    reasoning?: string;
    /** 代码中匹配到的关键证据片段 */
    evidence?: string;
    /** 证据所在的具体行号（文件绝对行号，1-based），由 aligner 从函数体相对行号换算得到 */
    evidenceLine?: number;
}

/**
 * 仓库解析结果
 */
export interface ParsedRepo {
    owner: string;
    repo: string;
    defaultBranch: string;
    /** 仓库目录树（精简版，只保留代码相关文件） */
    fileTree: string[];
    /** 候选关键文件（喂给 LLM 之前筛过的） */
    candidateFiles: RepoFile[];
    /** 最终被选中的"关键函数" */
    keyFunctions: CodeFunction[];
}

/**
 * 一个 repo 文件的精简表示
 */
export interface RepoFile {
    path: string;
    /** 文件语言（按后缀判断） */
    language: string;
    /** 完整内容（截断到 maxChars） */
    content: string;
}

/**
 * 最终输出报告
 */
export interface AlignmentReport {
    paper: {
        arxivId: string;
        title: string;
        repoUrl?: string;
    };
    repo?: {
        owner: string;
        repo: string;
        url: string;
    };
    generatedAt: string;
    rows: AlignmentRow[];
    summary: {
        total: number;
        matched: number;
        partial: number;
        mismatch: number;
        missing: number;
    };
    /** Markdown 形式的报告 */
    markdown: string;
}
