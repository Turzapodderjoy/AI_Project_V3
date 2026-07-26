import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { Retriever } from "@ai-chat-platform/retriever";
import { ConversationService } from "@ai-chat-platform/conversation";

import type {
  ChatRequest,
  ChatResponse,
} from "./types";

export class ChatService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly retriever: Retriever,
    private readonly prompts: PromptEngine,
    private readonly ai: AIManager
  ) {}

  async chat(
    request: ChatRequest
  ): Promise<ChatResponse> {

    const session =
      this.conversations.getOrCreate(
        request.sessionId,
        "default",
        "anonymous"
      );

    session.memory.add({
      role: "user",
      content: request.message,
      createdAt: new Date(),
    });

    const retrieved =
      await this.retriever.retrieve(
        request.message
      );

    const prompt =
      this.prompts.build({
        systemPrompt:
          "You are a helpful AI assistant. Answer only from the provided knowledge base whenever possible.",
        context:
          retrieved.map(chunk => chunk.text),
        userMessage:
          request.message,
      });

    const aiResponse =
      await this.ai.chat(
        prompt.prompt
      );

    session.memory.add({
      role: "assistant",
      content: aiResponse.response,
      createdAt: new Date(),
    });

    return {
      answer: aiResponse.response,
    };
  }
}