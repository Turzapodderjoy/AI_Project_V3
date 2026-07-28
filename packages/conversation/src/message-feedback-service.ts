import { prisma } from "@ai-chat-platform/database";

export interface MessageFeedbackRecord {
  messageId: string;
  businessId: string;
  verdict: "pass" | "fail";
  note: string | null;
}

/** Per-message QA verdicts recorded from the Chat Demo tab — the
 * training pipeline's strongest signal, since it's an explicit human
 * judgment of one specific answer rather than an LLM's own guess at
 * conversation quality. */
export class MessageFeedbackService {
  /** Upsert — only the current verdict for a message matters, re-clicking
   * pass/fail replaces the previous one rather than piling up history.
   * Verifies the message actually belongs to a conversation for the
   * given businessId first — the caller (a public-CORS route) supplies
   * both messageId and businessId itself, so without this check a
   * guessed/observed messageId could have QA feedback attached to it
   * under an arbitrary businessId, poisoning that client's training
   * signal with feedback on an answer that was never actually theirs. */
  async record(
    messageId: string,
    businessId: string,
    verdict: "pass" | "fail",
    note?: string
  ): Promise<MessageFeedbackRecord> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { businessId: true } } },
    });

    if (!message || message.conversation.businessId !== businessId) {
      throw new Error("Message not found for this business.");
    }

    const row = await prisma.messageFeedback.upsert({
      where: { messageId },
      create: { messageId, businessId, verdict, note: note?.trim() || null },
      update: { verdict, note: note?.trim() || null },
    });

    return { messageId: row.messageId, businessId: row.businessId, verdict: row.verdict as "pass" | "fail", note: row.note };
  }

  /** Batch lookup, keyed by messageId — used by the training pipeline to
   * annotate a conversation's transcript without one query per message. */
  async forMessageIds(messageIds: string[]): Promise<Map<string, MessageFeedbackRecord>> {
    if (messageIds.length === 0) return new Map();

    const rows = await prisma.messageFeedback.findMany({
      where: { messageId: { in: messageIds } },
    });

    return new Map(
      rows.map((row) => [
        row.messageId,
        { messageId: row.messageId, businessId: row.businessId, verdict: row.verdict as "pass" | "fail", note: row.note },
      ])
    );
  }
}
