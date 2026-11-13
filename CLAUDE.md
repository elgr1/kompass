# Kompass

Local-first, single-user study & life command center for a Teknisk fysik student at Uppsala University. Two halves: **Sync** (mirror Studium/Canvas + TimeEdit, detect changes) and **Plan** (turn that into a realistic week). The full product brief is `docs/brief.md`.

## Status

- **Phase 0 (done):** scaffold, API verification.
- **Phase 1 (done):** sync engine with snapshots + diffs, Radar, Today / Week / Sync pages, demo data.
- **Phase 2 (done):** tasks + inbox, quick capture (page, box and ⌘K), rule-based hidden-deadline detector with suggestions, paste-text import, notifications (reminders + digests), private ICS feed, hide courses, course nicknames, pages/files via modules.
- **Not done from Phase 2's wish list:** reading PDFs (kurs-PM, lab instructions). Files are mirrored as metadata only; text can be pasted on the Found page. Email as a notification channel is not implemented (mac, ntfy, telegram are).
- **Phase 3 (done):** effort estimates with learned multipliers, auto time-blocking (proposals to accept/move/remove), exam backwards-planning, 8-week workload heatmap with crunch warning, focus timer + time log, "What should I do now?".
- **Not done from Phase 3's wish list:** dragging blocks in the week grid (there is a "Move" date/time form instead); recurring busy time (work shifts are entered one by one as busy blocks).
- **Phase 4 (done):** pages written in Markdown (checklists, callouts, KaTeX maths, code, tables, embeds, Studium item cards, `[[links]]` + backlinks, sub-pages), databases with custom properties and five views (table, board with drag-and-drop, calendar, timeline, gallery) plus filters/sort/grouping, six page templates and five database templates, full-text search (FTS5) over pages, tasks and mirrored content, live search in ⌘K.
- **Deviations in Phase 4, on purpose:** pages are edited as Markdown source with a live rendered preview, not as drag-and-drop WYSIWYG blocks (no editor framework, plain-text storage, trivially exportable). shadcn/ui is still not used. The "guided weekly review" from the brief is the Weekly review page template (a checklist linking to each step), not a wizard. PDF contents are still not indexed.
- **Phase 5 (done):** application pipeline (board + detail page, linked notes page), contacts with nudges, fairs/application windows, configurable exjobb timeline, projects (goal, milestones, task board, time log, weekly budget that counts in the workload view), degree tracker (Ladok paste import, manual entry, categories, terms, prerequisites, 300 hp target), exam register with registration reminders, course pages (teachers, submissions, lab series, modules, announcements, feedback).
- **Deviations in Phase 5:** career, projects and degree use their own tables and pages, not the generic Phase 4 databases (they need dates that feed reminders and load, which JSON properties make awkward). The exjobb steps and the "12 days before" exam-registration suggestion are generic defaults for the user to correct, not verified UU rules. Contact nudges are shown on the Career page only (no notification yet). Course pages have no "acknowledged" state for feedback.
- **Phase 6 (done):** PDF text extraction feeding the detector and search; optional Claude extraction behind an explicit preview/consent page; nightly SQLite backup + Markdown/JSON export; Statistics page (hours per week, estimate accuracy, weekly-review streak, course health, period retrospective); Semester timeline; feedback inbox with "seen"; opened-material tracking; PNG app icons and install metadata; phone-width pass over every page.
- **Not built from the brief:** drag-and-drop WYSIWYG block editor (pages are Markdown); dragging blocks in the week grid; lab-partner/group member lists; email as a notification channel; a service worker (no offline mode, on purpose: private data should not sit in a browser cache); login/remote access (the app is localhost-only). The Claude extraction has only been tested against a simulated API, never with a real key.

## Running

```bash
npm run dev            # real data, http://127.0.0.1:3210 (syncs on start, then every 20 min)
npm run demo           # reseeds data/demo.sqlite and serves fake courses on :3211, no token needed
npm run sync           # one sync from the terminal
npm run detect         # re-run the hidden-deadline detector on mirrored content (no network)
npm run pdf            # read every not-yet-read PDF from Studium in one go (a sync does 20 at a time)
npm test               # vitest
npm run typecheck
npm run verify:canvas  # read-only check of the Canvas endpoints + rate-limit headers
npm run token:paste    # clipboard -> .env CANVAS_TOKEN (macOS), then verify
npm run db:generate    # after editing src/lib/db/schema.ts: writes a migration into drizzle/
```

