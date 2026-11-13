import { ImageResponse } from "next/og";

/** PNG app icons for installing Kompass as an app (PWA): /icons/192, /icons/512, /icons/180. */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const size = Number((await ctx.params).size);
  if (![180, 192, 512].includes(size)) return new Response("Not found", { status: 404 });
  const s = size / 64;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1115" }}>
        <div style={{ width: 38 * s, height: 38 * s, borderRadius: 19 * s, border: `${3 * s}px solid #e8eaf0`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 13 * s, height: 13 * s, background: "#4f8cff", transform: "rotate(45deg)", borderRadius: 2 * s }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
