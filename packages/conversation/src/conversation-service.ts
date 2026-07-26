import { Session } from "./session";

export class ConversationService {

  private readonly sessions =
    new Map<string, Session>();

  create(
    businessId: string,
    userId: string
  ): Session {

    const session =
      new Session(
        crypto.randomUUID(),
        businessId,
        userId
      );

    this.sessions.set(
      session.id,
      session
    );

    return session;
  }

  get(
    sessionId: string
  ): Session | undefined {

    return this.sessions.get(
      sessionId
    );
  }

  getOrCreate(
    sessionId: string,
    businessId: string,
    userId: string
  ): Session {

    const existing =
      this.sessions.get(sessionId);

    if (existing) {
      return existing;
    }

    const session =
      new Session(
        sessionId,
        businessId,
        userId
      );

    this.sessions.set(
      session.id,
      session
    );

    return session;
  }

  delete(
    sessionId: string
  ): void {

    this.sessions.delete(
      sessionId
    );
  }

  listHandoffs(): Session[] {
    return [...this.sessions.values()].filter(
      (session) => session.handoffStatus !== "bot"
    );
  }

  sendAgentMessage(sessionId: string, message: string): Session {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error("Session not found");
    }

    session.memory.add({
      role: "agent",
      content: message,
      createdAt: new Date(),
    });

    session.handoffStatus = "human";

    return session;
  }
}