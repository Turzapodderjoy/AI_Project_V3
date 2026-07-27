import { prisma } from "@ai-chat-platform/database";
import { IndexingService } from "@ai-chat-platform/indexing";
import { VectorStoreManager, JsonProvider } from "@ai-chat-platform/vector-store";

import { crawlSite } from "./crawler";

export interface CrawlTargetSummary {
  id: string;
  businessId: string;
  url: string;
  lastCrawledAt: string | null;
  lastPageCount: number | null;
  lastChunkCount: number | null;
  lastError: string | null;
}

type CrawlTargetRow = {
  id: string;
  businessId: string;
  url: string;
  lastCrawledAt: Date | null;
  lastPageCount: number | null;
  lastChunkCount: number | null;
  lastError: string | null;
};

function toSummary(row: CrawlTargetRow): CrawlTargetSummary {
  return {
    id: row.id,
    businessId: row.businessId,
    url: row.url,
    lastCrawledAt: row.lastCrawledAt?.toISOString() ?? null,
    lastPageCount: row.lastPageCount,
    lastChunkCount: row.lastChunkCount,
    lastError: row.lastError,
  };
}

export class CrawlerService {
  private readonly indexing = new IndexingService();
  private readonly vectorStore = new VectorStoreManager(new JsonProvider());

  async addTarget(businessId: string, url: string): Promise<CrawlTargetSummary> {
    const target = await prisma.crawlTarget.upsert({
      where: { businessId_url: { businessId, url } },
      update: {},
      create: { businessId, url },
    });

    return this.runCrawl(target);
  }

  async listTargets(businessId?: string): Promise<CrawlTargetSummary[]> {
    const targets = await prisma.crawlTarget.findMany({
      where: businessId ? { businessId } : undefined,
      orderBy: { createdAt: "desc" },
    });

    return targets.map(toSummary);
  }

  async crawlTarget(id: string): Promise<CrawlTargetSummary> {
    const target = await prisma.crawlTarget.findUniqueOrThrow({ where: { id } });
    return this.runCrawl(target);
  }

  /** Re-crawls every registered site across every business — what the
   * daily cron job calls. */
  async crawlAll(): Promise<CrawlTargetSummary[]> {
    const targets = await prisma.crawlTarget.findMany();
    const results: CrawlTargetSummary[] = [];

    for (const target of targets) {
      results.push(await this.runCrawl(target));
    }

    return results;
  }

  private async runCrawl(target: CrawlTargetRow): Promise<CrawlTargetSummary> {
    await this.indexing.initialize();
    await this.vectorStore.initialize();

    try {
      const pages = await crawlSite(target.url);
      let chunkCount = 0;

      for (const page of pages) {
        // Stable per-page documentId so a re-crawl replaces that page's
        // old chunks instead of piling up duplicates forever.
        const documentId = `crawl:${target.id}:${page.url}`;

        await this.vectorStore.deleteByDocumentId(documentId);

        const result = await this.indexing.index({
          filename: page.url,
          text: page.text,
          documentId,
          metadata: {
            businessId: target.businessId,
            source: "crawler",
            url: page.url,
          },
        });

        chunkCount += result.chunks;
      }

      const updated = await prisma.crawlTarget.update({
        where: { id: target.id },
        data: {
          lastCrawledAt: new Date(),
          lastPageCount: pages.length,
          lastChunkCount: chunkCount,
          lastError: null,
        },
      });

      return toSummary(updated);
    } catch (error) {
      const updated = await prisma.crawlTarget.update({
        where: { id: target.id },
        data: {
          lastCrawledAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      return toSummary(updated);
    }
  }
}
