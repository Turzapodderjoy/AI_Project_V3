import { NextRequest, NextResponse } from "next/server";

import { getApp } from "../../../../lib/app";

export async function GET() {
  const app = await getApp();
  return NextResponse.json(await app.container.router.aiConfig.current());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (
    !body ||
    typeof body.systemPrompt !== "string" ||
    typeof body.handoffFloor !== "number" ||
    typeof body.historyTurns !== "number"
  ) {
    return NextResponse.json(
      { error: "systemPrompt, handoffFloor, and historyTurns are required" },
      { status: 400 }
    );
  }

  try {
    const app = await getApp();
    const result = await app.container.router.aiConfig.update(
      body.systemPrompt,
      body.handoffFloor,
      body.historyTurns,
      typeof body.note === "string" ? body.note : undefined
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
