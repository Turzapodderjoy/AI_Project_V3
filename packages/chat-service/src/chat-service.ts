import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { Retriever } from "@ai-chat-platform/retriever";
import { ConversationService, Session } from "@ai-chat-platform/conversation";
import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";

import { ChatUsageLog } from "./chat-usage-log";
import { ResponseCache } from "./response-cache";
import type {
  ChatRequest,
  ChatResponse,
} from "./types";

/**
 * Below this retrieval confidence, the knowledge base almost certainly
 * doesn't cover the question — calling the LLM anyway just risks a
 * hallucinated answer (confidently wrong) instead of an honest "let me
 * get you a person." So we skip the LLM call entirely and hand off.
 *
 * ponytail: calibrated from ~6 manual test queries on Jina embeddings
 * (relevant answers scored 0.57-0.72, irrelevant ones 0.44-0.45), not a
 * validated dataset. Revisit once real usage data exists, and note this
 * is embedding-model-specific — changing the embedding provider means
 * re-checking this number.
 */
const HANDOFF_CONFIDENCE_THRESHOLD = 0.5;

const HANDOFF_MESSAGE =
  "I don't have specific information about that in our knowledge base. Let me connect you with a team member who can help — they'll pick up right where this conversation left off.";

export class ChatService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly retriever: Retriever,
    private readonly prompts: PromptEngine,
    private readonly ai: AIManager,
    private readonly embeddings: EmbeddingManager,
    private readonly responseCache: ResponseCache,
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

    // Already being handled by a human — don't let the bot jump back in.
    if (session.handoffStatus !== "bot") {
      return {
        answer: "",
        provider: "human",
        tokens: 0,
        confidence: 0,
        handoff: true,
      };
    }

    const queryEmbedding =
      (await this.embeddings.embed(request.message)).embedding;

    const cached = this.responseCache.find(queryEmbedding);

    if (cached) {
      session.memory.add({
        role: "assistant",
        content: cached.answer,
        createdAt: new Date(),
      });

      this.usageLog.record({
        chatId: request.sessionId,
        provider: `${cached.provider} (cached)`,
        tokens: 0,
        confidence: cached.confidence,
        createdAt: new Date().toISOString(),
      });

      return {
        answer: cached.answer,
        provider: cached.provider,
        tokens: 0,
        confidence: cached.confidence,
        cached: true,
      };
    }

    const retrieved =
      await this.retriever.retrieve(
        request.message,
        { embedding: queryEmbedding }
      );

    // Top retrieval score doubles as a rough "grounding confidence" for
    // this answer — how well the knowledge base actually backs it.
    const confidence = retrieved[0]?.score ?? 0;

    if (confidence < HANDOFF_CONFIDENCE_THRESHOLD) {
      const summary = await this.buildHandoffSummary(session);
      session.requestHandoff("low_confidence", summary);

      session.memory.add({
        role: "assistant",
        content: HANDOFF_MESSAGE,
        createdAt: new Date(),
      });

      this.usageLog.record({
        chatId: request.sessionId,
        provider: "handoff",
        tokens: 0,
        confidence,
        createdAt: new Date().toISOString(),
      });

      return {
        answer: HANDOFF_MESSAGE,
        provider: "handoff",
        tokens: 0,
        confidence,
        handoff: true,
      };
    }

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

    this.responseCache.store(
      queryEmbedding,
      request.message,
      aiResponse.response,
      aiResponse.provider,
      confidence
    );

    return {
      answer: aiResponse.response,
      provider: aiResponse.provider,
      tokens: aiResponse.tokens,
      confidence,
    };
  }

  private async buildHandoffSummary(
    session: Session
  ): Promise<string> {
    const history = session.memory
      .history()
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const result = await this.ai.chat(
        `Summarize this customer conversation in 2-3 sentences for a support agent taking over. Focus on what the customer wants and what's unresolved.\n\n${history}`
      );
      return result.response;
    } catch {
      // Summary is a nice-to-have; never block the handoff on it.
      return `Conversation could not be auto-summarized. Last message: "${session.memory.history().at(-1)?.content ?? ""}"`;
    }
  }
}
