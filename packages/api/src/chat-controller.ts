import { RagService } from "@ai-chat-platform/rag";

export class ChatController {
  constructor(
    private readonly rag: RagService
  ) {}

  async post(
    sessionId: string,
    message: string,
    businessId?: string
  ) {
    return this.rag.ask({
      sessionId,
      message,
      businessId,
    });
  }
}
