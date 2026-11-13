"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; badgeTone?: "action" | "muted" };

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "side" | "bottom" }) {
  const path = usePathname();
  return (
    <>
      {items.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const badge = it.badge ? (
          <span className={`tnum rounded-full px-1.5 text-[11px] font-semibold leading-5 ${it.badgeTone === "action" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"}`}>
            {it.badge}
          </span>
        ) : null;
        return variant === "side" ? (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
            {it.label}
            {badge}
          </Link>
        ) : (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-3 text-[13px] font-medium ${active ? "text-accent" : "text-muted"}`}>
            {it.label}
            {badge}
          </Link>
        );
      })}
    </>
  );
}
