import fs from "fs/promises";
import path from "path";

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

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true,
    });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(
        this.filePath,
        JSON.stringify([], null, 2),
        "utf8"
      );
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    const current = await this.read();

    const map = new Map<string, VectorRecord>(
      current.map((record) => [record.id, record])
    );

    for (const record of records) {
      map.set(record.id, record);
    }

    await fs.writeFile(
      this.filePath,
      JSON.stringify(
        [...map.values()],
        null,
        2
      ),
      "utf8"
    );
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

    const current = await this.read();
    const toDelete = new Set(documentIds);
    const remaining = current.filter((r) => !toDelete.has(r.documentId));

    await fs.writeFile(
      this.filePath,
      JSON.stringify(remaining, null, 2),
      "utf8"
    );
  }

  async updateMetadata(
    documentId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    return this.updateMetadataMany([documentId], patch);
  }

  async updateMetadataMany(documentIds: string[], patch: Record<string, unknown>): Promise<void> {
    if (documentIds.length === 0) return;

    const current = await this.read();
    const targets = new Set(documentIds);

    const updated = current.map((r) =>
      targets.has(r.documentId)
        ? { ...r, metadata: { ...r.metadata, ...patch } }
        : r
    );

    await fs.writeFile(
      this.filePath,
      JSON.stringify(updated, null, 2),
      "utf8"
    );
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

  private async read(): Promise<VectorRecord[]> {
    try {
      const text = await fs.readFile(
        this.filePath,
        "utf8"
      );

      return JSON.parse(text) as VectorRecord[];
    } catch {
      return [];
    }
  }
}