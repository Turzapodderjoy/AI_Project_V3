import { AiConfigService, PLATFORM_CONFIG_ID } from "@ai-chat-platform/ai-config";

export class AiConfigController {
  constructor(
    private readonly aiConfig: AiConfigService
  ) {}

  current(businessId: string = PLATFORM_CONFIG_ID) {
    return this.aiConfig.getCurrent(businessId);
  }

  history(businessId: string = PLATFORM_CONFIG_ID, limit?: number) {
    return this.aiConfig.history(businessId, limit);
  }

  update(
    systemPrompt: string,
    handoffFloor: number,
    historyTurns: number,
    temperature: number,
    note?: string,
    businessId: string = PLATFORM_CONFIG_ID
  ) {
    if (!systemPrompt.trim()) {
      throw new Error("System prompt is required.");
    }

    if (!(handoffFloor >= 0 && handoffFloor <= 1)) {
      throw new Error("Handoff floor must be between 0 and 1.");
    }

    if (!(historyTurns >= 0)) {
      throw new Error("History turns must be 0 or more.");
    }

    if (!(temperature >= 0 && temperature <= 1)) {
      throw new Error("Temperature must be between 0 and 1.");
    }

    return this.aiConfig.update(businessId, systemPrompt, handoffFloor, historyTurns, temperature, note);
  }

  append(additionalText: string, note?: string, businessId: string = PLATFORM_CONFIG_ID) {
    if (!additionalText.trim()) {
      throw new Error("Text to add is required.");
    }

    return this.aiConfig.append(businessId, additionalText, note);
  }
}
