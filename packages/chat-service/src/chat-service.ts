import { AIManager } from "@ai-chat-platform/ai-manager";
import { PromptEngine } from "@ai-chat-platform/prompt-engine";
import { Retriever } from "@ai-chat-platform/retriever";
import { ConversationService, ConversationMessage } from "@ai-chat-platform/conversation";
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

const HANDOFF_MESSAGE_EN =
  "I don't have specific information about that in our knowledge base. Let me connect you with a team member who can help — they'll pick up right where this conversation left off.";

const HANDOFF_MESSAGE_BN =
  "এই বিষয়ে আমাদের নলেজ বেসে সুনির্দিষ্ট তথ্য নেই। আমি আপনাকে একজন টিম মেম্বারের সাথে সংযুক্ত করছি — তিনি এই কথোপকথন যেখানে শেষ হয়েছে সেখান থেকেই শুরু করবেন।";

// ponytail: Bangla-script detection only (Unicode block ঀ-৿) —
// cheap and exact, no AI call needed for this canned message. Banglish
// (romanized Bengali) isn't reliably detectable by regex, so it falls
// back to the English canned message; the real Banglish handling is in
// the system prompt below, for actual LLM-generated answers.
function isBangla(text: string): boolean {
  return /[ঀ-৿]/.test(text);
}

const SYSTEM_PROMPT = `You are a helpful AI assistant answering customer questions for this business.

Answer only from the provided knowledge base whenever possible — never invent information that isn't there.

Language handling:
- The knowledge base may contain Bangla (Bengali script), Banglish (Bengali written in Latin letters), and English, in any mix — understand and use all of it regardless of which one it's written in.
- Reply in whichever of Bangla, Banglish, or English the customer just used — match their language and style.
- If the customer explicitly asks for a specific language, use that instead of mirroring them.
- The knowledge base being in a different language than the question or the answer is normal — translate the facts, don't refuse or claim the information is missing just because of a language mismatch.`;

// How many prior turns to feed back into the prompt. Unbounded history
// would grow the prompt (and cost) forever; this is enough for a
// customer-support-style back-and-forth without ballooning tokens.
const HISTORY_TURNS = 10;

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

    const businessId = request.businessId ?? "default";

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
        HISTORY_TURNS
      );

    await this.conversations.addMessage(
      request.sessionId,
      "user",
      request.message
    );

    // Already being handled by a human — don't let the bot jump back in.
    if (conversation.handoffStatus !== "bot") {
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
    // this answer — how well the knowledge base actually backs it.
    const confidence = retrieved[0]?.score ?? 0;

    if (confidence < HANDOFF_CONFIDENCE_THRESHOLD) {
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
        systemPrompt: SYSTEM_PROMPT,
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
