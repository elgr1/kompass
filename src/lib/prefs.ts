import { cookies } from "next/headers";
import type { Lang } from "./time";

export type Theme = "light" | "dark" | "system";

export async function getPrefs(): Promise<{ lang: Lang; theme: Theme }> {
  const jar = await cookies();
  const lang = jar.get("kompass_lang")?.value === "en" ? "en" : "sv";
  const th = jar.get("kompass_theme")?.value;
  return { lang, theme: th === "light" || th === "dark" ? th : "system" };
}
