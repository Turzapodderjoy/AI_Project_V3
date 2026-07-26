import { ConversationService } from "@ai-chat-platform/conversation";

export interface HandoffSummary {
  sessionId: string;
  status: string;
  reason: string | null;
  summary: string | null;
  requestedAt: string | null;
  lastMessage: string;
}

export class HandoffController {
  constructor(
    private readonly conversations: ConversationService
  ) {}

  list(): HandoffSummary[] {
    return this.conversations.listHandoffs().map((session) => ({
      sessionId: session.id,
      status: session.handoffStatus,
      reason: session.handoffReason,
      summary: session.handoffSummary,
      requestedAt: session.handoffRequestedAt,
      lastMessage: session.memory.history().at(-1)?.content ?? "",
    }));
  }

  messages(sessionId: string) {
    const session = this.conversations.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    return session.memory.history();
  }

  reply(sessionId: string, message: string): { ok: true } {
    this.conversations.sendAgentMessage(sessionId, message);
    return { ok: true };
  }
}
