import type { ProviderKey } from "@ai-chat-platform/types";
import {
  AllProvidersFailedError,
  InvalidApiKeyError,
  ProviderUnavailableError,
  RateLimitedError,
  HealthTracker,
  KeyManager,
  UsageTracker,
  retryWithBackoff,
  type ProviderUsage,
} from "@ai-chat-platform/ai-manager";

import type { EmbeddingProvider, EmbeddingResult } from "./types";

interface RegisteredProvider {
  provider: EmbeddingProvider;
  keyManager: KeyManager;
}

/**
 * Same rotation/failover/health-tracking shape as AIManager (packages/
 * ai-manager) — reuses its KeyManager/HealthTracker/UsageTracker/
 * retryWithBackoff/error classes directly rather than re-implementing
 * them, since those primitives were already provider-agnostic. The
 * generate-vs-embed request/response shapes differ enough between chat
 * and embeddings that the orchestration loop itself is duplicated rather
 * than abstracted — worth revisiting if a third rotation-needing domain
 * shows up, not before.
 */
export class EmbeddingManager {
  private readonly providers = new Map<string, RegisteredProvider>();
  private readonly disabledProviders = new Set<string>();
  private readonly healthTracker = new HealthTracker();
  private readonly usageTracker = new UsageTracker();
  private readonly keyCooldownMs: number;
  private readonly maxRetriesPerKey: number;

  constructor(options: { keyCooldownMs?: number; maxRetriesPerKey?: number } = {}) {
    this.keyCooldownMs = options.keyCooldownMs ?? 30_000;
    this.maxRetriesPerKey = options.maxRetriesPerKey ?? 1;
  }

  getUsage(): Record<string, ProviderUsage> {
    return this.usageTracker.getAll();
  }

  getProviderStatus(): Array<{
    name: string;
    healthy: boolean;
    hasUsableKey: boolean;
    maskedKey: string | null;
    enabled: boolean;
  }> {
    return Array.from(this.providers.values()).map((entry) => ({
      name: entry.provider.name,
      healthy: this.healthTracker.isAvailable(entry.provider.name),
      hasUsableKey: entry.keyManager.hasAnyUsableKey(entry.provider.name),
      maskedKey: entry.keyManager.getMaskedKey(entry.provider.name),
      enabled: !this.disabledProviders.has(entry.provider.name.toLowerCase()),
    }));
  }

  getProviders(): EmbeddingProvider[] {
    return Array.from(this.providers.values()).map((entry) => entry.provider);
  }

  hasProvider(name: string): boolean {
    return this.providers.has(name.toLowerCase());
  }

  isProviderEnabled(name: string): boolean {
    return !this.disabledProviders.has(name.toLowerCase());
  }

  setProviderEnabled(name: string, enabled: boolean): void {
    const key = name.toLowerCase();

    if (!this.providers.has(key)) {
      throw new Error(`Embedding provider ${name} is not registered.`);
    }

    if (enabled) {
      this.disabledProviders.delete(key);
    } else {
      this.disabledProviders.add(key);
    }
  }

  /** Replaces the active key(s) for an already-registered provider. */
  setProviderKey(name: string, apiKey: string): void {
    const entry = this.providers.get(name.toLowerCase());

    if (!entry) {
      throw new Error(`Embedding provider ${name} is not registered.`);
    }

    entry.keyManager.registerKeys(name, [{ id: `${name}-ui`, value: apiKey }]);
  }

  registerProvider(provider: EmbeddingProvider, keys: ProviderKey[]): void {
    const name = provider.name.toLowerCase();

    if (this.providers.has(name)) {
      throw new Error(`Embedding provider ${provider.name} is already registered.`);
    }

    const keyManager = new KeyManager(this.keyCooldownMs);
    keyManager.registerKeys(name, keys);

    this.providers.set(name, { provider, keyManager });
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.run((provider, key) => provider.embed(text, key));
  }

  async embedMany(texts: string[]): Promise<EmbeddingResult[]> {
    return this.run(async (provider, key) =>
      provider.embedMany
        ? await provider.embedMany(texts, key)
        : await Promise.all(texts.map((t) => provider.embed(t, key)))
    );
  }

  /** Same structure as AIManager.generate(): try each enabled, healthy
   * provider in order, rotating through its keys, until one succeeds or
   * every provider/key combination has failed. */
  private async run<T extends EmbeddingResult | EmbeddingResult[]>(
    operation: (provider: EmbeddingProvider, apiKey: string) => Promise<T>
  ): Promise<T> {
    if (this.providers.size === 0) {
      throw new Error("No embedding providers registered.");
    }

    const failures: Error[] = [];

    for (const entry of this.providers.values()) {
      const provider = entry.provider;
      const providerName = provider.name;

      if (this.disabledProviders.has(providerName.toLowerCase())) {
        continue;
      }

      if (!(await this.isProviderHealthy(entry))) {
        continue;
      }

      if (!entry.keyManager.hasAnyUsableKey(providerName)) {
        failures.push(
          new ProviderUnavailableError(
            `Embedding provider ${providerName} has no usable API keys.`
          )
        );
        continue;
      }

      let key = entry.keyManager.getAvailableKey(providerName);

      while (key) {
        const currentKey = key;

        try {
          const result = await retryWithBackoff(
            () => operation(provider, currentKey.value),
            {
              attempts: this.maxRetriesPerKey + 1,
              baseDelayMs: 100,
              maxDelayMs: 1000,
              shouldRetry: (error) => error instanceof RateLimitedError,
            }
          );

          entry.keyManager.markKeySuccess(providerName, currentKey.id);
          this.healthTracker.recordSuccess(providerName);

          const tokens = Array.isArray(result)
            ? result.reduce((sum, r) => sum + (r.tokens ?? 0), 0)
            : (result.tokens ?? 0);
          this.usageTracker.recordSuccess(providerName, tokens);

          return result;
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));

          this.usageTracker.recordFailure(providerName);

          if (error instanceof InvalidApiKeyError) {
            entry.keyManager.markKeyFailed(providerName, currentKey.id, true);
            failures.push(error);
            key = entry.keyManager.getAvailableKey(providerName);
            continue;
          }

          if (error instanceof RateLimitedError) {
            entry.keyManager.markKeyFailed(providerName, currentKey.id);
            this.healthTracker.recordFailure(providerName);
            failures.push(error);
            key = entry.keyManager.getAvailableKey(providerName);
            continue;
          }

          // Same "must cool the key down here too" fix as AIManager —
          // otherwise an unclassified error leaves the key "available"
          // and this loop spins on it forever instead of moving on.
          entry.keyManager.markKeyFailed(providerName, currentKey.id);
          this.healthTracker.recordFailure(providerName);
          failures.push(error);
          key = entry.keyManager.getAvailableKey(providerName);
        }
      }
    }

    throw new AllProvidersFailedError(failures);
  }

  private async isProviderHealthy(entry: RegisteredProvider): Promise<boolean> {
    const providerName = entry.provider.name;

    if (!this.healthTracker.isAvailable(providerName)) {
      return false;
    }

    if (typeof entry.provider.health !== "function") {
      return true;
    }

    try {
      return await entry.provider.health();
    } catch {
      return false;
    }
  }
}
