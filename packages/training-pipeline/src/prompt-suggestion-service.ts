import { ChatAnalysisService } from "./chat-analysis-service";
import { ReasoningClient } from "./reasoning-client";
import { PROMPT_SUGGESTION_SYSTEM_PROMPT, buildPromptSuggestionUserPrompt } from "./system-prompt";
import type { AiConfigService } from "@ai-chat-platform/ai-config";
import type { TenantService } from "@ai-chat-platform/tenant";

interface RawSuggestionResponse {
  shouldChange?: boolean;
  reasoning?: string;
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
   * client's real usage pattern. `pipelineRunId` (if given) tags every
   * suggestion created this pass with the PipelineRun that produced it,
   * for the Training & Insights panel's run-history table. */
  async run(pipelineRunId?: string): Promise<{ businessesChecked: number; suggestionsCreated: number }> {
    const businesses = await this.tenants.listAll();

    let suggestionsCreated = 0;

    for (const business of businesses) {
      const created = await this.checkOne(business.id, pipelineRunId);
      if (created) {
        suggestionsCreated += 1;
      }
    }

    return { businessesChecked: businesses.length, suggestionsCreated };
  }

  private async checkOne(businessId: string, pipelineRunId?: string): Promise<boolean> {
    const lastSuggestionAt = await this.analysis.lastSuggestionAt(businessId);
    const findings = await this.analysis.keptFindingsSince(businessId, lastSuggestionAt);

    if (findings.length < MIN_NEW_FINDINGS) {
      return false;
    }

    try {
      const suggestion = await this.suggestFromFindings(businessId, findings, pipelineRunId);
      return suggestion !== null;
    } catch (error) {
      // Reasoning LLM unavailable or returned something unparseable —
      // try again next run, don't crash the whole batch pass over it.
      console.error(`Prompt suggestion check failed for business ${businessId}:`, error);
      return false;
    }
  }

  /** Same reasoning-LLM call as checkOne(), but skips the "wait for
   * MIN_NEW_FINDINGS" threshold — for the Training Arena's "End session &
   * review" button, where a single deliberately-provoked session is
   * itself the whole point, not a rolling batch of incidental findings.
   * Returns the created suggestion (or null if the model decided no
   * change is warranted) so the caller can show it for review/save/
   * discard immediately instead of waiting to notice it in the pending
   * suggestions list. */
  async suggestFromFindings(
    businessId: string,
    findings: string[],
    pipelineRunId?: string
  ): Promise<{ id: string; proposedAppendText: string; reasoning: string } | null> {
    const current = await this.aiConfig.getCurrent(businessId);
    const userPrompt = buildPromptSuggestionUserPrompt({
      currentSystemPrompt: current.systemPrompt,
      findingsBatch: findings,
    });

    const result = await this.reasoning.ask(PROMPT_SUGGESTION_SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse<RawSuggestionResponse>(result.content);

    if (!parsed) {
      throw new Error(
        `Prompt suggestion for business ${businessId}: unparseable response. Raw: ${result.content.slice(0, 300)}`
      );
    }

    if (!parsed.shouldChange || !parsed.proposedAppendText) {
      return null;
    }

    const created = await this.analysis.createSuggestion({
      businessId,
      kind: "append",
      proposedSystemPrompt: null,
      proposedAppendText: parsed.proposedAppendText,
      reasoning: parsed.reasoning ?? "(no reasoning text returned)",
      pipelineRunId,
    });

    return {
      id: created.id,
      proposedAppendText: parsed.proposedAppendText,
      reasoning: parsed.reasoning ?? "(no reasoning text returned)",
    };
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
