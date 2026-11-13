import { CaptureBox } from "@/components/CaptureBox";
import { TaskRow } from "@/components/TaskRow";
import { Card, Empty } from "@/components/ui";
import { getDb } from "@/lib/db";
import type { Task } from "@/lib/db/schema";
import { t } from "@/lib/i18n";
import { getPrefs } from "@/lib/prefs";
import { getCourses } from "@/lib/queries";
import { captureCourses, getDoneTasks, getOpenTasks } from "@/lib/tasks";
import { addDays, dateKey, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { lang } = await getPrefs();
  const db = getDb();
  const now = new Date();
  const tomorrow = startOfDay(addDays(dateKey(now), 1));
  const courses = [...getCourses(db).values()].filter((c) => !c.id.startsWith("timeedit:")).sort((a, b) => a.shortName.localeCompare(b.shortName, "sv"));
  const open = getOpenTasks(db).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.id - b.id);
  const done = getDoneTasks(db);

  const groups: { key: string; title: string; hint?: string; list: Task[] }[] = [
    { key: "inbox", title: t(lang, "tasks.inbox"), hint: t(lang, "tasks.inboxHint"), list: open.filter((x) => x.status === "inbox") },
    { key: "overdue", title: t(lang, "tasks.overdue"), list: open.filter((x) => x.status !== "inbox" && x.dueAt && x.dueAt < now) },
    { key: "today", title: t(lang, "tasks.today"), list: open.filter((x) => x.status !== "inbox" && x.dueAt && x.dueAt >= now && x.dueAt < tomorrow) },
    { key: "upcoming", title: t(lang, "tasks.upcoming"), list: open.filter((x) => x.status !== "inbox" && x.dueAt && x.dueAt >= tomorrow) },
    { key: "someday", title: t(lang, "tasks.someday"), list: open.filter((x) => x.status !== "inbox" && !x.dueAt) },
    { key: "done", title: t(lang, "tasks.done"), list: done },
  ];
  const labels = { placeholder: t(lang, "capture.placeholder"), add: t(lang, "capture.add"), hint: t(lang, "capture.hint"), noDate: t(lang, "capture.noDate"), inbox: t(lang, "capture.inbox") };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t(lang, "tasks.title")}</h1>
        <p className="mt-0.5 text-sm text-muted">{t(lang, "tasks.subtitle")}</p>
      </div>
      <CaptureBox courses={captureCourses(db)} labels={labels} locale={lang === "sv" ? "sv-SE" : "en-GB"} />
      {open.length === 0 && done.length === 0 && <Card><Empty>{t(lang, "tasks.empty")}</Empty></Card>}
      {groups.filter((g) => g.list.length > 0).map((g) => (
        <Card key={g.key} title={`${g.title} (${g.list.length})`} hint={g.hint}>
          <ul className="divide-y divide-border">{g.list.map((task) => <TaskRow key={task.id} task={task} courses={courses} lang={lang} now={now} />)}</ul>
        </Card>
      ))}
    </div>
  );
}
