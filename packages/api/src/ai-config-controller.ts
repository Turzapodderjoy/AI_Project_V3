import { AiConfigService } from "@ai-chat-platform/ai-config";

export class AiConfigController {
  constructor(
    private readonly aiConfig: AiConfigService
  ) {}

  current() {
    return this.aiConfig.getCurrent();
  }

  history(limit?: number) {
    return this.aiConfig.history(limit);
  }

  update(systemPrompt: string, handoffFloor: number, historyTurns: number, note?: string) {
    if (!systemPrompt.trim()) {
      throw new Error("System prompt is required.");
    }

    if (!(handoffFloor >= 0 && handoffFloor <= 1)) {
      throw new Error("Handoff floor must be between 0 and 1.");
    }

    if (!(historyTurns >= 0)) {
      throw new Error("History turns must be 0 or more.");
    }

    return this.aiConfig.update(systemPrompt, handoffFloor, historyTurns, note);
  }

  append(additionalText: string, note?: string) {
    if (!additionalText.trim()) {
      throw new Error("Text to add is required.");
    }

    return this.aiConfig.append(additionalText, note);
  }
}
