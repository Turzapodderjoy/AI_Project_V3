import { NextRequest, NextResponse } from "next/server";

import { getApp } from "../../../../lib/app";

/**
 * Not actually driven by Vercel's own cron scheduler (see vercel.json's
 * comment on this entry) — Vercel's free/Hobby plan only fires cron jobs
 * once a day regardless of the schedule expression, and this needs to run
 * every 30 minutes AND work identically for an offline/local deployment
 * (which has no Vercel cron at all). The real 30-minute cadence comes from
 * an external trigger (a free GitHub Actions scheduled workflow, a service
 * like cron-job.org, or a local Task Scheduler entry for the offline case)
 * hitting this route with the CRON_SECRET bearer header. This route is
 * registered in vercel.json anyway so it's a normal discoverable endpoint
 * either way.
 *
 * Unlike the other 3 cron routes (crawl/backfill-embeddings/training-
 * pipeline), this one wraps the call in try/catch — AutoHealService.run()
 * already catches internally to write a terminal status to AutoHealRun,
 * but this is a second, thinner safety net for anything that escapes even
 * that (e.g. getApp() itself failing before run() is ever reached).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const app = await getApp();
    const result = await app.container.router.autoHeal.run("cron");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
