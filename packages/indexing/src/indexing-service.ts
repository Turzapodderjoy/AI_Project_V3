import { Chunker } from "@ai-chat-platform/chunker";
import type { EmbeddingManager } from "@ai-chat-platform/embedding-manager";

import {
  JsonProvider,
  VectorStoreManager,
} from "@ai-chat-platform/vector-store";

import type {
  IndexRequest,
  IndexResult,
} from "./types";

export class IndexingService {
  private readonly vectorStore =
    new VectorStoreManager(
      new JsonProvider()
    );

  private readonly chunker =
    new Chunker();

  // Takes the shared, already-registered EmbeddingManager (built once in
  // bootstrap/create-app.ts) instead of constructing its own — a private
  // `new EmbeddingManager()` here used to mean document uploads never
  // got the dashboard-activated/rotating embedding providers everything
  // else uses, only a raw unconfigured Jina instance.
  constructor(private readonly embeddingManager: EmbeddingManager) {}

  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
  }

  async index(
    request: IndexRequest
  ): Promise<IndexResult> {

    const chunks =
      this.chunker.chunk(request.text);

    const documentId =
      request.documentId ??
      crypto.randomUUID();

    // One batched call for every chunk instead of one call per chunk —
    // the difference between 1 request and N requests to the embedding
    // API per document, which is what was triggering Jina's 429s.
    const embeddings =
      chunks.length > 0
        ? await this.embeddingManager.embedMany(
            chunks.map((chunk) => chunk.content)
          )
        : [];

    const vectors = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),

      documentId,

      chunkId: chunk.id,

      text: chunk.content,

      embedding:
        embeddings[i]!.embedding,

      metadata: {
        filename: request.filename,
        chunkIndex: chunk.index,
        startOffset:
          chunk.startOffset,
        endOffset:
          chunk.endOffset,
        tokenEstimate:
          chunk.tokenEstimate,
        // Tags which embedding provider produced this vector — required
        // so retrieval only ever compares vectors from the same space
        // (see json-provider.ts's search()). Different chunks of the
        // same document can end up with different providers if a
        // rotation happened mid-upload; that's fine, each is tagged
        // with what actually embedded it.
        embeddingProvider:
          embeddings[i]!.provider,
        // Universal "when was this chunk (re)indexed" timestamp — covers
        // both uploads (which had no timestamp at all before this) and
        // crawled pages (which already had their own lastCrawledAt, kept
        // for backward compatibility since existing rows only have that).
        indexedAt:
          new Date().toISOString(),
        ...(request.metadata ?? {})
      }
    }));

    await this.vectorStore.upsert(
      vectors
    );

    return {
      documentId,
      chunks: chunks.length,
      vectors: vectors.length,
      createdAt: new Date()
    };
  }
}
