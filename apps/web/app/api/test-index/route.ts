import { NextResponse } from "next/server";

import { IndexingService } from "@ai-chat-platform/indexing";
import { EmbeddingManager, JinaProvider } from "@ai-chat-platform/embedding-manager";

export async function GET() {
  try {
    const embeddings = new EmbeddingManager();
    embeddings.registerProvider(new JinaProvider(), [
      { id: "jina-test", value: process.env.JINA_API_KEY ?? "" },
    ]);

    const indexing = new IndexingService(embeddings);

    await indexing.initialize();

    const result = await indexing.index({
      filename: "sample.txt",
      text: `
Office Hours

Sunday - Thursday

9 AM - 6 PM

Refund Policy

7 Days Refund

Phone

01711111111
      `,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}