import { EmbeddingManager, JinaProvider } from "@ai-chat-platform/embedding-manager";
import { VectorStoreManager, JsonProvider } from "@ai-chat-platform/vector-store";
import { VectorStoreRetriever } from "@ai-chat-platform/retriever";
import { AIManager } from "@ai-chat-platform/ai-manager";
import { ProviderKeyStore } from "@ai-chat-platform/provider-keys";

import { Container } from "./container";
import { Application } from "./app";
import { registerProviders } from "./register-providers";

/**
 * The one real composition root for production wiring. Kept separate from
 * `Container` (which stays synchronous and accepts any `Retriever`) because
 * the default retriever needs an async `initialize()` before first use —
 * same reason provider registration lives here rather than in Container's
 * constructor: it needs an async DB read (dashboard-persisted keys) before
 * `Container` can be built with an already-populated `AIManager`.
 */
export async function createApp(): Promise<Application> {
  const embeddings = new EmbeddingManager();
  embeddings.register(new JinaProvider());

  const vectorStore = new VectorStoreManager(new JsonProvider());
  await vectorStore.initialize();

  const retriever = new VectorStoreRetriever(embeddings, vectorStore);

  const ai = new AIManager();
  const providerKeys = new ProviderKeyStore();
  const persisted = await providerKeys.getAll();
  registerProviders(ai, persisted);

  return new Application(
    new Container(retriever, vectorStore, embeddings, ai, providerKeys)
  );
}
