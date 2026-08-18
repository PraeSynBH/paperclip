/**
 * Knowledge starter pack — curated knowledge document bundles
 * for common industries, enabling one-click installation into a company
 * knowledge base.
 */
export interface KnowledgeStarterPackDocument {
  title: string;
  summary: string;
  body: string;
}

export interface KnowledgeStarterPack {
  key: string;
  name: string;
  description: string;
  industry: string;
  icon: string;
  /** Number of documents (cached for list view, actual docs in getPack) */
  documentCount: number;
  documents: KnowledgeStarterPackDocument[];
}

export interface KnowledgeStarterPackInstallResult {
  packKey: string;
  documentsCreated: number;
  documentIds: string[];
}