Requires Node >= 23.6. Migrations in `drizzle/` are applied automatically when the DB is opened.

## Verified facts

- Studium's Canvas host is `https://uppsala.instructure.com` (the host UU's own login page links to). **`uu.instructure.com` is a different institution's Canvas; never send the token there.** `studium.uu.se` only redirects to a login landing page.
- Personal access tokens work for students (verified 2026-11-12). Rate-limit bucket is 700; a full sync of 9 courses is ~70 requests and costs well under 1 unit each.
- In most of this user's courses the **Files, Pages and (classic) Quizzes tabs are disabled**, so those list endpoints answer 403/404. That is recorded as scope status `unavailable`, not an error. Their pages and files are read through **modules** instead (see below).
- The Canvas calendar holds no schedule for this user; the timetable comes from TimeEdit (`TIMEEDIT_ICS_URLS`).
- UU's TimeEdit feed has **no course codes**. The summary is `<student groups>, <Swedish course name>.  , <Activity>` (e.g. `F3.A, F3.B1-2, Reglerteknik I.  , Laboration`), and locations are prefixed `Plats: `. Public holidays arrive as all-day events without a course.
- Some Studium courses have English names, so name matching fails for them. Unmatched names become schedule-only courses (`timeedit:<slug>`) that the user links once on the Sync page; the link is stored in `course_aliases`.
- The user keeps active enrollments in courses that are finished but not yet reported; "active in Canvas" does not mean "currently studying". They can be hidden under Settings.
- Ladok has no student API (manual / CSV paste, Phase 5).

## Development gotcha

The sync code is loaded once by `src/instrumentation.ts`, so a running `npm run dev` keeps syncing with the **old** provider/engine code after you edit it (hot reload does not reach it). Editing a normalizer while the server runs makes old and new code overwrite each other's results and floods the Radar with fake changes. **Stop the dev server before changing anything under `src/lib/providers` or `src/lib/sync`, and restart it afterwards.**

## Non-negotiables

1. The Studium token and mirrored data never leave this machine. The only exception is the optional LLM extraction pass (Phase 6), off by default, which must show exactly what text is sent.
2. Read-only toward Canvas. `CanvasClient` only implements GET. Writes (planner notes, mark done) may only be added behind an explicit user action.
3. Every Studium-derived item stores and shows a link back to its source (`items.html_url`, `changes.html_url`).
4. Extracted/suggested deadlines are suggestions until the user confirms them. Nothing is auto-added.
5. If a sync fails, last-good data stays in place and the layout shows a "stale since…" banner.

## Secrets and network

- Token lives in `.env` (gitignored). Never log it, never put it in a URL, never store it unencrypted in the DB.
- `CanvasClient` checks every URL (including pagination `next` links) against `CANVAS_HOSTS` and never follows redirects. ICS providers have their own host allowlists; subscription URLs are credentials too.
- The server binds to `127.0.0.1` only: there is **no login yet**, so it must not be exposed on the LAN. Phone/PWA access needs an auth decision first (open question for the user).
- Next.js telemetry is disabled in every npm script (`NEXT_TELEMETRY_DISABLED=1`).

## Architecture

