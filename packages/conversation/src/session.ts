import { ConversationMemory } from "./memory";

export type HandoffStatus = "bot" | "pending" | "human";

export class Session {

  readonly memory =
    new ConversationMemory();

  handoffStatus: HandoffStatus = "bot";
  handoffSummary: string | null = null;
  handoffReason: string | null = null;
  handoffRequestedAt: string | null = null;

  constructor(
    public readonly id: string,
    public readonly businessId: string,
    public readonly userId: string
  ) {}

  requestHandoff(reason: string, summary: string): void {
    this.handoffStatus = "pending";
    this.handoffReason = reason;
    this.handoffSummary = summary;
    this.handoffRequestedAt = new Date().toISOString();
  }
}
