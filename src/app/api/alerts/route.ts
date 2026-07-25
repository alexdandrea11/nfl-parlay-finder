import { NextResponse } from "next/server";
import { readDoc } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Results of the daily cron's saved-search sweep.
export async function GET() {
  const doc = await readDoc<{ at: number; items: unknown[] }>("alerts", { at: 0, items: [] });
  return NextResponse.json(doc);
}
