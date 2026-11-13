# Build "Kompass": a local-first study & life command center synced with Studium (Canvas)

## Who I am and the problem

I'm a student in Teknisk fysik (civilingenjör, 300 hp) at Uppsala University. All courses run on **Studium**, UU's Canvas LMS instance at `https://uu.instructure.com` (also reachable via `studium.uu.se`; verify which base URL the API answers on). Course schedules (lectures, labs, exams) are in **TimeEdit** (`cloud.timeedit.net/uu`), and official results are in **Ladok**.

My problem: Canvas's to-do list and calendar don't give me a real overview. Deadlines are scattered across courses. Even worse, the things that matter most are often hidden in announcements, course pages, or PDF course outlines (kurs-PM) rather than shown as assignments: "sign up for lab groups by Friday", "choose project group before week 45", lab slot bookings, re-exam registration. I miss them.

I also want the same system to plan everything else I do: my own projects, job and internship applications (sommarjobb, trainee programs), and my master's thesis (exjobb) search and application.

Build me something with the ambition of Notion, designed specifically for an engineering student. Its two halves are **Sync**, which knows everything Studium knows and notices changes, and **Plan**, which turns all of that into a realistic plan for my week.

---

## Step 0: verify API access BEFORE building anything (mandatory)

I have not confirmed that UU allows students to create Canvas personal access tokens. Start with this:

1. Walk me through creating a token: Studium → Account → Settings → "Approved integrations" → "+ New access token" (in Swedish: Konto → Inställningar → Godkända integrationer → "+ Ny åtkomsttoken").
2. Write a tiny script, `scripts/verify-canvas.ts`, that reads the token from `.env` and calls:
   - `GET /api/v1/users/self`
   - `GET /api/v1/courses?enrollment_state=active&include[]=term`
   - `GET /api/v1/planner/items?start_date=<today>`
   - `GET /api/v1/users/self/groups`
   - `GET /api/v1/appointment_groups?scope=reservable`
   - `GET /api/v1/announcements?context_codes[]=course_<id>`

   It should report which calls succeed, which fail, and what the rate-limit headers (`X-Rate-Limit-Remaining`) say.
3. **If tokens are disabled or blocked,** design and implement the fallback chain instead:
   - **Canvas calendar iCal feed.** Studium → Calendar → "Calendar feed" gives a private `.ics` URL covering assignments and events. It's read-only but needs no API token.
   - **TimeEdit iCal subscription URLs** for my schedule.
   - **Manual and semi-automatic import:** paste an announcement or upload a kurs-PM PDF, and the app extracts the dates.

   Architect the sync layer as **pluggable providers** (`CanvasApiProvider`, `CanvasIcsProvider`, `TimeEditIcsProvider`, `ManualProvider`) behind one interface, so the rest of the app doesn't care where data came from.

Report the results to me before moving to Phase 1.

---

## Tech & architecture (use your judgment, but justify deviations)

- **Local-first, single user, self-hostable.** My token is effectively my Studium password, so data and credentials stay on my machine (or my own small server or Raspberry Pi later). No third-party SaaS backend.
- **Stack suggestion:** TypeScript end to end. Next.js (App Router) or Vite + React for the UI, and SQLite via Drizzle ORM (or Prisma). A background sync worker runs in the same process or as a sidecar. Use Tailwind + shadcn/ui, and add the PWA manifest so I can install it on my phone.
- **Secrets:** keep the token in `.env` / the OS keychain, never commit it, and encrypt it at rest if it's stored in the DB. Add `.env` to `.gitignore` from the very first commit.
- **Sync engine:**
  - Run an incremental, idempotent sync every 15–30 min, plus a manual "Sync now" button.
  - Respect Canvas pagination (`Link` headers, `per_page=100`) and throttling (back off when `X-Rate-Limit-Remaining` gets low).
  - Store raw API payloads plus normalized tables. **Keep a snapshot history** so the app can detect *changes* (a deadline moved, an assignment added, a file replaced, an announcement edited).
  - Never write to Canvas except through explicitly user-triggered actions such as planner notes or marking items done. Default to **read-only**.
