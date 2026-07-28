import { NextResponse } from "next/server";

import { getApp } from "../../../../../lib/app";

export async function GET() {
  const app = await getApp();

  return NextResponse.json({
    pending: await app.container.router.training.pendingSuggestions(),
    decided: await app.container.router.training.decidedSuggestions(),
  });
}
