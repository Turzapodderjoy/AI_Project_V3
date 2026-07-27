import type {
  VectorStore,
  VectorRecord,
  SearchResult,
} from "./types";

export class VectorStoreManager {
  constructor(
    private provider: VectorStore
  ) {}

  async initialize() {
    return this.provider.initialize();
  }

  async upsert(records: VectorRecord[]) {
    return this.provider.upsert(records);
  }

  async search(
    embedding: number[],
    limit = 5,
    businessId?: string,
    embeddingProvider?: string
  ): Promise<SearchResult[]> {
    return this.provider.search(
      embedding,
      limit,
      businessId,
      embeddingProvider
    );
  }

  async listAll(): Promise<VectorRecord[]> {
    return this.provider.listAll();
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    return this.provider.deleteByDocumentId(documentId);
  }

  async updateMetadata(documentId: string, patch: Record<string, unknown>): Promise<void> {
    return this.provider.updateMetadata(documentId, patch);
  }
}