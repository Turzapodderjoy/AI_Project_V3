import { NextResponse } from "next/server";

import { getApp } from "../../../../lib/app";

export async function GET() {
  const app = await getApp();
  const documents = await app.container.router.admin.knowledge();
  return NextResponse.json({ documents });
}
