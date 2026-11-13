import { eq } from "drizzle-orm";
import Link from "next/link";
import { createProjectAction } from "../actions";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { projectTime } from "@/lib/projects/store";

export const dynamic = "force-dynamic";
const ORDER = { active: 0, paused: 1, idea: 2, done: 3 } as const;

export default async function ProjectsPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const h = (min: number) => new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { maximumFractionDigits: 1 }).format(min / 60);
  const list = db.select().from(projects).all().sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.title.localeCompare(b.title, "sv"));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "proj.title")}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "proj.subtitle")}</p>
      </div>
      <Card>
        {list.length === 0 && <Empty>{t(lang, "proj.none")}</Empty>}
        <ul className="divide-y divide-border">
          {list.map((p) => {
            const time = projectTime(db, p.id, now);
            const ts = db.select({ status: tasks.status }).from(tasks).where(eq(tasks.projectId, p.id)).all();
            const pct = p.weeklyBudgetMin ? Math.min(100, (time.thisWeek / p.weeklyBudgetMin) * 100) : 0;
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2 ${p.status === "done" ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="font-semibold">{p.title}</div>
                    <div className="text-xs text-muted">{t(lang, `proj.st.${p.status}`)} · {t(lang, "proj.tasks", { open: ts.filter((x) => x.status !== "done").length, done: ts.filter((x) => x.status === "done").length })}</div>
                  </div>
                  {p.weeklyBudgetMin > 0 && (
                    <div className="w-44 text-xs text-muted">
                      <div className="mb-1 flex justify-between"><span>{t(lang, "proj.week")}</span><span className="tnum">{t(lang, "proj.ofBudget", { h: h(time.thisWeek), b: h(p.weeklyBudgetMin) })}</span></div>
                      <div className="h-1.5 rounded bg-surface-2"><div className="h-1.5 rounded bg-accent" style={{ width: `${pct}%` }} /></div>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <form action={createProjectAction} className="flex gap-2 border-t border-border p-3">
          <input name="title" required placeholder={t(lang, "proj.new")} autoComplete="off" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm" />
          <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface">{t(lang, "notes.create")}</button>
        </form>
      </Card>
    </div>
  );
}
