import { AIManager } from "@ai-chat-platform/ai-manager";
import { PROVIDER_CATALOG } from "@ai-chat-platform/provider-catalog";

/**
 * Auto-activates every catalog entry whose env var is set. Adding a new
 * provider adapter never requires touching this function — add it to
 * PROVIDER_CATALOG (packages/provider-catalog) and set its env var.
 */
export function registerProviders(manager: AIManager): void {
  for (const entry of PROVIDER_CATALOG) {
    const apiKey = process.env[entry.envKey];

    if (!apiKey) {
      continue;
    }

    manager.registerProvider(entry.create(), [
      { id: `${entry.id}-env`, value: apiKey },
    ]);
  }
}
