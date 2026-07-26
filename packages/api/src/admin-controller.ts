import { AIManager } from "@ai-chat-platform/ai-manager";
import { VectorStoreManager } from "@ai-chat-platform/vector-store";
import { prisma } from "@ai-chat-platform/database";

export interface KnowledgeDocumentSummary {
  documentId: string;
  filename: string;
  chunks: number;
}

export class AdminController {
  constructor(
    private readonly ai: AIManager,
    private readonly vectorStore: VectorStoreManager
  ) {}

  providers() {
    return {
      active: this.ai.getProviders().map((p) => p.name),
      status: this.ai.getProviderStatus(),
    };
  }

  usage() {
    return this.ai.getUsage();
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
