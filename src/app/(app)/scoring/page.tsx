import ScoringPanel from "@/components/ScoringPanel";
import {
  listAccountants,
  listActiveExclusions,
  listActiveInclusions,
  listChatActivity,
  listChatMailings,
  listChats,
  listEvaluations,
  listTasks,
} from "@/lib/repo";
import { trainAiModel } from "@/lib/ai";
import { maybeRefreshMailings } from "@/lib/mailings-run";
import { reviewDayForActivity, reviewDayOf } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  // Self-triggering mailing detection: if the current month's keyword + AI
  // scan is older than 2 h (or never ran), start one in the background. The
  // page renders immediately with what's in the DB; fresh detections appear
  // on the next load.
  maybeRefreshMailings();

  // Only the recent window of per-day activity is needed to drive the day view;
  // bound it so the payload stays small (QA reviews recent days).
  const activityFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Load mailings for both current and previous Yerevan month so the scoring
  // form shows the right period's detections regardless of which date is selected.
  const nowYerevan = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Yerevan" })
  );
  const cy = nowYerevan.getFullYear();
  const cm = nowYerevan.getMonth() + 1; // 1-based
  const currentPeriod = `${cy}${String(cm).padStart(2, "0")}`;
  const prevM = cm === 1 ? 12 : cm - 1;
  const prevY = cm === 1 ? cy - 1 : cy;
  const previousPeriod = `${prevY}${String(prevM).padStart(2, "0")}`;

  const [
    chats,
    accountants,
    evaluations,
    tasks,
    exclusions,
    inclusions,
    chatActivity,
    detectedMailingsCurrent,
    detectedMailingsPrev,
  ] = await Promise.all([
    listChats(),
    listAccountants(),
    listEvaluations({}),
    listTasks(),
    listActiveExclusions(),
    listActiveInclusions(),
    listChatActivity(activityFrom),
    listChatMailings(currentPeriod),
    listChatMailings(previousPeriod),
  ]);

  const detectedMailings = [...detectedMailingsCurrent, ...detectedMailingsPrev];

  // Default the day view to the most recent day chats were ACTUALLY active
  // (real chat activity from the live feed, kept current by the sync — normally
  // "today"), or a task touch. Evaluations are deliberately excluded: a QA
  // review isn't chat activity, and counting it made the day view default to
  // the last day something was reviewed and surface stale chats.
  // Map each raw activity date to its QA review day (weekend / RA-holiday
  // activity — and Friday activity after 19:00 — rolls onto the next working
  // day), so the day view defaults to the most recent day chats are actually
  // REVIEWED, never an empty weekend date. Chats carry a precise timestamp, so
  // the Friday-evening roll applies; tasks only have a date.
  const activityDates = [
    ...chats
      .filter((c) => c.last_activity_date)
      .map((c) => reviewDayForActivity(c.last_activity_at, c.last_activity_date!)),
    ...tasks
      .map((t) => (t.checking_date ?? t.due_date_original ?? "").slice(0, 10))
      .filter(Boolean)
      .map((d) => reviewDayOf(d)),
  ].filter(Boolean);
  const latestActivityDate =
    activityDates.length > 0 ? activityDates.sort().at(-1)! : null;

  // Re-train the AI on every load from the full evaluation history in the DB —
  // each saved Margarita row is a fresh training example. Only accountant rows
  // feed the accounting model; manager/lawyer rows use a different scheme.
  const aiModel = trainAiModel(
    evaluations.filter((e) => (e.role ?? "accountant") === "accountant")
  );

  return (
    // Fill the viewport (minus navbar + main padding) so the grid below fills
    // the remaining height and only the grid scrolls — the page itself never
    // does. Keeps every control on one screen.
    <div className="flex flex-col h-[calc(100vh-5rem)] min-h-0">
      <ScoringPanel
        chats={chats}
        accountants={accountants}
        initialEvaluations={evaluations.slice(0, 1000)}
        aiModel={aiModel}
        latestActivityDate={latestActivityDate}
        initialExclusions={exclusions}
        initialInclusions={inclusions}
        chatActivity={chatActivity}
        detectedMailings={detectedMailings}
        taskActivity={tasks.map((t) => ({
          chat_agr_no: t.chat_agr_no,
          date: (t.checking_date ?? t.due_date_original ?? "").slice(0, 10),
        }))}
      />
    </div>
  );
}