```
src/lib/
  time.ts              Europe/Stockholm helpers. Instants are UTC; days are "date keys" (YYYY-MM-DD).
  text.ts              htmlToText, stableStringify
  ics.ts               minimal VEVENT parser (no RRULE)
  i18n.ts              sv/en dictionary; no hard-coded UI strings in components
  canvas/client.ts     read-only client: pagination, throttling, retries, host allowlist
  providers/types.ts   SyncProvider interface: fetch() -> { courses?, scopes[] }
  providers/canvas-api.ts, ics.ts (TimeEdit + Canvas feed fallback), demo.ts
  sync/diff.ts         pure: normalize, comparable, hash, diffScope
  sync/engine.ts       runSync(): transaction, snapshots, Radar rows, provider status
  sync/run.ts          provider registry from env, syncAll(), in-process scheduler
  radar/triage.ts      pure: action vs fyi
  radar/describe.ts    pure: change -> bilingual headline + diff lines
  detect/dates.ts      pure sv/en date finder (also runs in the browser for the capture preview)
  detect/extract.ts    pure: sentence + date + action word -> candidate
  detect/run.ts        scans mirrored items -> `suggestions` (never tasks); importText for pasted text
  capture/parse.ts     pure: one typed line -> title, date, time, course, tags
  tasks.ts             task storage; captureTask
  notify/plan.ts       pure: which reminders/digests are due
  notify/channels.ts   mac | ntfy | telegram (NOTIFY_CHANNELS)
  notify/run.ts        notifyTick(), every 5 min from the scheduler
  plan/estimate.ts     pure: work types, default minutes, learned multipliers
  plan/schedule.ts     pure: free slots, earliest-deadline-first block proposals, exam session placement
  plan/workload.ts     pure: spread remaining effort per day, week loads, crunch rule
  plan/exam.ts         pure: backwards plan (review -> old exams + spaced repeats -> buffer days)
  plan/next.ts         pure: scoring for "What should I do now?"
  plan/store.ts        DB side: collectWork, getBusy, generateProposals, getWeekLoads, createExamPlan
  notes/markdown.ts    renderMarkdown (markdown-it + KaTeX), wikiLinks, toggleTask, excerpt. Raw HTML is never rendered.
  notes/dbview.ts      pure: filter, sort, group database rows; coerce submitted values
  notes/templates.ts   page and database templates (sv/en)
  notes/store.ts       docs CRUD, link resolution + backlinks, render context, databases
  search.ts            FTS5 index (rebuilt when dirty) + query
  career/logic.ts      pure: contactsDue, default exjobb steps, exjobbDates
  career/store.ts      syncLinkedTask, syncApplication, careerAgenda, getExjobb/saveExjobb
  projects/store.ts    projectTime, projectLoadByDay (budget -> workload)
  degree/ladok.ts      pure: tolerant parser for pasted Ladok results
  degree/summary.ts    pure: credit sums (in tenths of hp), term order, missing prerequisites
  courses/labs.ts      pure: lab-series rows from assignment titles
  files/pdf.ts         download + text extraction of mirrored PDFs (text only is stored, in `file_texts`)
  llm/extract.ts       optional Claude extraction: prompt, request, validation of answers
  llm/run.ts           which texts are offered for sending; storing results as suggestions
  stats/logic.ts       pure: weekly time, estimate accuracy, review streak, course health
  stats/store.ts       DB side of analytics, feedback inbox, period retrospective
  backup.ts            SQLite backup (manual + nightly, keep 14) and Markdown/JSON export
  ics-export.ts        pure iCalendar writer for /api/calendar/<token>.ics
  settings.ts          key/value settings, feed token
  queries.ts           read models for the pages
  db/schema.ts         Drizzle schema (SQLite, better-sqlite3)
src/app/               Next.js App Router: / (Today), /week, /plan (tabs: now, load, exams, time), /semester, /stats, /tasks, /courses, /courses/[id], /projects, /projects/[id], /career (tabs: pipeline, contacts, events, exjobb), /career/[id], /degree (tabs: progress, exams), /notes, /notes/[id] (?edit=1), /notes/new, /db/[id] (?view=), /search, /capture, /radar, /found, /found/ai (consent page), /go/[id] (open at source + mark opened), /icons/[size], /sync, /settings; actions.ts
src/instrumentation.ts starts the scheduler inside the Next server process
```

### Sync model

- A provider returns **scopes** (e.g. `course:123:assignments`), each `ok | unavailable | error` with its items. A failed scope is skipped entirely, so its items are neither updated nor removed; the run is `partial`.
- `items` holds the latest state; `snapshots` is append-only history written whenever the content hash changes; `changes` is the Radar.
- The hash is computed over the **comparable** record (title, dates, location, body text, selected `fields`), never the raw payload, so volatile API fields do not create noise. When adding a field to a normalizer, expect one "updated" Radar entry per item on the next sync.
- The **first successful fetch of a scope is a silent baseline** (no Radar entries).
- `trackRemovals`: `all` (lists), `future` (rolling calendar feeds: only future items can be "removed"), `none` (windowed endpoints such as announcements and planner).
- `radar: false` scopes (planner items) are stored but never emit Radar rows, since they duplicate other items.
- Item ids are `${provider}:${kind}:${externalId}`; course ids `${provider}:${externalId}`. TimeEdit events are matched to Studium courses by course code if present, then by user alias (`course_aliases`), then by exact normalized name. The course link is not part of the content hash, so re-linking never creates Radar entries.
- Demo mode (`KOMPASS_DEMO=1`) uses its own DB file, `data/demo.sqlite`, so fake and real data never mix.

### Tasks, detector, notifications

