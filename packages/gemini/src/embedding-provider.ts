import type { EmbeddingProvider, EmbeddingResult } from "@ai-chat-platform/embedding-manager";
import { InvalidApiKeyError, RateLimitedError } from "@ai-chat-platform/types";

// Verified with a real key: POST .../models/gemini-embedding-001:embedContent
// returns a 3072-dim vector under response.embedding.values.
const EMBED_MODEL = "gemini-embedding-001";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
const BATCH_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;

interface EmbedContentResponse {
  embedding?: { values: number[] };
}

interface BatchEmbedContentsResponse {
  embeddings?: { values: number[] }[];
}

function throwTyped(status: number, body: string, provider: string): never {
  const message = `${provider} embedding request failed (${status}): ${body}`;

  if (status === 401 || status === 403) {
    throw new InvalidApiKeyError(message);
  }

  if (status === 429) {
    throw new RateLimitedError(message);
  }

  throw new Error(message);
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";

  async embed(text: string, apiKey?: string): Promise<EmbeddingResult> {
    if (!apiKey) {
      throw new Error("No API key provided");
    }

    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });

    if (!res.ok) {
      throwTyped(res.status, await res.text().catch(() => ""), this.name);
    }

    const data = (await res.json()) as EmbedContentResponse;
    const values = data.embedding?.values ?? [];

    return {
      provider: this.name,
      embedding: values,
      dimensions: values.length,
      // Gemini's embedContent response doesn't report token usage.
      tokens: 0,
    };
  }

  async embedMany(texts: string[], apiKey?: string): Promise<EmbeddingResult[]> {
    if (!apiKey) {
      throw new Error("No API key provided");
    }

    const res = await fetch(`${BATCH_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (!res.ok) {
      throwTyped(res.status, await res.text().catch(() => ""), this.name);
    }

    const data = (await res.json()) as BatchEmbedContentsResponse;

    return (data.embeddings ?? []).map((e) => ({
      provider: this.name,
      embedding: e.values,
      dimensions: e.values.length,
      tokens: 0,
    }));
  }

  async health(): Promise<boolean> {
    return true;
  }
}
