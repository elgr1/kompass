import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, opened } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Opens a mirrored item at its source and remembers that I opened it (for the unread-material list). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await ctx.params).id);
  const db = getDb();
  const item = db.select({ id: items.id, htmlUrl: items.htmlUrl }).from(items).where(eq(items.id, id)).get();
  // Only ever redirect to the link stored for a mirrored item, never to a URL from the request.
  if (!item?.htmlUrl || !/^https:\/\//.test(item.htmlUrl)) return new Response("Not found", { status: 404 });
  const now = new Date();
  db.insert(opened).values({ itemId: item.id, openedAt: now }).onConflictDoUpdate({ target: opened.itemId, set: { openedAt: now } }).run();
  return Response.redirect(item.htmlUrl, 302);
}
