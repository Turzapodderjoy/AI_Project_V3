import { prisma } from "@ai-chat-platform/database";

import type {
  ConversationMessage,
  ConversationRecord,
  HandoffStatus,
} from "./types";

type ConversationRow = {
  id: string;
  businessId: string;
  userId: string;
  handoffStatus: string;
  handoffReason: string | null;
  handoffSummary: string | null;
  handoffRequestedAt: Date | null;
};

function toRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    businessId: row.businessId,
    userId: row.userId,
    handoffStatus: row.handoffStatus.toLowerCase() as HandoffStatus,
    handoffReason: row.handoffReason,
    handoffSummary: row.handoffSummary,
    handoffRequestedAt: row.handoffRequestedAt,
  };
}

export class ConversationService {

  async getOrCreate(
    sessionId: string,
    businessId: string,
    userId: string
  ): Promise<ConversationRecord> {

    const existing = await prisma.conversation.findUnique({
      where: { id: sessionId },
    });

    if (existing) {
      return toRecord(existing);
    }

    const created = await prisma.conversation.create({
      data: { id: sessionId, businessId, userId },
    });

    return toRecord(created);
  }

  async get(sessionId: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({
      where: { id: sessionId },
    });

    return row ? toRecord(row) : null;
  }

  async addMessage(
    sessionId: string,
    role: ConversationMessage["role"],
    content: string
  ): Promise<void> {
    await prisma.message.create({
      data: { conversationId: sessionId, role, content },
    });
  }

  async history(
    sessionId: string,
    limit = 50
  ): Promise<ConversationMessage[]> {
    const rows = await prisma.message.findMany({
      where: { conversationId: sessionId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    return rows.map((row) => ({
      role: row.role as ConversationMessage["role"],
      content: row.content,
      createdAt: row.createdAt,
    }));
  }

  async requestHandoff(
    sessionId: string,
    reason: string,
    summary: string
  ): Promise<void> {
    await prisma.conversation.update({
      where: { id: sessionId },
      data: {
        handoffStatus: "PENDING",
        handoffReason: reason,
        handoffSummary: summary,
        handoffRequestedAt: new Date(),
      },
    });
  }

  async listHandoffs(businessId?: string): Promise<ConversationRecord[]> {
    const rows = await prisma.conversation.findMany({
      where: {
        handoffStatus: { not: "BOT" },
        ...(businessId ? { businessId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    return rows.map(toRecord);
  }

  async sendAgentMessage(sessionId: string, message: string): Promise<void> {
    await prisma.message.create({
      data: { conversationId: sessionId, role: "agent", content: message },
    });

    await prisma.conversation.update({
      where: { id: sessionId },
      data: { handoffStatus: "HUMAN" },
    });
  }
}
