import type { PropDef, ViewDef } from "../db/schema";
import type { Lang } from "../time";

/** Starting points for pages and databases. Content is plain Markdown, so a template is only a suggestion. */

export type PageTemplate = { key: string; name: Record<Lang, string>; title: (lang: Lang, ctx: TemplateCtx) => string; content: (lang: Lang, ctx: TemplateCtx) => string };
export type TemplateCtx = { date: string; week: number };

const sv = (lang: Lang, a: string, b: string) => (lang === "sv" ? a : b);

export const PAGE_TEMPLATES: PageTemplate[] = [
  { key: "blank", name: { sv: "Tom sida", en: "Blank page" }, title: (l) => sv(l, "Namnlös", "Untitled"), content: () => "" },
  {
    key: "lab_report", name: { sv: "Labbrapport", en: "Lab report" }, title: (l) => sv(l, "Labbrapport: ", "Lab report: "),
    content: (l) => sv(l,
`> [!note] Checklista
> - [ ] Förberedelseuppgifter klara
> - [ ] Laborationen genomförd
> - [ ] Rapport inlämnad
> - [ ] Godkänd

## Syfte

## Teori

Skriv formler med LaTeX, t.ex. $E = h\\nu$ eller

$$
\\Delta x\\,\\Delta p \\geq \\frac{\\hbar}{2}
$$

## Utförande

## Mätdata

| Mätning | Värde | Osäkerhet |
| --- | --- | --- |
|  |  |  |

## Analys och felkällor

## Slutsats
`,
`> [!note] Checklist
> - [ ] Pre-lab done
> - [ ] Lab done
> - [ ] Report submitted
> - [ ] Approved

## Aim

## Theory

Write formulas with LaTeX, e.g. $E = h\\nu$ or

$$
\\Delta x\\,\\Delta p \\geq \\frac{\\hbar}{2}
$$

## Method

## Data

| Measurement | Value | Uncertainty |
| --- | --- | --- |
|  |  |  |

## Analysis and sources of error

## Conclusion
`),
  },
  {
    key: "project", name: { sv: "Projekt", en: "Project" }, title: (l) => sv(l, "Projekt: ", "Project: "),
    content: (l) => sv(l,
`## Mål

## Milstolpar

- [ ] 
- [ ] 

## Länkar

- Repo: 
- Dokument: 

## Veckobudget

 h/vecka

## Logg
`,
`## Goal

## Milestones

- [ ] 
- [ ] 

## Links

- Repo: 
- Docs: 

## Weekly budget

 h/week

## Log
`),
  },
  {
    key: "course_notes", name: { sv: "Kursanteckningar", en: "Course notes" }, title: (l, c) => sv(l, `Föreläsning ${c.date}`, `Lecture ${c.date}`),
    content: (l) => sv(l,
`## Huvudpunkter

- 

## Härledningar

$$

$$

## Frågor att reda ut

- [ ] 

## Att göra efter föreläsningen

- [ ] Räkna rekommenderade uppgifter
`,
`## Key points

- 

## Derivations

$$

$$

## Questions to clear up

- [ ] 

## After the lecture

- [ ] Do the recommended problems
`),
  },
  {
    key: "weekly_review", name: { sv: "Veckogenomgång", en: "Weekly review" }, title: (l, c) => sv(l, `Veckogenomgång v. ${c.week}`, `Weekly review, week ${c.week}`),
    content: (l) => sv(l,
`> [!tip] Gör stegen i ordning. Det tar ungefär 15 minuter.

- [ ] Töm inkorgen: [Uppgifter](/tasks)
- [ ] Gå igenom radarn: [Radar](/radar)
- [ ] Granska hittade deadlines: [Hittat](/found)
- [ ] Flytta eller stryk försenat: [Uppgifter](/tasks)
- [ ] Titta på nästa veckas belastning: [Arbetsbelastning](/plan?tab=load)
- [ ] Lägg pluggpass för veckan: [Planera](/plan)
- [ ] Uppdatera ansökningar och projekt: [Anteckningar](/notes)

## Vad gick bra?

## Vad tog längre tid än väntat?

## En sak att göra annorlunda nästa vecka
`,
`> [!tip] Do the steps in order. It takes about 15 minutes.

- [ ] Empty the inbox: [Tasks](/tasks)
- [ ] Go through the radar: [Radar](/radar)
- [ ] Review found deadlines: [Found](/found)
- [ ] Move or drop overdue work: [Tasks](/tasks)
- [ ] Look at next week's load: [Workload](/plan?tab=load)
- [ ] Place study blocks for the week: [Plan](/plan)
- [ ] Update applications and projects: [Notes](/notes)

## What went well?

## What took longer than expected?

## One thing to do differently next week
`),
  },
  {
    key: "application", name: { sv: "Ansökan", en: "Application" }, title: (l) => sv(l, "Ansökan: ", "Application: "),
    content: (l) => sv(l,
`## Om rollen

- Företag: 
- Roll: 
- Sista ansökningsdag: 
- Annons: 

## Varför jag passar

## Kontakter

## Skickat

- [ ] CV (version: )
- [ ] Personligt brev (version: )

## Intervjuförberedelser

## Uppföljning

- [ ] 
`,
`## About the role

- Company: 
- Role: 
- Deadline: 
- Posting: 

## Why I fit

## Contacts

## Sent

- [ ] CV (version: )
- [ ] Cover letter (version: )

## Interview prep

## Follow-up

- [ ] 
`),
  },
  {
    key: "meeting", name: { sv: "Mötesanteckningar", en: "Meeting notes" }, title: (l, c) => sv(l, `Möte ${c.date}`, `Meeting ${c.date}`),
    content: (l) => sv(l, `**Närvarande:** \n\n## Dagordning\n\n1. \n\n## Beslut\n\n- \n\n## Att göra\n\n- [ ] \n`, `**Present:** \n\n## Agenda\n\n1. \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n`),
  },
];