- **Bilingual UI** (Swedish/English toggle). Use Europe/Stockholm time everywhere, and handle DST correctly.
- Light/dark mode, keyboard-first, and a fast command palette (⌘K).
- Write a `CLAUDE.md` in the repo that documents architecture, conventions, and how to run things. Add tests for the sync and diff logic and for date extraction.

---

## Core features

### 1. Studium Sync: complete mirror and change radar
Mirror from Canvas, per active course:
- assignments (with overrides and my submission status)
- quizzes
- discussions
- announcements
- modules
- pages
- files (metadata, plus optional local download)
- calendar events
- group memberships
- appointment groups / scheduler slots (lab bookings!)
- planner items
- feedback/comments on my submissions

The **Radar** is a unified "what's new / what changed" feed with diffs. Examples:
- "Deadline for Lab 3 report moved from 14 Nov → 18 Nov"
- "New file in Kvantmekanik: Övningar_v46.pdf"
- "New teacher comment on your submission"

Each item is triaged as *Action needed* or *FYI*. Every item can be marked read, snoozed, or converted into a task.

### 2. Hidden-deadline detector (the killer feature)
Scan announcements, course pages, syllabus bodies, discussion posts, and downloaded PDFs (kurs-PM, lab instructions) for:
- dates and deadlines
- sign-up windows (*anmälan, anmäl, sign up, registrera, grupp, gruppindelning, labbgrupp, boka, senast, deadline, tentamensanmälan, omtenta*)
- room/time info

Implement a rule-based extractor for Swedish and English date formats ("fre 14/11", "senast 15 november kl. 23.59", "v. 47", "2026-11-14").

Add an **optional LLM pass** (Claude API, gated behind my own API key in `.env`, off by default) for messier text. Extracted items appear as **suggestions** with the source quote and a link back. I confirm them with one click and they become tasks. Nothing is auto-added silently.

### 3. Today / Week / Semester views
- **Today:** classes from TimeEdit, tasks due, time blocks I planned, and the top 3 priorities.
- **Week:** a calendar that merges TimeEdit, Canvas deadlines, my own tasks, and work shifts.
- **Semester timeline:** UU periods (each semester split into 2 periods, with typical exam weeks), all courses as swimlanes, plus exams, lab series, and project milestones.
- **Workload heatmap:** estimated hours per week across all courses and projects. It warns me two weeks ahead about crunch weeks.

### 4. Smart planning
- Every task gets an **effort estimate**. Suggest defaults by type: lab report, problem set (inlämningsuppgift), reading, quiz, project.
- **Auto time-blocking:** propose study blocks in free slots around TimeEdit classes and my working hours. I accept, drag, or reject them.
- **Backwards planning from exams:** given a tentamen date, generate a revision plan (topics, old exams, review sessions). Use spacing, and reserve buffer days.
- **Time tracking** (a focus/pomodoro timer linked to a task or course). Compare actual against estimated time and learn my personal multipliers per course and task type.
- A **"What should I do now?"** button that picks the best task given time available, energy level, urgency, and effort.

### 5. Courses & degree progress
- Course pages showing teachers, links, a module overview, my submission status, unread feedback, and a lab-series checklist (prep done → lab done → report submitted → approved).
- **Degree tracker:** credits (hp) completed and planned toward 300 hp, the master's profile/specialization plan, and prerequisites. Ladok has no student API, so this uses manual entry or a CSV paste of my Ladok results.
- An exam register: dates, registration deadlines (anmälan till tenta), and re-exam (omtenta) tracking.

### 6. Notion-style workspace
- Pages with blocks: rich text, checklists, headings, callouts, code, **LaTeX math (KaTeX)**, embeds, links to Canvas items.
- **Databases** with custom properties and multiple views (table, board/kanban, calendar, timeline/gantt, gallery), filters, sorts, and grouping.
- Templates: Lab report, Project, Course notes, Weekly review, Application, Meeting notes.
- Backlinks, `[[page]]` linking, and full-text search across my notes **and** mirrored Studium content (including downloaded PDFs).

### 7. Personal projects
Each project gets goals, milestones, a kanban board, a time log, links (GitHub repo URL, docs), and a weekly time budget. The time budget feeds the workload heatmap so projects compete honestly with coursework.

