import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { VectorStoreManager, PostgresProvider } from "@ai-chat-platform/vector-store";
import { VectorStoreRetriever } from "@ai-chat-platform/retriever";
import { AIManager } from "@ai-chat-platform/ai-manager";
import { ProviderKeyStore } from "@ai-chat-platform/provider-keys";

import { Container } from "./container";
import { Application } from "./app";
import { registerProviders } from "./register-providers";
import { registerEmbeddingProviders } from "./register-embedding-providers";

/**
 * The one real composition root for production wiring. Kept separate from
 * `Container` (which stays synchronous and accepts any `Retriever`) because
 * the default retriever needs an async `initialize()` before first use —
 * same reason provider registration lives here rather than in Container's
 * constructor: it needs an async DB read (dashboard-persisted keys) before
 * `Container` can be built with already-populated `AIManager`/`EmbeddingManager`.
 */
export async function createApp(): Promise<Application> {
  const providerKeys = new ProviderKeyStore();

  const ai = new AIManager();
  registerProviders(ai, await providerKeys.getAll("ai"));

  const embeddings = new EmbeddingManager();
  registerEmbeddingProviders(embeddings, await providerKeys.getAll("embedding"));

  const vectorStore = new VectorStoreManager(new PostgresProvider());
  await vectorStore.initialize();

  const retriever = new VectorStoreRetriever(embeddings, vectorStore);

  return new Application(
    new Container(retriever, vectorStore, embeddings, ai, providerKeys)
  );
}
