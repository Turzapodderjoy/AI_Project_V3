import { Chunker } from "@ai-chat-platform/chunker";
import type { EmbeddingManager } from "@ai-chat-platform/embedding-manager";

import {
  JsonProvider,
  VectorStoreManager,
} from "@ai-chat-platform/vector-store";
import type { VectorRecord } from "@ai-chat-platform/vector-store";

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

    // Embeds every chunk with EVERY registered embedding provider, not
    // just one — every client's knowledge base needs to be fully mapped
    // under every provider, so retrieval never depends on which
    // provider happened to embed the query. A provider that's down for
    // this call just gets fewer vectors this round; the daily backfill
    // cron (see EmbeddingManager.embedManyAllProviders callers) catches
    // up anything that was missed.
    const perProvider =
      chunks.length > 0
        ? await this.embeddingManager.embedManyAllProviders(
            chunks.map((chunk) => chunk.content)
          )
        : [];

    const vectors: VectorRecord[] = perProvider.flatMap(({ provider, results }) =>
      chunks.map((chunk, i) => ({
        id: crypto.randomUUID(),

        documentId,

        chunkId: chunk.id,

        text: chunk.content,

        embedding:
          results[i]!.embedding,

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
          // (see json-provider.ts's search()). Every provider gets its
          // own vector for the same chunk now, so this is what tells
          // them apart.
          embeddingProvider:
            provider,
          // Universal "when was this chunk (re)indexed" timestamp — covers
          // both uploads (which had no timestamp at all before this) and
          // crawled pages (which already had their own lastCrawledAt, kept
          // for backward compatibility since existing rows only have that).
          indexedAt:
            new Date().toISOString(),
          ...(request.metadata ?? {})
        }
      }))
    );

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

  /** Backfills missing embedding-provider coverage for content that
   * predates a provider being added (or was indexed while that provider
   * was temporarily down) — for each distinct chunk, embeds it with
   * whichever registered providers don't already have a vector for it.
   * Run daily via cron so every client's knowledge base stays fully
   * mapped under every embedding provider even as new providers get
   * added or old ones recover from an outage. */
  async backfillAllProviders(
    businessId?: string
  ): Promise<{ chunksChecked: number; chunksBackfilled: number; vectorsAdded: number }> {
    const all = await this.vectorStore.listAll();
    const scoped = businessId
      ? all.filter((r) => r.metadata?.businessId === businessId)
      : all;

    const byChunk = new Map<string, VectorRecord[]>();
    for (const record of scoped) {
      const key = `${record.documentId}::${record.chunkId}`;
      const list = byChunk.get(key) ?? [];
      list.push(record);
      byChunk.set(key, list);
    }

    const providerNames = this.embeddingManager.getProviderNames();
    let chunksBackfilled = 0;

    // JsonProvider.upsert() reads and rewrites the ENTIRE vector store file
    // on every call — calling it once per (chunk × missing provider), as
    // this used to, meant N×M full-file read/parse/stringify/write cycles
    // against a file that only grows. Accumulating every new record and
    // upserting once at the end turns that into a single rewrite for the
    // whole run, regardless of how many chunks/providers needed backfilling.
    const newRecords: VectorRecord[] = [];

    for (const records of byChunk.values()) {
      // Records without a tag at all predate this feature entirely and
      // were all embedded by Jina — see json-provider.ts's search().
      const covered = new Set(
        records.map((r) => (r.metadata?.embeddingProvider as string | undefined) ?? "jina")
      );
      const missing = providerNames.filter((name) => !covered.has(name));

      if (missing.length === 0) {
        continue;
      }

      const sample = records[0]!;
      let addedForThisChunk = false;

      for (const providerName of missing) {
        try {
          const result = await this.embeddingManager.embedWithProvider(providerName, sample.text);

          newRecords.push({
            id: crypto.randomUUID(),
            documentId: sample.documentId,
            chunkId: sample.chunkId,
            text: sample.text,
            embedding: result.embedding,
            metadata: {
              ...sample.metadata,
              embeddingProvider: providerName,
              indexedAt: new Date().toISOString(),
            },
          });

          addedForThisChunk = true;
        } catch {
          // That provider is still unavailable — next day's cron run tries again.
        }
      }

      if (addedForThisChunk) {
        chunksBackfilled += 1;
      }
    }

    if (newRecords.length > 0) {
      await this.vectorStore.upsert(newRecords);
    }

    return { chunksChecked: byChunk.size, chunksBackfilled, vectorsAdded: newRecords.length };
  }

  /** Read-only per-provider coverage report for one business — same
   * chunk-grouping logic as backfillAllProviders(), but never embeds
   * anything, just reports what's already there. Backs the Knowledge
   * Hub's "per embedding provider" status table. */
  async coverageStatus(businessId: string): Promise<
    Array<{ provider: string; chunksEmbedded: number; totalChunks: number; lastIndexedAt: string | null }>
  > {
    const all = await this.vectorStore.listAll();
    const scoped = all.filter((r) => r.metadata?.businessId === businessId);

    const byChunk = new Map<string, VectorRecord[]>();
    for (const record of scoped) {
      const key = `${record.documentId}::${record.chunkId}`;
      const list = byChunk.get(key) ?? [];
      list.push(record);
      byChunk.set(key, list);
    }

    const totalChunks = byChunk.size;
    const providerNames = this.embeddingManager.getProviderNames();

    return providerNames.map((providerName) => {
      let chunksEmbedded = 0;
      let lastIndexedAt: string | null = null;

      for (const records of byChunk.values()) {
        // Untagged records predate per-provider tagging and were all
        // embedded by Jina — same convention as json-provider.ts's search().
        const match = records.find(
          (r) => ((r.metadata?.embeddingProvider as string | undefined) ?? "jina") === providerName
        );

        if (match) {
          chunksEmbedded += 1;
          const indexedAt = match.metadata?.indexedAt as string | undefined;
          if (indexedAt && (!lastIndexedAt || indexedAt > lastIndexedAt)) {
            lastIndexedAt = indexedAt;
          }
        }
      }

      return { provider: providerName, chunksEmbedded, totalChunks, lastIndexedAt };
    });
  }
}
