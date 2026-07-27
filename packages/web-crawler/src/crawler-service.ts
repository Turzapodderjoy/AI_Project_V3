import { prisma } from "@ai-chat-platform/database";
import { IndexingService } from "@ai-chat-platform/indexing";
import { VectorStoreManager, JsonProvider } from "@ai-chat-platform/vector-store";

import { crawlSite } from "./crawler";
import { estimatePageCount } from "./estimate";

const MAX_PAGES = 25;

export interface CrawlTargetSummary {
  id: string;
  businessId: string;
  url: string;
  status: string;
  pagesEstimated: number | null;
  pagesDone: number;
  lastCrawledAt: string | null;
  lastPageCount: number | null;
  lastChunkCount: number | null;
  lastError: string | null;
}

type CrawlTargetRow = {
  id: string;
  businessId: string;
  url: string;
  status: string;
  pagesEstimated: number | null;
  pagesDone: number;
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
    status: row.status,
    pagesEstimated: row.pagesEstimated,
    pagesDone: row.pagesDone,
    lastCrawledAt: row.lastCrawledAt?.toISOString() ?? null,
    lastPageCount: row.lastPageCount,
    lastChunkCount: row.lastChunkCount,
    lastError: row.lastError,
  };
}

export class CrawlerService {
  private readonly indexing = new IndexingService();
  private readonly vectorStore = new VectorStoreManager(new JsonProvider());

  /** Creates (or re-queues) a target. Does NOT crawl — the caller runs
   * `runCrawl` separately, typically in the background, so a live
   * request can respond immediately and the client polls for progress. */
  async addTarget(businessId: string, url: string): Promise<CrawlTargetSummary> {
    const target = await prisma.crawlTarget.upsert({
      where: { businessId_url: { businessId, url } },
      update: { status: "queued", pagesDone: 0, lastError: null },
      create: { businessId, url, status: "queued" },
    });

    return toSummary(target);
  }

  async queueForCrawl(id: string): Promise<CrawlTargetSummary> {
    const target = await prisma.crawlTarget.update({
      where: { id },
      data: { status: "queued", pagesDone: 0, lastError: null },
    });

    return toSummary(target);
  }

  async listTargets(businessId?: string): Promise<CrawlTargetSummary[]> {
    const targets = await prisma.crawlTarget.findMany({
      where: businessId ? { businessId } : undefined,
      orderBy: { createdAt: "desc" },
    });

    return targets.map(toSummary);
  }

  /** The actual work — call this from a background task (e.g. Next.js
   * `after()`), not inline in a request handler a user is waiting on. */
  async runCrawl(id: string): Promise<CrawlTargetSummary> {
    const target = await prisma.crawlTarget.findUniqueOrThrow({ where: { id } });

    await this.indexing.initialize();
    await this.vectorStore.initialize();

    try {
      const estimate = await estimatePageCount(target.url, MAX_PAGES);

      await prisma.crawlTarget.update({
        where: { id },
        data: { status: "crawling", pagesEstimated: estimate, pagesDone: 0 },
      });

      const pages = await crawlSite(target.url, {
        maxPages: MAX_PAGES,
        onPage: (pagesDone) => {
          // Fire-and-forget progress update — losing one write to a
          // transient DB hiccup shouldn't abort the crawl itself.
          prisma.crawlTarget
            .update({ where: { id }, data: { pagesDone } })
            .catch(() => {});
        },
      });

      let chunkCount = 0;

      for (const page of pages) {
        // Stable per-page documentId so a re-crawl replaces that page's
        // old chunks instead of piling up duplicates forever.
        const documentId = `crawl:${id}:${page.url}`;

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
        where: { id },
        data: {
          status: "done",
          // Self-correct the estimate to the real count so the bar reads
          // 100%, not stuck below it if the sitemap over-counted.
          pagesEstimated: pages.length,
          pagesDone: pages.length,
          lastCrawledAt: new Date(),
          lastPageCount: pages.length,
          lastChunkCount: chunkCount,
          lastError: null,
        },
      });

      return toSummary(updated);
    } catch (error) {
      const updated = await prisma.crawlTarget.update({
        where: { id },
        data: {
          status: "error",
          lastCrawledAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      return toSummary(updated);
    }
  }

  /** Re-crawls every registered site across every business — what the
   * daily cron calls. Runs sequentially and awaited; nobody's watching a
   * progress bar for this one. */
  async crawlAll(): Promise<CrawlTargetSummary[]> {
    const targets = await prisma.crawlTarget.findMany();
    const results: CrawlTargetSummary[] = [];

    for (const target of targets) {
      results.push(await this.runCrawl(target.id));
    }

    return results;
  }
}
