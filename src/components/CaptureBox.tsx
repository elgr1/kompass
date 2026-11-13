"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { captureAction } from "@/app/actions";
import { parseCapture, type CaptureCourse } from "@/lib/capture/parse";

type Labels = { placeholder: string; add: string; hint: string; noDate: string; inbox: string };

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface disabled:opacity-40">
      {label}
    </button>
  );
}

/** One-line task entry with a live preview of what was understood. Parsing runs locally in the browser. */
export function CaptureBox({ courses, labels, locale, autoFocus = false }: { courses: CaptureCourse[]; labels: Labels; locale: string; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseCapture(text, { now: new Date(), courses }) : null), [text, courses]);
  const course = parsed?.courseId ? courses.find((c) => c.id === parsed.courseId) : null;
  const dateLabel = parsed?.date
    ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${parsed.date}T12:00:00Z`)) + (parsed.time ? ` ${parsed.time}` : "")
    : null;
  const chip = "rounded-full px-2 py-0.5 text-xs font-medium";

  return (
    <form ref={form} action={async (fd) => { await captureAction(fd); setText(""); }} className="rounded-xl border border-border bg-surface p-3">
      <div className="flex gap-2">
        <input name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={labels.placeholder} autoFocus={autoFocus} autoComplete="off" enterKeyHint="done"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-base outline-none focus:border-accent md:text-sm" />
        <Submit label={labels.add} disabled={!parsed?.title} />
      </div>
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-muted">
        {parsed?.title ? (
          <>
            <span className="font-medium text-text">{parsed.title}</span>
            <span className={`${chip} ${dateLabel ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>{dateLabel ?? labels.noDate}</span>
            {course && <span className={`${chip} bg-ok-soft text-ok`}>{course.shortName}</span>}
            {parsed.tags.map((t) => <span key={t} className={`${chip} bg-surface-2`}>#{t}</span>)}
            {!dateLabel && !course && <span>· {labels.inbox}</span>}
          </>
        ) : (
          <span>{labels.hint}</span>
        )}
      </div>
    </form>
  );
}
