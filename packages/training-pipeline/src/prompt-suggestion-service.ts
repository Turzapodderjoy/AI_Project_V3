import { ChatAnalysisService } from "./chat-analysis-service";
import { ReasoningClient } from "./reasoning-client";
import { PROMPT_SUGGESTION_SYSTEM_PROMPT, buildPromptSuggestionUserPrompt } from "./system-prompt";
import type { AiConfigService } from "@ai-chat-platform/ai-config";
import type { TenantService } from "@ai-chat-platform/tenant";

interface RawSuggestionResponse {
  shouldChange?: boolean;
  kind?: string;
  reasoning?: string;
  proposedSystemPrompt?: string;
  proposedAppendText?: string;
}

/** Only worth spending a reasoning-LLM call on a business once it has
 * this many NEW "kept" findings since its last suggestion (or ever) —
 * otherwise every business would get a suggestion-generation call every
 * single day even with nothing new to say, burning the pipeline's
 * shared rate-limit budget on empty results. */
const MIN_NEW_FINDINGS = 5;

export class PromptSuggestionService {
  constructor(
    private readonly analysis: ChatAnalysisService,
    private readonly reasoning: ReasoningClient,
    private readonly aiConfig: AiConfigService,
    private readonly tenants: TenantService
  ) {}

  /** Runs the suggestion pass across every client business — the
   * platform-wide ("__platform__") prompt is deliberately excluded,
   * since it's the mother dashboard's shared default, not any one
   * client's real usage pattern. */
  async run(): Promise<{ businessesChecked: number; suggestionsCreated: number }> {
    const businesses = await this.tenants.listAll();

    let suggestionsCreated = 0;

    for (const business of businesses) {
      const created = await this.checkOne(business.id);
      if (created) {
        suggestionsCreated += 1;
      }
    }

    return { businessesChecked: businesses.length, suggestionsCreated };
  }

  private async checkOne(businessId: string): Promise<boolean> {
    const lastSuggestionAt = await this.analysis.lastSuggestionAt(businessId);
    const findings = await this.analysis.keptFindingsSince(businessId, lastSuggestionAt);

    if (findings.length < MIN_NEW_FINDINGS) {
      return false;
    }

    const current = await this.aiConfig.getCurrent(businessId);
    const userPrompt = buildPromptSuggestionUserPrompt({
      currentSystemPrompt: current.systemPrompt,
      findingsBatch: findings,
    });

    let result;
    try {
      result = await this.reasoning.ask(PROMPT_SUGGESTION_SYSTEM_PROMPT, userPrompt);
    } catch (error) {
      // Reasoning LLM unavailable right now — try again next run, don't
      // burn through every business's budget retrying immediately.
      console.error(`Prompt suggestion check failed for business ${businessId}:`, error);
      return false;
    }

    const parsed = parseJsonResponse<RawSuggestionResponse>(result.content);

    if (!parsed) {
      console.error(
        `Prompt suggestion for business ${businessId}: unparseable response. Raw: ${result.content.slice(0, 300)}`
      );
      return false;
    }

    if (!parsed.shouldChange) {
      console.log(`Prompt suggestion for business ${businessId}: no change needed — ${parsed.reasoning}`);
      return false;
    }

    const kind = parsed.kind === "append" ? "append" : "update";

    if (kind === "update" && !parsed.proposedSystemPrompt) {
      return false;
    }

    if (kind === "append" && !parsed.proposedAppendText) {
      return false;
    }

    await this.analysis.createSuggestion({
      businessId,
      kind,
      proposedSystemPrompt: kind === "update" ? parsed.proposedSystemPrompt : null,
      proposedAppendText: kind === "append" ? parsed.proposedAppendText : null,
      reasoning: parsed.reasoning ?? "(no reasoning text returned)",
    });

    return true;
  }
}

function parseJsonResponse<T>(raw: string): T | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
