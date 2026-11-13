import Link from "next/link";
import { CaptureBox } from "@/components/CaptureBox";
import { getDb } from "@/lib/db";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { captureCourses, getOpenTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** A page that does one thing: type and go. Meant as the phone home-screen shortcut. */
export default async function CapturePage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const inbox = getOpenTasks(db).filter((x) => x.status === "inbox").length;
  const labels = { placeholder: t(lang, "capture.placeholder"), add: t(lang, "capture.add"), hint: t(lang, "capture.hint"), noDate: t(lang, "capture.noDate"), inbox: t(lang, "capture.inbox") };
  return (
    <div className="mx-auto max-w-xl space-y-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "capture.title")}</h1>
      <CaptureBox courses={captureCourses(db)} labels={labels} locale={lang === "sv" ? "sv-SE" : "en-GB"} autoFocus />
      <Link href="/tasks" className="inline-block text-sm font-medium text-accent hover:underline">{t(lang, "tasks.inbox")} ({inbox}) →</Link>
    </div>
  );
}
