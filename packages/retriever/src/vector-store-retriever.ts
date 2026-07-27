import type { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import type { VectorStoreManager } from "@ai-chat-platform/vector-store";

import type {
  RetrieveOptions,
  RetrievedChunk,
  Retriever,
} from "./types";

export class VectorStoreRetriever implements Retriever {
  constructor(
    private readonly embeddings: EmbeddingManager,
    private readonly vectorStore: VectorStoreManager
  ) {}

  async retrieve(
    query: string,
    options: RetrieveOptions = {}
  ): Promise<RetrievedChunk[]> {
    let embedding = options.embedding;
    let embeddingProvider = options.embeddingProvider;

    if (!embedding) {
      const embedded = await this.embeddings.embed(query);
      embedding = embedded.embedding;
      embeddingProvider = embedded.provider;
    }

    const results = await this.vectorStore.search(
      embedding,
      options.limit ?? 5,
      options.businessId,
      embeddingProvider
    );

    // Cosine similarity scores are in [-1, 1], unlike the keyword
    // scorer's integer match counts, so this retriever's default
    // threshold is 0, not 1.
    const minimumScore = options.minimumScore ?? 0;

    return results
      .filter((result) => result.score >= minimumScore)
      .map((result) => ({
        id: result.id,
        text: result.text,
        score: result.score,
        metadata: result.metadata,
      }));
  }
}
