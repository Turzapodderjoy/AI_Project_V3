export interface RetrievedChunk {
  id: string;

  text: string;

  score: number;

  metadata?: Record<string, unknown>;
}

export interface RetrieveOptions {
  limit?: number;

  minimumScore?: number;

  /** Precomputed query embedding — lets callers avoid embedding the same
   * text twice (e.g. once for a response cache lookup, once for search).
   * Ignored by retrievers that don't use embeddings (e.g. keyword-based). */
  embedding?: number[];
}

export interface Retriever {
  retrieve(
    query: string,
    options?: RetrieveOptions
  ): Promise<RetrievedChunk[]>;
}