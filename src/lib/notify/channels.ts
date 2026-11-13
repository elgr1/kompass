import { execFile } from "node:child_process";

/**
 * Where notifications go. Pluggable: set NOTIFY_CHANNELS in .env (comma separated).
 *   mac       macOS notification on this computer. No account, nothing leaves the machine. Default on macOS.
 *   ntfy      push to a phone via an ntfy topic (NTFY_URL=https://ntfy.sh/<your-secret-topic>)
 *   telegram  a Telegram bot (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
 * ntfy and telegram send the notification text (task titles, course names) to that service,
 * which is why they are never enabled by default.
 */
export type Outgoing = { title: string; body: string; url?: string | null };
export interface NotifyChannel {
  readonly id: string;
  send(n: Outgoing): Promise<void>;
}

const appleString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " · ")}"`;

export class MacChannel implements NotifyChannel {
  readonly id = "mac";
  send(n: Outgoing): Promise<void> {
    const script = `display notification ${appleString(n.body.slice(0, 400))} with title "Kompass" subtitle ${appleString(n.title.slice(0, 120))}`;
    return new Promise((resolve, reject) => {
      execFile("/usr/bin/osascript", ["-e", script], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()));
    });
  }
}

export class NtfyChannel implements NotifyChannel {
  readonly id = "ntfy";
  private readonly url: URL;
  constructor(url: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.url = new URL(url);
    if (this.url.protocol !== "https:") throw new Error("NTFY_URL must be https");
  }
  async send(n: Outgoing): Promise<void> {
    const topic = this.url.pathname.replace(/^\/+|\/+$/g, "");
    const res = await this.fetchImpl(this.url.origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, title: n.title, message: n.body, ...(n.url ? { click: n.url } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
  }
}

export class TelegramChannel implements NotifyChannel {
  readonly id = "telegram";
  constructor(private readonly token: string, private readonly chatId: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(n: Outgoing): Promise<void> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: `${n.title}\n${n.body}${n.url ? `\n${n.url}` : ""}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Telegram answered HTTP ${res.status}`);
  }
}

export function getChannels(): NotifyChannel[] {
  const wanted = (process.env.NOTIFY_CHANNELS ?? (process.platform === "darwin" ? "mac" : "")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: NotifyChannel[] = [];
  for (const id of wanted) {
    try {
      if (id === "mac" && process.platform === "darwin") out.push(new MacChannel());
      else if (id === "ntfy" && process.env.NTFY_URL) out.push(new NtfyChannel(process.env.NTFY_URL));
      else if (id === "telegram" && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) out.push(new TelegramChannel(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID));
    } catch (err) {
      console.error(`[kompass] notification channel "${id}" is misconfigured:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
