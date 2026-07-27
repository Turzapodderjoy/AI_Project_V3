import { NextRequest, NextResponse } from "next/server";

import { getApp } from "../../../../lib/app";

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get("businessId") ?? undefined;
  const app = await getApp();
  return NextResponse.json({
    targets: await app.container.router.crawler.list(businessId),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.businessId !== "string" || typeof body.url !== "string") {
    return NextResponse.json({ error: "businessId and url are required" }, { status: 400 });
  }

  try {
    const app = await getApp();
    const target = await app.container.router.crawler.add(body.businessId, body.url);
    return NextResponse.json(target);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
