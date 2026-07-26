import { NextResponse } from "next/server";
import { readDoc } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readDoc("digest", { at: 0, lines: [] }));
}
