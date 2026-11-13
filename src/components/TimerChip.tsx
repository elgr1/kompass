"use client";

import { useEffect, useState } from "react";
import { stopTimerAction } from "@/app/actions";

/** Running focus timer in the header. Counts up, or down to zero for a pomodoro. */
export function TimerChip({ startedAt, targetMin, title, stopLabel, doneLabel }: { startedAt: number; targetMin: number | null; title: string; stopLabel: string; doneLabel: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const target = targetMin ? targetMin * 60 : null;
  const over = target !== null && elapsed >= target;
  const shown = target !== null && !over ? target - elapsed : elapsed;
  const clock = `${Math.floor(shown / 3600) ? `${Math.floor(shown / 3600)}:` : ""}${String(Math.floor((shown % 3600) / 60)).padStart(shown >= 3600 ? 2 : 1, "0")}:${String(shown % 60).padStart(2, "0")}`;

  useEffect(() => {
    document.title = over ? `✓ ${doneLabel}` : `${clock} · Kompass`;
    return () => { document.title = "Kompass"; };
  }, [clock, over, doneLabel]);

  return (
    <form action={stopTimerAction} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-sm ${over ? "border-ok bg-ok-soft text-ok" : "border-accent bg-accent-soft text-accent"}`}>
      <span className="tnum font-semibold">{over ? `✓ ${clock}` : clock}</span>
      <span className="hidden max-w-40 truncate text-xs sm:inline">{over ? doneLabel : title}</span>
      <button className="rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-text">{stopLabel}</button>
    </form>
  );
}
