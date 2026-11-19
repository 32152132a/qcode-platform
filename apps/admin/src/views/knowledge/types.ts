export type KnowledgeSource = {
  documentId: string; revision: string; blockId: string; filename: string;
  page?: number; sheet?: string; rowStart?: number; rowEnd?: number; lineStart?: number; lineEnd?: number;
}
export type KnowledgeNode = {
  id: string; parentId: string | null; kind: 'article' | 'folder'; title: string;
  summary: string; text: string; sources: KnowledgeSource[]; pendingDelete?: boolean;
}
export type KnowledgeChange = { id: string; title: string; kind: string; operation: 'add' | 'update' | 'delete' }
export type KnowledgeLibrary = {
  revision: string; publishedRevision: string; nodes: KnowledgeNode[]; deleted: KnowledgeNode[];
  publishedNodes: KnowledgeNode[];
  review: { changes: { id: string; operation: string; reason: string }[]; warnings: string[]; exclusions: { sourceNodeIds: string[]; titles: string[]; reason: string; quote?: string }[] } | null;
  changes: KnowledgeChange[]; exclusions: { title?: string; reason: string }[];
}
export type KnowledgeUpload = { id: string; title: string; filename: string; status: string; error: string }
export type KnowledgeUploadIssue = {
  filename: string; stage: string; reason: string; location?: string;
  excerpt?: { line: number; text: string; afterMarker?: string }[];
  retry?: () => void; remove?: () => void;
}
export type KnowledgeResponse = { library: KnowledgeLibrary; uploads: KnowledgeUpload[]; limits?: { uploadBytes?: number } }
export type KnowledgeAnswer = {
  question: string; supported: boolean; answer: string; revision: string; durationMs: number; calls: number; totalTokens: number | null;
  citations: { nodeId: string; title: string; quote: string; source: KnowledgeSource; sources: KnowledgeSource[] }[];
  trace: { action: string; ids?: string[]; parentId?: string; error?: string; nodes?: { id: string; title?: string; alreadyRead?: boolean }[] }[];
}
