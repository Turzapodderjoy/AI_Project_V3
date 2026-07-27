import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { ConversationService } from "@ai-chat-platform/conversation";
import type { Retriever } from "@ai-chat-platform/retriever";
import type { VectorStoreManager } from "@ai-chat-platform/vector-store";
import type { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { ChatService, ChatUsageLog, ResponseCache } from "@ai-chat-platform/chat-service";
import { AiConfigService } from "@ai-chat-platform/ai-config";
import { RagService } from "@ai-chat-platform/rag";
import { IngestionPipeline } from "@ai-chat-platform/ingestion";
import { IndexingService } from "@ai-chat-platform/indexing";
import { UploadService } from "@ai-chat-platform/upload";
import { TenantService } from "@ai-chat-platform/tenant";
import { CrawlerService } from "@ai-chat-platform/web-crawler";
import { ChatController } from "@ai-chat-platform/api";
import { UploadController } from "@ai-chat-platform/api";
import { HealthController } from "@ai-chat-platform/api";
import { AdminController } from "@ai-chat-platform/api";
import { HandoffController } from "@ai-chat-platform/api";
import { CrawlerController } from "@ai-chat-platform/api";
import { AiConfigController } from "@ai-chat-platform/api";
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

    const responseCache =
      new ResponseCache();

    const aiConfig =
      new AiConfigService();

    const chat =
      new ChatService(
        conversations,
        retriever,
        prompts,
        ai,
        embeddings,
        responseCache,
        chatUsageLog,
        aiConfig
      );

    const rag =
      new RagService(chat);

    const uploadService =
      new UploadService(
        new IngestionPipeline(),
        new IndexingService()
      );

    const crawlerService =
      new CrawlerService();

    this.router =
      new ApiRouter(
        new ChatController(rag),
        new UploadController(uploadService),
        new HealthController(),
        new AdminController(
          ai,
          vectorStore,
          embeddings,
          chatUsageLog,
          responseCache,
          new TenantService(),
          conversations,
          crawlerService
        ),
        new HandoffController(conversations),
        new CrawlerController(crawlerService),
        new AiConfigController(aiConfig)
      );
  }

  readonly router: ApiRouter;
}
