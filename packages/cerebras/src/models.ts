// UNVERIFIED — written without a live API key (none was available at
// implementation time). Cerebras' free-tier model catalog is known to be
// volatile (it reportedly collapsed from ~12 models to 2 within 2026), so
// this MUST be confirmed against a real `GET /v1/models` call the first
// time a real CEREBRAS_API_KEY is added, the same way gemini/openrouter's
// first-picked defaults both turned out to be retired and had to be
// swapped after a direct curl check (see packages/gemini, packages/openrouter).
export const DEFAULT_MODEL = "llama-3.3-70b";

export const MODELS = [
  "llama-3.3-70b",
  "llama3.1-8b",
];
