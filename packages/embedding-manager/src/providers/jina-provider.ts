import type {
  EmbeddingProvider,
  EmbeddingResult,
} from "../types";
import { retryOn429 } from "../retry";

interface JinaEmbeddingItem {
  embedding: number[];
}

interface JinaEmbeddingResponse {
  data: JinaEmbeddingItem[];
  usage?: { total_tokens?: number };
}

export class JinaProvider implements EmbeddingProvider {
  readonly name = "jina";

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey =
      apiKey ??
      process.env.JINA_API_KEY ??
      "";

    if (!this.apiKey) {
      throw new Error("JINA_API_KEY is missing.");
    }
  }

  private async callApi(input: string[]): Promise<JinaEmbeddingResponse> {
    return retryOn429(async () => {
      const response = await fetch(
        "https://api.jina.ai/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "jina-embeddings-v3",
            input,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Jina API Error: ${response.status} ${response.statusText}`
        );
      }

      return response.json() as Promise<JinaEmbeddingResponse>;
    });
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const json = await this.callApi([text]);

    if (!json.data || json.data.length === 0) {
      throw new Error("Jina returned no embeddings.");
    }

    const item = json.data[0];

    if (!item) {
      throw new Error("Embedding result is undefined.");
    }

    return {
      provider: this.name,
      embedding: item.embedding,
      dimensions: item.embedding.length,
      tokens: json.usage?.total_tokens ?? 0,
    };
  }

  async embedMany(
    texts: string[]
  ): Promise<EmbeddingResult[]> {
    const json = await this.callApi(texts);

    if (!json.data || json.data.length === 0) {
      throw new Error("Jina returned no embeddings.");
    }

    const tokensPerItem = Math.round(
      (json.usage?.total_tokens ?? 0) / json.data.length
    );

    return json.data.map((item) => ({
      provider: this.name,
      embedding: item.embedding,
      dimensions: item.embedding.length,
      tokens: tokensPerItem,
    }));
  }
}
