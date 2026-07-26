import { NextRequest, NextResponse } from "next/server";

import { getApp } from "../../../lib/app";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.message !== "string" || body.message.trim() === "") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "dev-session";

  try {
    const app = await getApp();
    const answer = await app.container.router.chat.post(sessionId, body.message);
    return NextResponse.json(answer);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Chat failed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
