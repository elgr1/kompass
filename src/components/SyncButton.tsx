"use client";

import { useFormStatus } from "react-dom";
import { syncNowAction } from "@/app/actions";

function Inner({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-70">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={pending ? "spin" : ""} aria-hidden>
        <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />
      </svg>
      {pending ? busyLabel : label}
    </button>
  );
}

export function SyncButton(props: { label: string; busyLabel: string }) {
  return (
    <form action={syncNowAction}>
      <Inner {...props} />
    </form>
  );
}
