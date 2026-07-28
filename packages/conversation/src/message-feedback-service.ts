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
   * pass/fail replaces the previous one rather than piling up history. */
  async record(
    messageId: string,
    businessId: string,
    verdict: "pass" | "fail",
    note?: string
  ): Promise<MessageFeedbackRecord> {
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
