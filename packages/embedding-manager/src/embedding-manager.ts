import type {
  EmbeddingProvider,
  EmbeddingResult,
} from "./types";

export interface EmbeddingUsage {
  requests: number;
  tokens: number;
}

export class EmbeddingManager {
  private providers = new Map<string, EmbeddingProvider>();
  private usage = new Map<string, EmbeddingUsage>();

  register(provider: EmbeddingProvider): void {
    this.providers.set(provider.name, provider);
  }

  getUsage(): Record<string, EmbeddingUsage> {
    return Object.fromEntries(this.usage);
  }

  private recordUsage(providerName: string, tokens: number): void {
    const stats = this.usage.get(providerName) ?? { requests: 0, tokens: 0 };
    stats.requests += 1;
    stats.tokens += tokens;
    this.usage.set(providerName, stats);
  }

  getProvider(name?: string): EmbeddingProvider {
    const providerName =
      name ??
      process.env.EMBEDDING_PROVIDER ??
      "jina";

    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(
        `Embedding provider '${providerName}' not found.`
      );
    }

    return provider;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const provider = this.getProvider();
    const result = await provider.embed(text);
    this.recordUsage(provider.name, result.tokens ?? 0);
    return result;
  }

  async embedMany(
    texts: string[]
  ): Promise<EmbeddingResult[]> {
    const provider = this.getProvider();

    const results = provider.embedMany
      ? await provider.embedMany(texts)
      : await Promise.all(texts.map((text) => provider.embed(text)));

    const tokens = results.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
    this.recordUsage(provider.name, tokens);

    return results;
  }
}