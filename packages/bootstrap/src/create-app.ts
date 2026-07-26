import { EmbeddingManager, JinaProvider } from "@ai-chat-platform/embedding-manager";
import { VectorStoreManager, JsonProvider } from "@ai-chat-platform/vector-store";
import { VectorStoreRetriever } from "@ai-chat-platform/retriever";

import { Container } from "./container";
import { Application } from "./app";

/**
 * The one real composition root for production wiring. Kept separate from
 * `Container` (which stays synchronous and accepts any `Retriever`) because
 * the default retriever needs an async `initialize()` before first use.
 */
export async function createApp(): Promise<Application> {
  const embeddings = new EmbeddingManager();
  embeddings.register(new JinaProvider());

  const vectorStore = new VectorStoreManager(new JsonProvider());
  await vectorStore.initialize();

  const retriever = new VectorStoreRetriever(embeddings, vectorStore);

  return new Application(new Container(retriever));
}
