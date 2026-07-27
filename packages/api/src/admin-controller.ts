import { AIManager } from "@ai-chat-platform/ai-manager";
import { VectorStoreManager } from "@ai-chat-platform/vector-store";
import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { ChatUsageLog, ResponseCache } from "@ai-chat-platform/chat-service";
import { PROVIDER_CATALOG, PLANNED_PROVIDERS } from "@ai-chat-platform/provider-catalog";
import { TenantService } from "@ai-chat-platform/tenant";
import { ConversationService } from "@ai-chat-platform/conversation";
import { CrawlerService } from "@ai-chat-platform/web-crawler";
import { ProviderKeyStore } from "@ai-chat-platform/provider-keys";
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
    private readonly crawler: CrawlerService,
    private readonly providerKeys: ProviderKeyStore
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

  /** Registers (or re-keys) a provider at runtime — no restart needed —
   * AND persists the key to Postgres so it survives one. Without the
   * persistence half, "activate" was only ever a live patch to the
   * in-memory AIManager that silently reverted to whatever .env said
   * the next time the process restarted, which isn't actually
   * plug-and-play no matter what the dashboard copy claims. */
  async activateProvider(id: string, apiKey: string): Promise<{ activated: string }> {
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

    await this.providerKeys.set("ai", id, apiKey);

    return { activated: id };
  }

  /** Forces a provider on/off for experimentation — independent of its
   * actual health/key state. Disabling every provider but one forces
   * that one to handle every request; disabling one forces the rest to
   * pick up its traffic. Takes effect on the very next chat, no restart. */
  setProviderEnabled(id: string, enabled: boolean): { id: string; enabled: boolean } {
    this.ai.setProviderEnabled(id, enabled);
    return { id, enabled };
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

  /** Where a client's data actually lives and roughly how much of it
   * there is — deliberately honest that this is a local JSON file today,
   * not a real cloud object store or vector DB yet. */
  async storageInfo(businessId: string): Promise<{
    knowledgeChunks: number;
    knowledgeDocuments: number;
    knowledgeBytesEstimate: number;
    conversations: number;
    messages: number;
    crawlTargets: number;
    vectorStoreLocation: string;
    databaseLocation: string | null;
  }> {
    const records = await this.vectorStore.listAll();
    const forBusiness = records.filter((r) => r.metadata?.businessId === businessId);

    const knowledgeBytesEstimate = forBusiness.reduce(
      (sum, r) => sum + JSON.stringify(r).length,
      0
    );

    const [conversations, messages, crawlTargets] = await Promise.all([
      prisma.conversation.count({ where: { businessId } }),
      prisma.message.count({ where: { conversation: { businessId } } }),
      prisma.crawlTarget.count({ where: { businessId } }),
    ]);

    const url = process.env.DATABASE_URL;

    return {
      knowledgeChunks: forBusiness.length,
      knowledgeDocuments: new Set(forBusiness.map((r) => r.documentId)).size,
      knowledgeBytesEstimate,
      conversations,
      messages,
      crawlTargets,
      vectorStoreLocation: "Local JSON file (packages/vector-store) — shared across clients by businessId tag, not yet pgvector/cloud",
      databaseLocation: url ? `PostgreSQL — ${maskConnectionString(url)}` : null,
    };
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
