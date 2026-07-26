import { GroqProvider } from "@ai-chat-platform/groq";

import type { ProviderCatalogEntry } from "./types";

/**
 * Every AI provider that has a real, working adapter class. Adding a new
 * provider here is the ONLY code change needed to make it available for
 * activation (env var at startup, or the dashboard's "Add provider" form
 * at runtime) — nothing in bootstrap, the API, or the dashboard hardcodes
 * provider names.
 */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    create: () => new GroqProvider(),
  },
];

/**
 * Providers named in the product plan that don't have an adapter yet.
 * Listed so the dashboard can show them as "not implemented" instead of
 * pretending they work — implementing one means writing a class that
 * implements AIProvider and adding one entry above.
 */
export const PLANNED_PROVIDERS: { id: string; label: string }[] = [
  { id: "gemini", label: "Gemini" },
  { id: "claude", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "ollama", label: "Ollama" },
  { id: "together", label: "Together" },
];
