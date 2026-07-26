import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { ConversationService } from "@ai-chat-platform/conversation";
import type { Retriever } from "@ai-chat-platform/retriever";
import type { VectorStoreManager } from "@ai-chat-platform/vector-store";
import type { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { ChatService, ChatUsageLog } from "@ai-chat-platform/chat-service";
import { RagService } from "@ai-chat-platform/rag";
import { IngestionPipeline } from "@ai-chat-platform/ingestion";
import { IndexingService } from "@ai-chat-platform/indexing";
import { UploadService } from "@ai-chat-platform/upload";
import { ChatController } from "@ai-chat-platform/api";
import { UploadController } from "@ai-chat-platform/api";
import { HealthController } from "@ai-chat-platform/api";
import { AdminController } from "@ai-chat-platform/api";
import { ApiRouter } from "@ai-chat-platform/api";

import { registerProviders } from "./register-providers";

export class Container {

  constructor(
    retriever: Retriever,
    vectorStore: VectorStoreManager,
    embeddings: EmbeddingManager
  ) {

    const conversations =
      new ConversationService();

    const prompts =
      new PromptEngine();

    const ai =
      new AIManager();

    registerProviders(ai);

    const chatUsageLog =
      new ChatUsageLog();

    const chat =
      new ChatService(
        conversations,
        retriever,
        prompts,
        ai,
        chatUsageLog
      );

    const rag =
      new RagService(chat);

    const uploadService =
      new UploadService(
        new IngestionPipeline(),
        new IndexingService()
      );

    this.router =
      new ApiRouter(
        new ChatController(rag),
        new UploadController(uploadService),
        new HealthController(),
        new AdminController(ai, vectorStore, embeddings, chatUsageLog)
      );
  }

  readonly router: ApiRouter;
}
