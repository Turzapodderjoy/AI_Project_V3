import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { Retriever } from "@ai-chat-platform/retriever";
import { ConversationService } from "@ai-chat-platform/conversation";

import { ChatUsageLog } from "./chat-usage-log";
import type {
  ChatRequest,
  ChatResponse,
} from "./types";

export class ChatService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly retriever: Retriever,
    private readonly prompts: PromptEngine,
    private readonly ai: AIManager,
    private readonly usageLog: ChatUsageLog
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

    // Top retrieval score doubles as a rough "grounding confidence" for
    // this answer — how well the knowledge base actually backs it.
    const confidence = retrieved[0]?.score ?? 0;

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

    this.usageLog.record({
      chatId: request.sessionId,
      provider: aiResponse.provider,
      tokens: aiResponse.tokens,
      confidence,
      createdAt: new Date().toISOString(),
    });

    return {
      answer: aiResponse.response,
      provider: aiResponse.provider,
      tokens: aiResponse.tokens,
      confidence,
    };
  }
}
