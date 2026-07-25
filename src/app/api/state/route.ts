import { NextResponse } from "next/server";
import { hasStore, readDoc, writeDoc } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-device sync: one JSON doc holding the browser-state keys (price
// board, tickets, QB overrides, adjustments, saved searches). Single user
// behind Vercel deployment protection; last-write-wins.

export interface StateDoc {
  kv: Record<string, unknown>;
  updatedAt: number;
}

export async function GET() {
  if (!hasStore()) return NextResponse.json({ kv: {}, updatedAt: 0, storeMissing: true });
  const doc = await readDoc<StateDoc>("state", { kv: {}, updatedAt: 0 });
  return NextResponse.json(doc);
}

export async function PUT(req: Request) {
  try {
    if (!hasStore()) return NextResponse.json({ error: "storage not configured" }, { status: 503 });
    const body = (await req.json()) as StateDoc;
    if (!body || typeof body.kv !== "object") {
      return NextResponse.json({ error: "bad state" }, { status: 400 });
    }
    const doc: StateDoc = { kv: body.kv, updatedAt: Date.now() };
    await writeDoc("state", doc);
    return NextResponse.json({ ok: true, updatedAt: doc.updatedAt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "state save failed" },
      { status: 500 },
    );
  }
}
