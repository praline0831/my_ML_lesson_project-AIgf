export interface PaperClaim {
    description: string;
    location: string;
    quote?: string;
    type?: ClaimType;
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

export interface PaperComponent {
    name: string;
    description: string;
    priority: 1 | 2 | 3;
    location: string;
    claims: PaperClaim[];
}

export interface ParsedPaper {
    arxivId: string;
    title: string;
    authors: string[];
    abstract: string;
    repoUrl?: string;
    bodyText: string;
    components: PaperComponent[];
}

export interface CodeFunction {
    file: string;
    name: string;
    startLine: number;
    endLine: number;
    signature: string;
    body: string;
    kind?: 'def' | 'class';
    parentName?: string;
    isKey?: boolean;
}

export interface VariableMapping {
    formulaVar: string;
    codeVar: string;
    context: string;
}

export interface EvidenceSpan {
    startLine: number;
    endLine: number;
    codeSnippet: string;
    formulaContext?: string;
    variableMappings?: VariableMapping[];
}

export interface AlignmentRow {
    claim: PaperClaim;
    componentName?: string;
    matchedFunction?: CodeFunction;
    matchedFunctions?: CodeFunction[];
    evidenceSpans?: EvidenceSpan[];
    status: 'match' | 'partial' | 'mismatch' | 'missing';
    note: string;
    confidence: number;
    reasoning?: string;
    evidence?: string;
    evidenceLine?: number;
}

export interface StructuralMapping {
    componentIndex: number;
    functionIndices: number[];
    description: string;
    confidence: number;
}

export interface ParsedRepo {
    owner: string;
    repo: string;
    defaultBranch: string;
    fileTree: string[];
    candidateFiles: RepoFile[];
    keyFunctions: CodeFunction[];
}

export interface RepoFile {
    path: string;
    language: string;
    content: string;
}

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
    components: {
        component: PaperComponent;
        rows: AlignmentRow[];
    }[];
    rows: AlignmentRow[];
    summary: {
        total: number;
        matched: number;
        partial: number;
        mismatch: number;
        missing: number;
    };
    markdown: string;
}
