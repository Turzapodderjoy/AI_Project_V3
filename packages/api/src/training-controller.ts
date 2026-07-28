import {
  ChatAnalysisService,
  ChatAnalysisPipeline,
  PromptSuggestionService,
} from "@ai-chat-platform/training-pipeline";
import { AiConfigService } from "@ai-chat-platform/ai-config";

/**
 * Read/decide surface for the Training & Insights dashboard panel — the
 * actual analysis/suggestion GENERATION happens in the daily cron
 * (chat-analysis-pipeline.ts / prompt-suggestion-service.ts), not here.
 * This controller only reads what's already been produced and lets an
 * admin accept/decline a pending suggestion.
 */
export class TrainingController {
  constructor(
    private readonly analysis: ChatAnalysisService,
    private readonly aiConfig: AiConfigService,
    private readonly pipeline: ChatAnalysisPipeline,
    private readonly suggestions: PromptSuggestionService
  ) {}

  /** The daily 5am BST cron's single entry point — analyzes a batch of
   * unprocessed conversations, then checks every business for whether
   * enough new signal has accumulated to propose an AI Brain change. */
  async runPipeline() {
    const analysisResult = await this.pipeline.run();
    const suggestionResult = await this.suggestions.run();

    return { analysis: analysisResult, suggestions: suggestionResult };
  }

  analyses(businessId?: string) {
    return this.analysis.analyses(businessId);
  }

  pendingSuggestions() {
    return this.analysis.pendingSuggestions();
  }

  decidedSuggestions() {
    return this.analysis.decidedSuggestions();
  }

  /** Accepting writes a real new AiConfigVersion through the same
   * service the AI Brain panel's own Update/Add buttons use — an
   * accepted suggestion is indistinguishable from a manual edit in that
   * business's prompt history, by design. */
  async acceptSuggestion(id: string): Promise<{ accepted: string }> {
    const suggestion = await this.analysis.getSuggestion(id);

    if (!suggestion) {
      throw new Error(`Suggestion ${id} not found.`);
    }

    if (suggestion.status !== "pending") {
      throw new Error(`Suggestion ${id} has already been ${suggestion.status}.`);
    }

    const note = `Auto-suggested by training pipeline: ${suggestion.reasoning.slice(0, 150)}`;

    if (suggestion.kind === "append") {
      if (!suggestion.proposedAppendText) {
        throw new Error("Suggestion is missing its proposed append text.");
      }
      await this.aiConfig.append(suggestion.businessId, suggestion.proposedAppendText, note);
    } else {
      if (!suggestion.proposedSystemPrompt) {
        throw new Error("Suggestion is missing its proposed system prompt.");
      }
      const current = await this.aiConfig.getCurrent(suggestion.businessId);
      await this.aiConfig.update(
        suggestion.businessId,
        suggestion.proposedSystemPrompt,
        current.handoffFloor,
        current.historyTurns,
        current.temperature,
        note
      );
    }

    await this.analysis.decideSuggestion(id, "accepted");

    return { accepted: id };
  }

  async declineSuggestion(id: string): Promise<{ declined: string }> {
    const suggestion = await this.analysis.getSuggestion(id);

    if (!suggestion) {
      throw new Error(`Suggestion ${id} not found.`);
    }

    if (suggestion.status !== "pending") {
      throw new Error(`Suggestion ${id} has already been ${suggestion.status}.`);
    }

    await this.analysis.decideSuggestion(id, "declined");

    return { declined: id };
  }
}
