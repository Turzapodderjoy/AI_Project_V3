import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import type {
  SearchResult,
  VectorRecord,
  VectorStore,
} from "../types";

export class JsonProvider implements VectorStore {
  private readonly filePath = path.join(
    process.cwd(),
    "storage",
    "embeddings",
    "knowledge.json"
  );

  // Every mutating method below does read-full-file -> mutate-in-memory ->
  // write-full-file. Two such calls running concurrently (a crawl's own
  // background writes racing a manual backfill, or two crawls at once)
  // can corrupt the file — found live: two overlapping writes produced a
  // file containing one complete, valid JSON array followed immediately
  // by a raw fragment of a second, unrelated write, permanently losing
  // every record that belonged to whichever write didn't "win". This
  // queue serializes every mutation through this one process so two
  // writes can never overlap, no matter how many concurrent callers
  // there are. (Scoped to this process — if this ever runs as multiple
  // separate processes/serverless instances sharing the same file, a
  // real database or a cross-process lock would be needed instead.)
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn, fn);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true,
    });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeAtomic([]);
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.read();

      const map = new Map<string, VectorRecord>(
        current.map((record) => [record.id, record])
      );

      for (const record of records) {
        map.set(record.id, record);
      }

      await this.writeAtomic([...map.values()]);
    });
  }

  async search(
    embedding: number[],
    limit = 5,
    businessId?: string,
    embeddingProvider?: string
  ): Promise<SearchResult[]> {
    const all = await this.read();

    let records = businessId
      ? all.filter((r) => r.metadata?.businessId === businessId)
      : all;

    if (embeddingProvider) {
      // Records indexed before this filter existed have no
      // embeddingProvider tag at all — they were all embedded by Jina
      // (the only provider that existed then), so untagged records must
      // default to "jina" here or every chunk indexed before this
      // change would silently vanish from search results.
      records = records.filter(
        (r) => (r.metadata?.embeddingProvider ?? "jina") === embeddingProvider
      );
    }

    if (records.length === 0) {
      return [];
    }

    return records
      .map((record) => ({
        ...record,
        score: this.cosineSimilarity(
          embedding,
          record.embedding
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async listAll(): Promise<VectorRecord[]> {
    return this.read();
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    return this.deleteByDocumentIds([documentId]);
  }

  async deleteByDocumentIds(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;

    return this.enqueue(async () => {
      const current = await this.read();
      const toDelete = new Set(documentIds);
      const remaining = current.filter((r) => !toDelete.has(r.documentId));

      await this.writeAtomic(remaining);
    });
  }

  async updateMetadata(
    documentId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    return this.updateMetadataMany([documentId], patch);
  }

  async updateMetadataMany(documentIds: string[], patch: Record<string, unknown>): Promise<void> {
    if (documentIds.length === 0) return;

    return this.enqueue(async () => {
      const current = await this.read();
      const targets = new Set(documentIds);

      const updated = current.map((r) =>
        targets.has(r.documentId)
          ? { ...r, metadata: { ...r.metadata, ...patch } }
          : r
      );

      await this.writeAtomic(updated);
    });
  }

  private cosineSimilarity(
    a: number[],
    b: number[]
  ): number {
    if (
      a.length === 0 ||
      b.length === 0 ||
      a.length !== b.length
    ) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      const valA = a[i] ?? 0;
      const valB = b[i] ?? 0;

      dotProduct += valA * valB;
      magnitudeA += valA * valA;
      magnitudeB += valB * valB;
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /** Write to a temp file then rename over the real path — rename is
   * atomic on the same filesystem, so a reader can never observe a
   * half-written file even if the process crashes mid-write. This alone
   * doesn't stop two concurrent CALLERS from racing (that's what
   * enqueue() is for) but it does stop a single write from ever leaving
   * the file in a corrupted, half-flushed state. */
  private async writeAtomic(records: VectorRecord[]): Promise<void> {
    const tmpPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }

  private async read(): Promise<VectorRecord[]> {
    let text: string;

    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }

    try {
      return JSON.parse(text) as VectorRecord[];
    } catch (err) {
      // Never silently treat a corrupted file as "empty" — a caller doing
      // read -> merge -> write would then overwrite the corrupted file
      // with JUST its own new records, permanently destroying whatever
      // was actually on disk (even the parts that were still salvageable).
      // Failing loudly here is what makes corruption visible immediately
      // instead of manifesting later as silently-empty search results.
      throw new Error(
        `Vector store file is corrupted and could not be parsed as JSON: ${(err as Error).message}`
      );
    }
  }
}
