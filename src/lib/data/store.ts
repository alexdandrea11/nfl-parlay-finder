// JSON document store on Vercel Blob. Single-user app behind Vercel
// deployment protection, so no separate auth layer: anyone who can reach
// these APIs is the owner. Low write volume; last-write-wins is fine.

import { head, put } from "@vercel/blob";

const PREFIX = "parlayedge/";

export async function readDoc<T>(name: string, fallback: T): Promise<T> {
  try {
    const meta = await head(`${PREFIX}${name}.json`);
    // Cache-bust: blob overwrites can serve a stale CDN copy for a while
    // without this.
    const sep = meta.downloadUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${meta.downloadUrl}${sep}_cb=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback; // missing blob or no token (local without env)
  }
}

export async function writeDoc<T>(name: string, data: T): Promise<void> {
  await put(`${PREFIX}${name}.json`, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

export function hasStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
