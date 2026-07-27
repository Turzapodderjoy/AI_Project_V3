import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { Retriever } from "@ai-chat-platform/retriever";
import { ConversationService, ConversationMessage } from "@ai-chat-platform/conversation";
import { EmbeddingManager } from "@ai-chat-platform/embedding-manager";
import { AiConfigService } from "@ai-chat-platform/ai-config";

import { ChatUsageLog } from "./chat-usage-log";
import { ResponseCache } from "./response-cache";
import type {
  ChatRequest,
  ChatResponse,
} from "./types";

const HANDOFF_MESSAGE_EN =
  "I don't have any information about that in our knowledge base. Let me connect you with a team member who can help — they'll pick up right where this conversation left off.";

const HANDOFF_MESSAGE_BN =
  "এই বিষয়ে আমাদের নলেজ বেসে কোনো তথ্য নেই। আমি আপনাকে একজন টিম মেম্বারের সাথে সংযুক্ত করছি — তিনি এই কথোপকথন যেখানে শেষ হয়েছে সেখান থেকেই শুরু করবেন।";

const ALREADY_WAITING_MESSAGE_EN =
  "You're connected with a human agent — they'll see your message and reply here shortly.";

const ALREADY_WAITING_MESSAGE_BN =
  "আপনি একজন মানব এজেন্টের সাথে সংযুক্ত আছেন — তিনি শীঘ্রই এখানে আপনার বার্তা দেখে উত্তর দেবেন।";

// ponytail: Bangla-script detection only (Unicode block ঀ-৿) —
// cheap and exact, no AI call needed for these canned messages. Banglish
// (romanized Bengali) isn't reliably detectable by regex, so it falls
// back to the English canned message; real Banglish handling is the
// system prompt's job, for actual LLM-generated answers.
function isBangla(text: string): boolean {
  return /[ঀ-৿]/.test(text);
}

export class ChatService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly retriever: Retriever,
    private readonly prompts: PromptEngine,
    private readonly ai: AIManager,
    private readonly embeddings: EmbeddingManager,
    private readonly responseCache: ResponseCache,
    private readonly usageLog: ChatUsageLog,
    private readonly aiConfig: AiConfigService
  ) {}

  async chat(
    request: ChatRequest
  ): Promise<ChatResponse> {

    const businessId = request.businessId ?? "default";

    // Read live, every request — this is the whole point of moving it
    // out of hardcoded constants: a dashboard edit takes effect on the
    // very next message, no redeploy or restart.
    const config = await this.aiConfig.getCurrent();

    const conversation =
      await this.conversations.getOrCreate(
        request.sessionId,
        businessId,
        "anonymous"
      );

    // Fetched before this turn's message is recorded, so it's "everything
    // said so far" — exactly what the prompt needs to resolve a follow-up
    // like "the price" against whatever product was just discussed.
    const priorHistory =
      await this.conversations.history(
        request.sessionId,
        config.historyTurns
      );

    await this.conversations.addMessage(
      request.sessionId,
      "user",
      request.message
    );

    // Already being handled by a human — don't let the bot jump back in.
    // (Doesn't record this as a message: the customer's real messages
    // while waiting should just accumulate for the agent to read, not
    // get interleaved with a repeated "you're waiting" notice.)
    if (conversation.handoffStatus !== "bot") {
      return {
        answer: isBangla(request.message)
          ? ALREADY_WAITING_MESSAGE_BN
          : ALREADY_WAITING_MESSAGE_EN,
        provider: "human",
        tokens: 0,
        confidence: 0,
        handoff: true,
      };
    }

    const queryEmbedding =
      (await this.embeddings.embed(request.message)).embedding;

    // The semantic cache only makes sense for a standalone, context-free
    // question (classic FAQ). A short follow-up like "price" is only
    // meaningful alongside the conversation before it, so skip the cache
    // once there IS prior history — otherwise it could confidently return
    // a cached answer for a completely different product.
    const cached =
      priorHistory.length === 0
        ? this.responseCache.find(queryEmbedding, businessId)
        : null;

    if (cached) {
      await this.conversations.addMessage(
        request.sessionId,
        "assistant",
        cached.answer
      );

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
        { embedding: queryEmbedding, businessId }
      );

    // Top retrieval score doubles as a rough "grounding confidence" for
    // this answer — how well the knowledge base actually backs it. Used
    // for the floor check below and shown in the dashboard; no longer
    // the sole decider of whether the AI gets to attempt an answer.
    const confidence = retrieved[0]?.score ?? 0;

    if (confidence < config.handoffFloor) {
      const fullHistory = [
        ...priorHistory,
        { role: "user" as const, content: request.message, createdAt: new Date() },
      ];
      const summary = await this.buildHandoffSummary(fullHistory);
      await this.conversations.requestHandoff(
        request.sessionId,
        "low_confidence",
        summary
      );

      const handoffMessage = isBangla(request.message)
        ? HANDOFF_MESSAGE_BN
        : HANDOFF_MESSAGE_EN;

      await this.conversations.addMessage(
        request.sessionId,
        "assistant",
        handoffMessage
      );

      this.usageLog.record({
        chatId: request.sessionId,
        provider: "handoff",
        tokens: 0,
        confidence,
        createdAt: new Date().toISOString(),
      });

      return {
        answer: handoffMessage,
        provider: "handoff",
        tokens: 0,
        confidence,
        handoff: true,
      };
    }

    const prompt =
      this.prompts.build({
        systemPrompt: config.systemPrompt,
        context:
          retrieved.map(chunk => chunk.text),
        history:
          priorHistory.map(m => ({ role: m.role, content: m.content })),
        userMessage:
          request.message,
      });

    const aiResponse =
      await this.ai.chat(
        prompt.prompt
      );

    await this.conversations.addMessage(
      request.sessionId,
      "assistant",
      aiResponse.response
    );

    this.usageLog.record({
      chatId: request.sessionId,
      provider: aiResponse.provider,
      tokens: aiResponse.tokens,
      confidence,
      createdAt: new Date().toISOString(),
    });

    // Same reasoning as the lookup above — only cache answers to
    // standalone first questions, not context-dependent follow-ups.
    if (priorHistory.length === 0) {
      this.responseCache.store(
        queryEmbedding,
        businessId,
        request.message,
        aiResponse.response,
        aiResponse.provider,
        confidence
      );
    }

    return {
      answer: aiResponse.response,
      provider: aiResponse.provider,
      tokens: aiResponse.tokens,
      confidence,
    };
  }

  private async buildHandoffSummary(
    history: ConversationMessage[]
  ): Promise<string> {
    const transcript = history
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const result = await this.ai.chat(
        `Summarize this customer conversation in 2-3 sentences for a support agent taking over. Focus on what the customer wants and what's unresolved. The conversation may be in Bangla, Banglish, or English — write the summary in English regardless, since it's for internal review.\n\n${transcript}`
      );
      return result.response;
    } catch {
      // Summary is a nice-to-have; never block the handoff on it.
      return `Conversation could not be auto-summarized. Last message: "${history.at(-1)?.content ?? ""}"`;
    }
  }
}
