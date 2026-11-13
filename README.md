# Kompass

A local-first study planner that mirrors a Canvas LMS and a TimeEdit schedule, notices what changes, and turns it into a plan for the week.

It was built for one student at Uppsala University, whose Canvas instance is called Studium. It runs on your own computer; your access token and course data stay there.

## What it does

- **Mirror and change radar.** Syncs assignments, announcements, modules, pages, files, bookable slots and teacher comments every 20 minutes, read-only. Anything that changes shows up as a before → after entry: a moved deadline, a replaced file, a new comment.
- **Hidden-deadline detector.** Scans announcements, pages and PDFs for sentences that pair a date with an obligation ("anmäl dig senast fredag", "sign up by 20 November"), in Swedish and English. Finds are suggestions; nothing becomes a task until you approve it.
- **Today, Week and Semester views** that merge the TimeEdit schedule, Canvas deadlines, your own tasks and planned study blocks.
- **Planning.** Effort estimates that learn from logged time, proposed study blocks in the gaps around classes, exam plans counted backwards from the exam date, and an eight-week workload view that warns about heavy weeks.
- **Notes.** Markdown pages with LaTeX, checklists and links between pages; databases with table, board, calendar, timeline and gallery views; full-text search across notes, tasks and everything mirrored.
- **Career and degree.** An application pipeline, contacts, a thesis timeline, projects with time budgets, credit tracking with paste-import of results, and an exam register with registration reminders.
- **Housekeeping.** Local notifications, a private calendar feed, nightly database backups and Markdown/JSON export.

The interface is in Swedish and English.

## Try it without an account

Demo mode uses made-up courses and its own database, so it needs no token:

```bash
npm ci
```

```bash
npm run demo
```

Then open http://127.0.0.1:3211.

## Run it on your own data

Requires Node.js 23.6 or later. Developed and used on macOS.

1. Install the packages:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

3. Fill in `.env`:
   - `CANVAS_TOKEN`: created in Canvas under Account → Settings → Approved integrations → New access token.
   - `CANVAS_BASE_URL`: your institution's Canvas address.
   - `TIMEEDIT_ICS_URLS`: the subscription link from your TimeEdit schedule (optional).

4. Check that the token works:

   ```bash
   npm run verify:canvas
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

   Then open http://127.0.0.1:3210. The first sync is a silent baseline; changes after that appear on the Radar.

### Using it somewhere other than Uppsala

Two places assume Uppsala and need editing for another institution:

- `CANVAS_HOSTS` in `src/lib/canvas/client.ts` lists the only host the token may be sent to.
- The TimeEdit parser in `src/lib/providers/ics.ts` expects Uppsala's event format and only accepts feeds from `cloud.timeedit.net`.

## Privacy and safety

- **Read-only.** The Canvas client can only make GET requests.
- **The token goes to one host.** Every request, including paginated ones, is checked against an allowlist, and redirects are never followed with the token attached.
- **Local only.** The server listens on `127.0.0.1` and has no login, so do not expose it to a network as it is.
- **No telemetry.** Next.js telemetry is switched off in every script.
- **Nothing private is tracked by git.** `.env` and the whole `data/` folder (database, backups, exports) are ignored.
- **Optional AI reading is off by default.** If you enable it, nothing is sent until you tick texts on a page that shows exactly what would be sent.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app on port 3210 with your data |
| `npm run demo` | Reseed and start the demo on port 3211 |
| `npm run sync` | Run one sync from the terminal |
| `npm run detect` | Re-run the deadline detector on mirrored content |
| `npm run pdf` | Read all not-yet-read PDFs in one go |
| `npm run verify:canvas` | Check the token against the Canvas API |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check the project |
| `npm run build` / `npm start` | Production build and server |

## Status and limitations

This is a personal tool, built quickly and used by one person. Known gaps:

- Pages are edited as Markdown with a live preview, not as drag-and-drop blocks.
- Study blocks are moved with a form, not by dragging in the week view.
- No login and no remote or phone access.
- No offline mode.
- Email is not available as a notification channel (macOS notifications, ntfy and Telegram are).
- The optional AI extraction has only been tested against a simulated API.
- Scanned or image-only PDFs yield no text.

## Built with

TypeScript, Next.js, SQLite (better-sqlite3 with Drizzle), Tailwind CSS, markdown-it and KaTeX, and Vitest.

`CLAUDE.md` documents the architecture and conventions in detail. `docs/brief.md` is the original brief the project was built from.
