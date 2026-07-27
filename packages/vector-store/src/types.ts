export interface VectorRecord {
  id: string;

  documentId: string;

  chunkId: string;

  text: string;

  embedding: number[];

  metadata?: Record<string, unknown>;
}

export interface SearchResult extends VectorRecord {
  score: number;
}

export interface VectorStore {
  initialize(): Promise<void>;

  upsert(records: VectorRecord[]): Promise<void>;

  search(
    embedding: number[],
    limit?: number
  ): Promise<SearchResult[]>;

  listAll(): Promise<VectorRecord[]>;

  deleteByDocumentId(documentId: string): Promise<void>;

  /** Patches metadata on every chunk of a document without touching its
   * embedding — for status updates that shouldn't cost a re-embed. */
  updateMetadata(documentId: string, patch: Record<string, unknown>): Promise<void>;
}