export type DbTemplate = { key: string; name: Record<Lang, string>; build: (lang: Lang) => { title: string; props: PropDef[]; views: ViewDef[] } };

export const DB_TEMPLATES: DbTemplate[] = [
  {
    key: "blank", name: { sv: "Tom databas", en: "Blank database" },
    build: (l) => ({
      title: sv(l, "Ny databas", "New database"),
      props: [{ id: "status", name: "Status", type: "select", options: sv(l, "Att göra,Pågår,Klart", "To do,Doing,Done").split(",") }, { id: "date", name: sv(l, "Datum", "Date"), type: "date" }],
      views: [{ id: "table", name: sv(l, "Tabell", "Table"), type: "table" }, { id: "board", name: sv(l, "Tavla", "Board"), type: "board", groupBy: "status" }],
    }),
  },
  {
    key: "projects", name: { sv: "Projekt (kanban)", en: "Projects (kanban)" },
    build: (l) => ({
      title: sv(l, "Projekt", "Projects"),
      props: [
        { id: "status", name: "Status", type: "select", options: sv(l, "Idé,Pågår,Väntar,Klart", "Idea,Active,Waiting,Done").split(",") },
        { id: "prio", name: sv(l, "Prio", "Priority"), type: "select", options: sv(l, "Hög,Medel,Låg", "High,Medium,Low").split(",") },
        { id: "start", name: "Start", type: "date" },
        { id: "due", name: "Deadline", type: "date" },
        { id: "course", name: sv(l, "Kurs", "Course"), type: "course" },
        { id: "link", name: sv(l, "Länk", "Link"), type: "url" },
      ],
      views: [
        { id: "board", name: sv(l, "Tavla", "Board"), type: "board", groupBy: "status" },
        { id: "table", name: sv(l, "Tabell", "Table"), type: "table", sortBy: "due", sortDir: "asc" },
        { id: "timeline", name: sv(l, "Tidslinje", "Timeline"), type: "timeline", dateProp: "start", endProp: "due" },
        { id: "calendar", name: sv(l, "Kalender", "Calendar"), type: "calendar", dateProp: "due" },
      ],
    }),
  },
  {
    key: "applications", name: { sv: "Ansökningar (pipeline)", en: "Applications (pipeline)" },
    build: (l) => ({
      title: sv(l, "Ansökningar", "Applications"),
      props: [
        { id: "status", name: "Status", type: "select", options: sv(l, "Intresserad,Förbereder,Ansökt,Intervju,Erbjudande,Avslag", "Interested,Preparing,Applied,Interview,Offer,Rejected").split(",") },
        { id: "company", name: sv(l, "Företag", "Company"), type: "text" },
        { id: "type", name: sv(l, "Typ", "Type"), type: "select", options: sv(l, "Sommarjobb,Praktik,Trainee,Exjobb,Deltid", "Summer job,Internship,Trainee,Thesis,Part-time").split(",") },
        { id: "due", name: sv(l, "Sista dag", "Deadline"), type: "date" },
        { id: "link", name: sv(l, "Annons", "Posting"), type: "url" },
      ],
      views: [
        { id: "board", name: "Pipeline", type: "board", groupBy: "status" },
        { id: "table", name: sv(l, "Tabell", "Table"), type: "table", sortBy: "due", sortDir: "asc" },
        { id: "calendar", name: sv(l, "Kalender", "Calendar"), type: "calendar", dateProp: "due" },
      ],
    }),
  },
  {
    key: "course_notes", name: { sv: "Kursanteckningar", en: "Course notes" },
    build: (l) => ({
      title: sv(l, "Kursanteckningar", "Course notes"),
      props: [
        { id: "course", name: sv(l, "Kurs", "Course"), type: "course" },
        { id: "date", name: sv(l, "Datum", "Date"), type: "date" },
        { id: "type", name: sv(l, "Typ", "Type"), type: "select", options: sv(l, "Föreläsning,Övning,Lab,Sammanfattning", "Lecture,Exercise,Lab,Summary").split(",") },
      ],
      views: [
        { id: "table", name: sv(l, "Tabell", "Table"), type: "table", sortBy: "date", sortDir: "desc" },
        { id: "gallery", name: sv(l, "Galleri", "Gallery"), type: "gallery", sortBy: "date", sortDir: "desc" },
        { id: "bytype", name: sv(l, "Per typ", "By type"), type: "board", groupBy: "type" },
      ],
    }),
  },
  {
    key: "old_exams", name: { sv: "Gamla tentor", en: "Old exams" },
    build: (l) => ({
      title: sv(l, "Gamla tentor", "Old exams"),
      props: [
        { id: "course", name: sv(l, "Kurs", "Course"), type: "course" },
        { id: "exam", name: sv(l, "Tentadatum", "Exam date"), type: "date" },
        { id: "done", name: sv(l, "Gjord", "Done"), type: "checkbox" },
        { id: "score", name: sv(l, "Poäng", "Score"), type: "number" },
        { id: "minutes", name: sv(l, "Tid (min)", "Time (min)"), type: "number" },
      ],
      views: [
        { id: "table", name: sv(l, "Tabell", "Table"), type: "table", sortBy: "exam", sortDir: "desc" },
        { id: "todo", name: sv(l, "Ogjorda", "Not done"), type: "table", sortBy: "exam", sortDir: "desc", filters: [{ prop: "done", op: "is", value: "false" }] },
      ],
    }),
  },
];