### 8. Career & applications CRM
- A pipeline for internships, summer jobs, trainee programs, part-time jobs, and **exjobb (thesis)**: Interested → Preparing → Applied → Interview → Offer/Rejected.
- Per application: company, role, deadline, link, contacts, notes, the versions of CV / cover letter used, interview prep notes, and follow-up reminders.
- **Exjobb planner:** a timeline template that works backward from my intended thesis start, with reminders for when to start searching, when companies typically post, the department contact, the subject reviewer (ämnesgranskare), and the formal registration steps. Make this configurable, since I'll fill in the specifics.
- A contacts/networking list (people met at career fairs such as Uppsala's engineering fairs), with "last contacted" and nudges.
- An events/deadlines list for career fairs and application windows, which feeds the same calendar.

### 9. Notifications & rituals
- **Morning digest and Sunday weekly preview.** Deliver via email, ntfy.sh, or Telegram bot (make the channel pluggable).
- Escalating reminders for sign-up windows, since they're the things I miss most: 3 days, 1 day, and 3 hours before close.
- **Weekly review ritual (guided):** clear inbox, review the radar, reschedule overdue work, check next week's heatmap, update applications, and write a short reflection.
- **Export a private ICS feed** of everything (deadlines, blocks, exams) so it shows up in my phone's calendar.

### 10. Quick capture
- Natural-language input from anywhere. For example, "labbrapport fysik3 fre 17" or "apply Ericsson summer internship by 1 dec #career" gets parsed into a task with date, course, and tags.
- A mobile-friendly capture page (PWA) and an inbox for unprocessed items.

---

## Extra ideas (implement if time allows; mark as stretch goals)
- **"Course health" score:** a per-course indicator of on-track vs falling behind, based on submissions, time logged versus plan, and unread materials.
- **Unread-material tracker:** which lecture slides or files I've opened in-app versus not, per week.
- **Lab partner and group info:** who's in my Canvas groups, plus shared deadlines.
- **Grade/feedback inbox:** all teacher feedback in one place, with "acknowledged" state.
- **Study analytics:** hours per course per week, estimate accuracy, and the streak of weekly reviews done.
- **Old-exam library:** organize tentor per course with a "done/score/time" log, and suggest which to do next.
- **Semester retrospective** auto-generated at period end.
- **Backup/export:** one-click export of everything to Markdown + JSON, and nightly SQLite backups.

---

## Build plan: work in phases, demo after each

1. **Phase 0.** API verification (above) and the repo scaffold, `CLAUDE.md`, `.env.example`, and `.gitignore`.
2. **Phase 1.** The sync engine plus DB schema with snapshots and diffs; the Radar feed; a basic Today/Week view merging Canvas and TimeEdit.
3. **Phase 2.** Tasks, quick capture, the hidden-deadline detector (rule-based), and notifications plus the ICS export.
4. **Phase 3.** Planning: estimates, auto time-blocking, exam backwards-planning, the workload heatmap, and time tracking.
5. **Phase 4.** Notion-style pages and databases with views, templates, and search.
6. **Phase 5.** The Career CRM plus the exjobb planner, projects, and the degree tracker.
7. **Phase 6.** Polish: PWA, mobile layout, the optional LLM extraction, analytics, and stretch goals.

After each phase:
- run the tests
- seed realistic demo data (fake courses like "Mekanik II", "Elektromagnetism", "Kvantfysik" so I can try it without a token)
- give me a short summary of what works, what's next, and any decisions you need from me.

Ask me questions only when a decision is genuinely mine (e.g. hosting, notification channel). Otherwise pick sensible defaults and note them in `CLAUDE.md`.

## Non-negotiables
- My Studium token and data never leave my machine or server, except optional LLM calls that I explicitly enable. Show clearly what text gets sent.
- Read-only toward Canvas by default.
- Every item derived from Studium links back to its source in Studium.
- Extracted or suggested deadlines are never silently trusted. I confirm them.
- Robust to failure: if a sync fails, show the last-good data with a clear "stale since…" banner.
