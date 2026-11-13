import { addDays } from "../time";

/** Career logic without a database: contact nudges and the exjobb timeline. Pure. */

export type NudgeContact = { id: number; name: string; lastContacted: string | null; nudgeDays: number };

/** Contacts it is time to get in touch with, the most overdue first. Never-contacted people come first of all. */
export function contactsDue<T extends NudgeContact>(list: T[], today: string): (T & { dueSince: string | null })[] {
  return list
    .map((c) => ({ ...c, dueSince: c.lastContacted ? addDays(c.lastContacted, Math.max(1, c.nudgeDays)) : null }))
    .filter((c) => c.dueSince === null || c.dueSince <= today)
    .sort((a, b) => (a.dueSince ?? "").localeCompare(b.dueSince ?? ""));
}

export type ExjobbStep = { id: string; title: string; /** days relative to the thesis start; negative = before */ offset: number; done: boolean; taskId?: number | null };
export type ExjobbPlan = { start: string | null; contact: string; reviewer: string; notes: string; steps: ExjobbStep[] };

/**
 * A generic civilingenjör thesis timeline, counted backwards from the intended start.
 * These are starting points, NOT Uppsala University rules: every title and offset is meant
 * to be edited once the real dates from the department are known.
 */
export function defaultExjobbSteps(lang: "sv" | "en"): ExjobbStep[] {
  const s = (id: string, offset: number, sv: string, en: string): ExjobbStep => ({ id, offset, title: lang === "sv" ? sv : en, done: false });
  return [
    s("area", -270, "Fundera på område och prata med lärare och forskargrupper", "Think about the area and talk to teachers and research groups"),
    s("cv", -240, "Uppdatera CV och LinkedIn", "Update CV and LinkedIn"),
    s("rules", -210, "Kontrollera behörighetskraven för att få börja (poäng, kurser)", "Check the eligibility requirements for starting (credits, courses)"),
    s("search", -180, "Börja leta: företagens annonser, exjobbsportaler, mässor, institutionernas förslag", "Start searching: company postings, thesis portals, fairs, department proposals"),
    s("apply", -150, "Skicka ansökningar och kontakta företag direkt", "Send applications and contact companies directly"),
    s("choose", -110, "Intervjuer klara, välj projekt", "Interviews done, choose a project"),
    s("reviewer", -90, "Hitta ämnesgranskare", "Find a subject reviewer"),
    s("plan", -70, "Skriv projektplan tillsammans med handledaren", "Write the project plan with the supervisor"),
    s("submit", -50, "Lämna in projektplanen för godkännande", "Submit the project plan for approval"),
    s("register", -30, "Formell anmälan och registrering på exjobbskursen; avtal med företaget", "Formal application and course registration; agreement with the company"),
    s("setup", -10, "Praktiskt: arbetsplats, konton, utrustning", "Practicalities: workplace, accounts, equipment"),
    s("start", 0, "Exjobbet startar", "Thesis starts"),
  ];
}

export function exjobbDates(plan: Pick<ExjobbPlan, "start" | "steps">, today: string): (ExjobbStep & { date: string | null; late: boolean })[] {
  return [...plan.steps]
    .sort((a, b) => a.offset - b.offset)
    .map((st) => {
      const date = plan.start ? addDays(plan.start, st.offset) : null;
      return { ...st, date, late: date !== null && !st.done && date < today };
    });
}
