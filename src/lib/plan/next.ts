import { DEMANDING, type WorkType } from "./estimate";

/** "What should I do now?" Pure scoring, so the choice can be explained and tested. */

export type Energy = "low" | "medium" | "high";
export type Candidate = { key: string; title: string; courseId: string | null; type: WorkType; remainingMin: number; dueAt: Date | null };
export type Reason = "overdue" | "due_soon" | "fits" | "quick_win" | "needs_focus" | "easy" | "start_early";
export type Pick = { candidate: Candidate; score: number; reasons: Reason[]; minutes: number };

const H = 3_600_000;

export function pickNext(candidates: Candidate[], opts: { now: Date; availableMin: number; energy: Energy }): Pick[] {
  const { now, availableMin, energy } = opts;
  return candidates
    .filter((c) => c.remainingMin > 0)
    .map((c): Pick => {
      const reasons: Reason[] = [];
      let score = 0;

      // Urgency: how much slack is left once the remaining work is subtracted from the time to the deadline.
      if (c.dueAt) {
        const hoursLeft = (c.dueAt.getTime() - now.getTime()) / H;
        const slack = hoursLeft - c.remainingMin / 60;
        if (hoursLeft < 0) {
          score += 75; // already late: beats anything that is merely close
          reasons.push("overdue");
        } else if (slack < 24) {
          score += 55;
          reasons.push("due_soon");
        } else if (slack < 72) {
          score += 35;
          reasons.push("due_soon");
        } else {
          score += Math.max(0, 25 - slack / 24); // fades out over ~3.5 weeks
          if (c.remainingMin >= 240 && hoursLeft < 24 * 14) reasons.push("start_early");
        }
      } else {
        score += 5;
      }

      // Does it fit the time I have?
      if (c.remainingMin <= availableMin) {
        score += 15;
        reasons.push(c.remainingMin <= 20 ? "quick_win" : "fits");
      } else if (availableMin < 30) {
        score -= 15; // 15 minutes is not enough to get into a lab report
      }

      // Energy: demanding work when sharp, light work when tired.
      const hard = DEMANDING.has(c.type);
      if (energy === "high" && hard) {
        score += 15;
        reasons.push("needs_focus");
      } else if (energy === "low") {
        if (hard) score -= 20;
        else {
          score += 15;
          reasons.push("easy");
        }
      }
      return { candidate: c, score: Math.round(score * 10) / 10, reasons, minutes: Math.min(c.remainingMin, availableMin) };
    })
    .sort((a, b) => b.score - a.score || (a.candidate.dueAt?.getTime() ?? Infinity) - (b.candidate.dueAt?.getTime() ?? Infinity));
}
