import { Chunker } from "@ai-chat-platform/chunker";
import {
  EmbeddingManager,
  JinaProvider,
} from "@ai-chat-platform/embedding-manager";

import {
  JsonProvider,
  VectorStoreManager,
} from "@ai-chat-platform/vector-store";

import type {
  IndexRequest,
  IndexResult,
} from "./types";

export class IndexingService {
  private readonly embeddingManager =
    new EmbeddingManager();

  private readonly vectorStore =
    new VectorStoreManager(
      new JsonProvider()
    );

  private readonly chunker =
    new Chunker();

  constructor() {
    this.embeddingManager.register(
      new JinaProvider()
    );
  }

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