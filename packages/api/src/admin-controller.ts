import { AIManager } from "@ai-chat-platform/ai-manager";
import { VectorStoreManager } from "@ai-chat-platform/vector-store";
import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { ChatUsageLog } from "@ai-chat-platform/chat-service";
import { PROVIDER_CATALOG, PLANNED_PROVIDERS } from "@ai-chat-platform/provider-catalog";
import { prisma } from "@ai-chat-platform/database";

export interface KnowledgeDocumentSummary {
  documentId: string;
  filename: string;
  chunks: number;
}

export class AdminController {
  constructor(
    private readonly ai: AIManager,
    private readonly vectorStore: VectorStoreManager,
    private readonly embeddings: EmbeddingManager,
    private readonly chatUsageLog: ChatUsageLog
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
    };
  }

  chatUsage() {
    return this.chatUsageLog.recent();
  }

  async knowledge(): Promise<KnowledgeDocumentSummary[]> {
    const records = await this.vectorStore.listAll();

    const byDocument = new Map<string, KnowledgeDocumentSummary>();

    for (const record of records) {
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
      });
    }

    return [...byDocument.values()];
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