- A detected date only ever becomes a row in `suggestions`. The single path to a task is `acceptSuggestionAction` (a click). Suggestions are keyed on source + date + kind, so a dismissed one never returns, while a date that changes in the text yields a new one.
- Detector rule: a sentence needs **both** a date and an action word (sign up, book, hand in, exam...). Relative mentions ("on Friday", "tomorrow") are only trusted for items with a real `posted_at`; pages and syllabi have none. An item's own due date is not a hidden deadline.
- Date-only deadlines are stored at 23:59 Stockholm with `hasTime = false`.
- Tasks without date and course are `inbox`; otherwise `todo`. `getDeadlines` merges Studium deadlines and tasks (`origin`).
- Reminders: sign-up/booking/exam kinds at 3 d, 1 d, 3 h (date-only: 08:00 that morning instead of 3 h); everything else 1 d before. Only the most urgent reached stage is sent after downtime. Keys include the due time, so a moved deadline reminds again. Digest 06:30–11:00; weekly preview Sunday 16–22. Nothing is sent in demo mode.
- Notifications use the language stored in `settings.lang` (written when the UI language is toggled).
- Hidden courses (`courses.hidden`) are still synced but filtered out in `queries.ts`, the detector and the pickers.
- Courses whose Pages/Files tabs are off get `module_pages` (one request per page, per sync) and `module_files` (from `content_details`, no extra requests) scopes instead. A full sync is now ~155 requests.

### Planning

- Everything plannable has a **work key**: `task:<id>` or the mirrored item id. `work_meta`, `blocks.work_key` and `time_entries.work_key` all use it, so Studium deadlines and own tasks are planned identically.
- Estimate = own value from `work_meta`, else `DEFAULT_MIN[type]` x learned multiplier. Type is guessed from the title (`guessType`) unless set. Own estimates are never multiplied.
- Multipliers = median(actual / estimate) over finished work with >= 10 min logged; needs 2 samples per course+type, 3 per type; clamped to 0.5–3.
- Remaining = planned − logged. The heatmap spreads remaining minutes evenly over `LEAD_DAYS[type]` before each deadline; a week is a crunch when own work > 85% of free study time (and >= 2 h). Today warns about this week and the next two.
- Free study time = study window (Settings: default Mon–Fri 08–18, lunch 12–13, max 5 h/day, 90-min blocks, 15-min gaps) minus classes, calendar events, busy blocks.
- Auto-blocking is earliest-deadline-first over free slots, never after an item's deadline; leftovers are shown as "does not fit". Proposals (`status = proposed`) are replaced on each run; accepted blocks are never touched. Exam-plan sessions may use any weekday. Proposals of one kind count as busy for the other, so they cannot overlap.
- Blocks are suggestions until accepted: only accepted blocks reach the ICS feed and count as busy.
- One timer runs at a time; entries shorter than a minute are discarded. Exam prep only shows in the heatmap once an exam plan exists.

### Notes and databases

- A page is a row in `docs` with Markdown `content`. A database row is a page too (`database_id` set, values in `props` keyed by property id), so every row can hold notes.
- Rendering happens on the server only (`renderDoc`); the editor preview is the HTML returned by `saveDocAction`, so preview and saved page can never differ. Maths, `[[links]]` are swapped for placeholders before Markdown runs and restored after; code blocks are left alone.
- Checkboxes in rendered pages are not React nodes: ticking is handled by a click listener in `RenderedDoc` that calls `toggleTask(source, n)`. The n-th checkbox in the HTML is the n-th task line in the source outside code fences; keep those two counts in step.
- `[[Title]]` resolves case-insensitively by title (oldest page wins on duplicates). Links to missing pages go to `/notes/new?title=`; creating the page re-links the pages that mention it. `doc_links` is rebuilt on every save.
- Database schema lives in `databases.props` / `databases.views` (JSON). Deleting a property also removes it from every view. Select properties sort and group in option order.
- Search: `search_index` is an FTS5 virtual table created in code (not in the Drizzle migrations). `settings.search_dirty` is set by sync, task and page writes; the index is rebuilt on the next search. Hidden courses, planner items and groups are not indexed.
- Embeds load third-party content (YouTube via youtube-nocookie, remote images) only for URLs the user put on a line of their own.

### Career, projects, degree

