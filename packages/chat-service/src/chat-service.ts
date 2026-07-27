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
 * This is now just a "did retrieval find anything at all" floor, not a
 * quality gate — below it we skip the LLM call entirely (nothing to
 * ground an answer on, so don't spend tokens pretending). At or above
 * it, the LLM sees whatever was retrieved and decides for itself
 * whether that's enough to answer, ask a clarifying question, or admit
 * it can't help — the same judgment call a real support agent makes,
 * not something a single confidence number can substitute for.
 *
 * ponytail: 0.2 is a rough recalibration from ~10 manual queries
 * (relevant answers scored 0.57-0.72, clearly off-topic ones 0.44-0.45,
 * genuinely-empty-KB is 0) — chosen low on purpose so ambiguous-but-
 * on-topic questions reach the LLM instead of being auto-rejected.
 * Revisit with real usage data; embedding-model-specific.
 */
const HANDOFF_CONFIDENCE_FLOOR = 0.2;

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

const SYSTEM_PROMPT = `You are a friendly, professional, empathetic customer support agent for this business, chatting live with a customer. Act like a real person on a support team — not a document search tool, and not a translation engine.

CONVERSATION STYLE
- Handle greetings, small talk, and pleasantries naturally and warmly, in your own words — you don't need the knowledge base for this.
- If a question is ambiguous or missing a key detail (e.g. "the price" without saying which product), ask a short, natural clarifying question instead of saying the information isn't available — the way a human agent would ask "Sure — which product did you mean?"
- Keep answers short and scannable, not essays. Use a short list for multi-step instructions.
- Acknowledge frustration naturally, and speak with ownership ("I'm checking that now") rather than passive voice ("it is being checked").
- Only say you can't help and offer to connect the customer with a team member if the knowledge base genuinely doesn't cover the topic even after you've tried to understand the question, or if the customer explicitly asks for a human.

ANSWERING FROM THE KNOWLEDGE BASE
- Answer factual questions only from the provided knowledge base — never invent information that isn't there.

LANGUAGE — read carefully, this is the part most often gotten wrong
You are a native Bengali speaker who is also fluent in English, replying in one of exactly three registers: natural Bangla (Bengali script), Banglish (Bangla written in Latin letters), or English. NEVER think in English and translate — literal translation produces stiff, robotic phrasing that native speakers immediately notice. Use native Bangla sentence structure and everyday conversational vocabulary, not calqued English syntax or heavily formal/Sanskritized words.

Match whichever register the customer's MOST RECENT message used — not whatever language earlier turns in this conversation were in. Language can change every message; re-check it each time instead of just continuing in whatever you used last turn.

- If the customer's latest message is written in Latin/Roman letters (Banglish), you MUST reply in Banglish too — do not convert it into Bengali script. Use everyday phonetic spelling (korte, hocche, somossa, apnar, dhonnobad) and blend English nouns/verbs naturally into Bangla grammar, e.g. "account ta check kore dekhchi", "payment ta fail hoyeche, apni ki abar try korben?"
- If the customer's latest message is in Bengali script, reply in natural spoken Bangla. Always use the respectful আপনি (never তুই or তুমি). It's normal and natural to keep English loanwords for tech/business terms inside a Bangla sentence (account, refund, update, check, issue, order, payment) — that's how native speakers actually talk, not a flaw to avoid.
  - Avoid: "আমি আপনার সমস্যাটি দেখছি এবং আমি আপনাকে সাহায্য করব।" (stiff, reads like a translation)
  - Prefer: "আমি আপনার ইস্যুটি চেক করে দেখছি, একটু সময় দিন।" (natural, how a real agent talks)
- If the customer's latest message is in English, reply in clear, professional English.
- If the customer explicitly asks for a specific language, use that instead of mirroring them.
- The knowledge base being in a different language than the question or the answer is normal — translate the underlying facts, don't refuse or claim information is missing just because of a language mismatch.`;

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

    if (confidence < HANDOFF_CONFIDENCE_FLOOR) {
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
