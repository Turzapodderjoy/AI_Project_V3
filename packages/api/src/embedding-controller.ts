import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import {
  EMBEDDING_PROVIDER_CATALOG,
  PLANNED_EMBEDDING_PROVIDERS,
} from "@ai-chat-platform/embedding-catalog";
import { ProviderKeyStore } from "@ai-chat-platform/provider-keys";

/**
 * Same shape as AdminController's provider-management methods (providers/
 * catalog/activateProvider/setProviderEnabled/usage), just for embedding
 * providers instead of AI chat providers — the two systems are fully
 * separate (own EmbeddingManager/AIManager instance, own catalog, own
 * "kind" in ProviderApiKey) so they can never collide even when a
 * provider has the same name in both (e.g. "gemini").
 */
export class EmbeddingController {
  constructor(
    private readonly embeddings: EmbeddingManager,
    private readonly providerKeys: ProviderKeyStore
  ) {}

  providers() {
    return {
      active: this.embeddings.getProviders().map((p) => p.name),
      status: this.embeddings.getProviderStatus(),
    };
  }

  /** Every embedding provider the dashboard can offer to activate, coded or not. */
  catalog() {
    return {
      available: EMBEDDING_PROVIDER_CATALOG.map((entry) => ({
        id: entry.id,
        label: entry.label,
      })),
      planned: PLANNED_EMBEDDING_PROVIDERS,
    };
  }

  /** Registers (or re-keys) an embedding provider at runtime — no restart
   * needed — AND persists the key to Postgres so it survives one, same
   * as AdminController.activateProvider() for AI chat providers. */
  async activateProvider(id: string, apiKey: string): Promise<{ activated: string }> {
    const entry = EMBEDDING_PROVIDER_CATALOG.find((e) => e.id === id);

    if (!entry) {
      throw new Error(
        `No adapter implemented for "${id}" yet — add it to packages/embedding-catalog first.`
      );
    }

    if (!apiKey.trim()) {
      throw new Error("API key is required.");
    }

    if (this.embeddings.hasProvider(id)) {
      this.embeddings.setProviderKey(id, apiKey);
    } else {
      this.embeddings.registerProvider(entry.create(), [
        { id: `${id}-ui`, value: apiKey },
      ]);
    }

    await this.providerKeys.set("embedding", id, apiKey);

    return { activated: id };
  }

  /** Forces an embedding provider on/off for experimentation — same
   * semantics as AdminController.setProviderEnabled(). */
  setProviderEnabled(id: string, enabled: boolean): { id: string; enabled: boolean } {
    this.embeddings.setProviderEnabled(id, enabled);
    return { id, enabled };
  }

  usage() {
    return this.embeddings.getUsage();
  }
}
