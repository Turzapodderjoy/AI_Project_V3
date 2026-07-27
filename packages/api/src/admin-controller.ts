import { AIManager } from "@ai-chat-platform/ai-manager";
import { VectorStoreManager } from "@ai-chat-platform/vector-store";
import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { ChatUsageLog, ResponseCache } from "@ai-chat-platform/chat-service";
import { PROVIDER_CATALOG, PLANNED_PROVIDERS } from "@ai-chat-platform/provider-catalog";
import { TenantService } from "@ai-chat-platform/tenant";
import { ConversationService } from "@ai-chat-platform/conversation";
import { CrawlerService } from "@ai-chat-platform/web-crawler";
import { prisma } from "@ai-chat-platform/database";

export interface KnowledgeDocumentSummary {
  documentId: string;
  filename: string;
  chunks: number;
  /** Only meaningful for crawler-sourced pages; uploaded files show "uploaded". */
  status: string;
  lastCrawledAt: string | null;
}

export class AdminController {
  constructor(
    private readonly ai: AIManager,
    private readonly vectorStore: VectorStoreManager,
    private readonly embeddings: EmbeddingManager,
    private readonly chatUsageLog: ChatUsageLog,
    private readonly responseCache: ResponseCache,
    private readonly tenants: TenantService,
    private readonly conversations: ConversationService,
    private readonly crawler: CrawlerService
  ) {}

  providers() {
    return {
      active: this.ai.getProviders().map((p) => p.name),
      status: this.ai.getProviderStatus(),
    };
  }

  /** Every provider the dashboard can offer to activate, coded or not. */
  catalog() {
    return {
      available: PROVIDER_CATALOG.map((entry) => ({
        id: entry.id,
        label: entry.label,
      })),
      planned: PLANNED_PROVIDERS,
    };
  }

  /** Registers (or re-keys) a provider at runtime — no restart needed. */
  activateProvider(id: string, apiKey: string): { activated: string } {
    const entry = PROVIDER_CATALOG.find((e) => e.id === id);

    if (!entry) {
      throw new Error(
        `No adapter implemented for "${id}" yet — add it to packages/provider-catalog first.`
      );
    }

    if (!apiKey.trim()) {
      throw new Error("API key is required.");
    }

    if (this.ai.hasProvider(id)) {
      this.ai.setProviderKey(id, apiKey);
    } else {
      this.ai.registerProvider(entry.create(), [
        { id: `${id}-ui`, value: apiKey },
      ]);
    }

    return { activated: id };
  }

  usage() {
    return {
      ai: this.ai.getUsage(),
      embeddings: this.embeddings.getUsage(),
      cache: this.responseCache.stats(),
    };
  }

  chatUsage() {
    return this.chatUsageLog.recent();
  }

  async knowledge(businessId?: string): Promise<KnowledgeDocumentSummary[]> {
    const records = await this.vectorStore.listAll();

    const byDocument = new Map<string, KnowledgeDocumentSummary>();

    for (const record of records) {
      if (businessId && record.metadata?.businessId !== businessId) {
        continue;
      }

      const existing = byDocument.get(record.documentId);

      if (existing) {
        existing.chunks += 1;
        continue;
      }

      byDocument.set(record.documentId, {
        documentId: record.documentId,
        filename:
          (record.metadata?.filename as string | undefined) ?? "unknown",
        chunks: 1,
        status:
          (record.metadata?.pageStatus as string | undefined) ??
          (record.metadata?.source === "crawler" ? "new" : "uploaded"),
        lastCrawledAt: (record.metadata?.lastCrawledAt as string | undefined) ?? null,
      });
    }

    return [...byDocument.values()];
  }

  /** Removes one indexed document (all its chunks) — does not touch the
   * crawl target that produced it, if any; that keeps re-crawling. */
  async deleteDocument(documentId: string): Promise<{ deleted: string }> {
    await this.vectorStore.deleteByDocumentId(documentId);
    return { deleted: documentId };
  }

  /** Every client, for the mother dashboard's client list. */
  listBusinesses() {
    return this.tenants.listAll();
  }

  /** Its dashboard exists immediately at /dashboard/{id} — one dynamic
   * route serves every client, so nothing needs deploying per company. */
  createClient(name: string) {
    if (!name.trim()) {
      throw new Error("Company name is required.");
    }

    return this.tenants.createBusiness(name);
  }

  /** Removes a client and everything scoped to it: conversations (and
   * their messages, via cascade), crawl targets, and indexed knowledge —
   * not just the Business row, so nothing is left orphaned. */
  async deleteClient(businessId: string): Promise<{ deleted: string }> {
    const records = await this.vectorStore.listAll();
    const documentIds = new Set(
      records
        .filter((r) => r.metadata?.businessId === businessId)
        .map((r) => r.documentId)
    );

    for (const documentId of documentIds) {
      await this.vectorStore.deleteByDocumentId(documentId);
    }

    await this.crawler.deleteTargetsForBusiness(businessId);
    await this.conversations.deleteByBusinessId(businessId);
    await this.tenants.deleteBusiness(businessId);

    return { deleted: businessId };
  }

  async database(): Promise<{ connected: boolean; host: string | null; error?: string }> {
    const url = process.env.DATABASE_URL;
    const host = url ? maskConnectionString(url) : null;

    if (!url) {
      return { connected: false, host: null, error: "DATABASE_URL is not set" };
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      return { connected: true, host };
    } catch (error) {
      return {
        connected: false,
        host,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function maskConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.replace("/", "")}`;
  } catch {
    return "unknown";
  }
}