- **Linked tasks are the integration point.** Anything with a date that lives outside `tasks` (application deadline, follow-up, exam registration, exjobb step) is mirrored by `syncLinkedTask` into one task whose `sourceUrl` points back into the app. That one task is what gives it Today/Week, reminders, the calendar feed and search; do not add special cases for these in `queries.ts` or `notify/`. Always go through the sync function after changing the owning row.
- Application status drives its tasks: reaching `applied` or later completes "Ansök"; `offer`/`rejected` completes "Följ upp"; moving back reopens them. `appliedAt` is set on first reaching a sent status and cleared when moved back.
- Exam registration deadlines become `signup` tasks, so they get the escalating 3 d / 1 d / same-morning reminders. Exams from TimeEdit get a row in `exams` only once the user saves something about them (`sourceItemId`).
- Tasks have `projectId` and a third open status, `doing` (project board column). Everything outside the project board treats `doing` as open.
- Project time = timers on `project:<id>` plus timers on the project's tasks. An active project's weekly budget is added to the workload view per study day (current week: minus what is already logged) under the key `project:<id>`.
- Credits are stored as tenths of hp (`degree_courses.hp`), so 7.5 hp sums exactly. A failing or missing grade keeps a course `ongoing`. Ladok import requires a course code AND credits per line; module rows have no code and are skipped. Import merges on course code.
- Career events are all-day entries merged into Today, Week and the feed via `careerAgenda`.
- Course teachers come from `include[]=teachers` on the courses call and are stored on `courses.teachers` (not part of any item hash).

### PDFs, AI extraction, backup

- PDFs: `CanvasClient.download` sends the token to Studium only; the redirect to file storage is followed **without** the Authorization header. Only extracted text is kept. A file is re-read when its size or modified date changes; failures (too large, no text layer) are recorded and not retried until then. `unpdf` takes ownership of the buffer it is given, so pass a copy.
- Detector lessons from real PDFs: "due to" is not a deadline; a fraction with a unit ("1/2s") or inside a grade scale ("fail/3/4/5") is not a date.
- Claude extraction (non-negotiable 1): enabled only when `LLM_EXTRACTION_ENABLED=true` AND `ANTHROPIC_API_KEY` are both set. Nothing is sent from the sync or any background job; the only caller is `runLlmAction`, reached from `/found/ai`, which lists the exact text per item. `buildPrompt` is the single source for both the preview and the request, and a test asserts they are identical. Answers whose quote is not literally in the source text are discarded. Texts over `LLM_MAX_CHARS` are not offered rather than truncated. Uses the official `@anthropic-ai/sdk` with structured output; model from `LLM_MODEL` (default `claude-opus-5-5`).
- Backups go to `data/backups/` (gitignored) once a night after 02:00 while the app runs; exports to `data/exports/<timestamp>/`. The export leaves out mirrored Studium content and the calendar feed token.
- Course health is a heuristic from visible signals only (missed hand-ins, unstarted work due within a week, unread action items, unacknowledged feedback). It is not a grade prediction.
- The semester view's period dates are approximations (`semesterOf` in `src/app/semester/page.tsx`).
- No service worker: installing as an app works through the manifest and icons, but there is deliberately no offline cache.

### Conventions and defaults chosen

- Next.js 16 App Router, server components + server actions; no client-side data fetching.
- Tailwind v4 with CSS-variable color tokens in `globals.css`; light/dark via `data-theme` (cookie) or the OS setting. Do not use `dark:` variants.
- shadcn/ui is not installed: all components are small and hand-written. Client components exist only where interaction needs them (editor, database cells, board, palette, timer, capture box).
- Language and theme are cookies (`kompass_lang`, `kompass_theme`). Default language: Swedish.
- Sync interval: 20 minutes (`SYNC_INTERVAL_MIN`).
- Timestamps in SQLite are integer epoch ms. Dates shown to the user always go through `time.ts`.
- Deadlines shown = assignments + quizzes without an assignment twin + planner-only items. A student's `due_at` already includes overrides that apply to them.
- Tests are required for sync/diff logic, time/DST handling and (Phase 2) date extraction. Tests use an in-memory SQLite DB and fake providers; they never touch the network.

## Phases

0. API verification, scaffold. 1. Sync engine, snapshots/diffs, Radar, Today/Week. 2. Tasks, quick capture, rule-based hidden-deadline detector, notifications, ICS export. 3. Estimates, time-blocking, exam backwards-planning, heatmap, time tracking. 4. Pages, databases, templates, search. 5. Career CRM, exjobb planner, projects, degree tracker. 6. PWA polish, optional LLM extraction, analytics, stretch goals.

After each phase: run tests, reseed demo data, summarize what works / what's next / decisions needed.
