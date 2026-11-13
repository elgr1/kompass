"use client";

import { useTransition } from "react";
import { toggleDocTaskAction } from "@/app/actions";

/** A rendered page. Ticking a checklist item writes the change back to the Markdown source. */
export function RenderedDoc({ id, html }: { id: number; html: string }) {
  const [, start] = useTransition();
  return (
    <div
      className="prose"
      // The checkboxes come from rendered HTML, not from React, so React never sends a change
      // event for them. A click on one does bubble up to here.
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLInputElement && el.dataset.task !== undefined) start(() => toggleDocTaskAction(id, Number(el.dataset.task)));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
