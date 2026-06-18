// ---------------------------------------------------------------------------
// Pure helpers for AI-assisted "unanswered chat" detection.
//
// The naive signal — "the client sent the last message" — is wrong: a client's
// closing "спасибо"/"ок"/"принято" must NOT count as waiting for a reply. An LLM
// reads the recent transcript and judges whether a reply is genuinely owed. It
// LEARNS from Margarita's ✔/✘ corrections, which are fed back as few-shot
// examples (her corrections — where the AI was wrong — are prioritized).
//
// Everything here is pure (no I/O) so the prompt-shaping and label-selection
// rules are unit-tested data, not buried in the API route.
// ---------------------------------------------------------------------------

/** One message from the live feed transcript. */
export interface TranscriptMsg {
  role: string | null; // sender_role: client / accountant / manager / …
  text: string | null;
  at: string;
}

/** A chat to be judged, as returned by mqa_unanswered_candidates(). */
export interface Candidate {
  agr_no: string;
  chat_id: number | null;
  last_msg_at: string;
  last_msg_text: string | null;
  transcript: TranscriptMsg[] | null;
}

/** A confirmed human label — the training signal. */
export interface UnansweredLabel {
  last_msg_text: string | null;
  ai_unanswered: boolean | null; // what the AI said (null if labelled pre-analysis)
  human_unanswered: boolean; // what Margarita decided (ground truth)
}

/** Whom an open/unfinished thread is waiting on. */
export type WaitingOn = "staff" | "client" | "none";

/** Stored detection state for one chat (subset of mqa_unanswered). */
export interface UnansweredRecord {
  human_unanswered?: boolean | null;
  ai_waiting_on?: string | null;
  watched?: boolean | null;
}

/**
 * Effective waiting state for a chat, by precedence:
 *   1. Margarita's ✔/✘ (human_unanswered): ✔ → staff, ✘ → none
 *   2. the AI verdict (ai_waiting_on)
 *   3. the rule fallback (mqa_chats.unanswered: client wrote last & not closing)
 *
 * `verdictIsCurrent` says whether the stored human/AI verdict was made about the
 * chat's CURRENT last message. This is how Margarita actually worked: a verdict
 * only counts for the message it was made on — once a NEW message arrives after
 * the QA check, the old "решено"/AI verdict no longer applies and the chat falls
 * back to the rule (re-opening it). When false, only the rule is used.
 *
 * Kept pure so the precedence Margarita relies on is unit-tested, not buried in
 * the data layer.
 */
export function effectiveWaitingOn(
  rec: UnansweredRecord | undefined | null,
  ruleUnanswered: boolean | null | undefined,
  verdictIsCurrent = true
): WaitingOn {
  if (verdictIsCurrent) {
    if (rec?.human_unanswered === true) return "staff";
    if (rec?.human_unanswered === false) return "none";
    if (
      rec?.ai_waiting_on === "staff" ||
      rec?.ai_waiting_on === "client" ||
      rec?.ai_waiting_on === "none"
    )
      return rec.ai_waiting_on;
  }
  if (ruleUnanswered === true) return "staff";
  return "none";
}

/** True when two timestamps refer to the same instant (tolerant of formatting). */
export function sameInstant(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return !Number.isNaN(ta) && ta === tb;
}

/**
 * A watched chat that's no longer waiting on us (or anyone) is one that finally
 * got answered — surface it as resolved so she can verify, instead of dropping
 * it silently (her old "re-check at the end" step, automated).
 */
export function isResolvedWatched(
  waitingOn: WaitingOn,
  watched: boolean
): boolean {
  return watched && waitingOn !== "staff";
}

/** The model's verdict for one chat. */
export interface Verdict {
  agr_no: string;
  /** Whom the conversation is waiting on (none = finished/closed). */
  waiting_on: WaitingOn;
  /** Derived: the QA-actionable signal — staff still owes the client a reply. */
  unanswered: boolean;
  reason: string;
  confidence: "high" | "medium" | "low";
}

/** The everyone-but-the-client roles are "staff" for the judge's purposes. */
function speakerLabel(role: string | null): string {
  return role === "client" ? "КЛИЕНТ" : `СОТРУДНИК${role ? ` (${role})` : ""}`;
}

/** Render a transcript as plain text, oldest→newest, with each line truncated. */
export function formatTranscript(
  msgs: TranscriptMsg[] | null | undefined,
  maxLineChars = 400
): string {
  if (!msgs || msgs.length === 0) return "(нет сообщений)";
  return msgs
    .map((m) => {
      const t = (m.text ?? "").replace(/\s+/g, " ").trim() || "(вложение/пусто)";
      const clipped = t.length > maxLineChars ? t.slice(0, maxLineChars) + "…" : t;
      return `${speakerLabel(m.role)}: ${clipped}`;
    })
    .join("\n");
}

/**
 * Choose few-shot examples from Margarita's confirmed labels. Her CORRECTIONS
 * (where the AI guessed wrong) teach the most, so they come first; the rest fill
 * up to `max`, newest first (callers should pass labels newest-first).
 */
export function selectFewShot(
  labels: UnansweredLabel[],
  max = 12
): UnansweredLabel[] {
  const usable = labels.filter((l) => (l.last_msg_text ?? "").trim().length > 0);
  const corrections = usable.filter(
    (l) => l.ai_unanswered !== null && l.ai_unanswered !== l.human_unanswered
  );
  const rest = usable.filter(
    (l) => !(l.ai_unanswered !== null && l.ai_unanswered !== l.human_unanswered)
  );
  return [...corrections, ...rest].slice(0, max);
}

const VERDICT_WORD = (u: boolean) => (u ? "ждёт ответа" : "ответа не требуется");

/** Build the system prompt, seeding it with Margarita's confirmed labels. */
export function buildSystemPrompt(fewShot: UnansweredLabel[]): string {
  const base = [
    "Ты — ассистент QA-отдела бухгалтерской компании OneBusiness. Тебе дают",
    "переписку клиента с сотрудником/бухгалтером (Telegram, языки: русский,",
    "армянский, транслит). Реши, ЗАВЕРШЕНА ли коммуникация, и если нет — КОГО",
    "сейчас ждут. Это важно: незавершённым считается чат и тогда, когда вопрос",
    "задал САМ сотрудник и ждёт ответа клиента.",
    "",
    "Верни одно из значений waiting_on:",
    "- «staff»  = ждём СОТРУДНИКА: клиент задал вопрос / попросил сделать / прислал",
    "  данные, на которые нужна реакция, а сотрудник ещё не ответил. (Это и есть",
    "  «ждёт ответа» — то, что должен закрыть наш отдел.)",
    "- «client» = ждём КЛИЕНТА: сотрудник задал вопрос / попросил документы или",
    "  оплату / уточнение, и теперь ход за клиентом. Коммуникация ещё не завершена,",
    "  но это не наша просрочка — нужно проследить, ответит ли клиент.",
    "- «none»   = коммуникация ЗАВЕРШЕНА: последнее сообщение — благодарность или",
    "  закрытие («спасибо», «ок», «понятно», «принято»), либо вопрос уже закрыт",
    "  ответом другой стороны.",
    "",
    "- Учитывай весь контекст переписки, а не только последнюю строку.",
    "- Если сомневаешься — confidence ставь low.",
    "- reason: одно короткое предложение по-русски.",
  ].join("\n");

  if (fewShot.length === 0) return base;

  const examples = fewShot
    .map((l, i) => {
      const text = (l.last_msg_text ?? "").replace(/\s+/g, " ").trim();
      return `${i + 1}. Последнее сообщение клиента: «${text}» → ${VERDICT_WORD(
        l.human_unanswered
      )}`;
    })
    .join("\n");

  return (
    base +
    "\n\nПримеры решений, подтверждённых старшим QA (учись на них, особенно на" +
    " исправлениях):\n" +
    examples
  );
}

/** Build the user message: the chats to judge, each with its transcript. */
export function buildUserPrompt(candidates: Candidate[]): string {
  const blocks = candidates.map((c) => {
    return [
      `agr_no: ${c.agr_no}`,
      "Переписка (старые → новые):",
      formatTranscript(c.transcript),
    ].join("\n");
  });
  return (
    "Оцени каждый чат ниже. Верни решение для КАЖДОГО agr_no.\n\n" +
    blocks.join("\n\n———\n\n")
  );
}

/** JSON-schema for output_config.format — guarantees a parseable shape. */
export const VERDICTS_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agr_no: { type: "string" },
          waiting_on: { type: "string", enum: ["staff", "client", "none"] },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["agr_no", "waiting_on", "reason", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

/** Parse + validate the model's JSON text into verdicts (drops malformed rows). */
export function parseVerdicts(text: string): Verdict[] {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(obj?.results) ? obj.results : [];
  const out: Verdict[] = [];
  for (const r of arr) {
    if (!r || typeof r.agr_no !== "string") continue;
    const waiting_on: WaitingOn =
      r.waiting_on === "staff" || r.waiting_on === "client" || r.waiting_on === "none"
        ? r.waiting_on
        : "none";
    const confidence =
      r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
        ? r.confidence
        : "low";
    out.push({
      agr_no: r.agr_no,
      waiting_on,
      unanswered: waiting_on === "staff", // QA-actionable: we still owe a reply
      reason: typeof r.reason === "string" ? r.reason : "",
      confidence,
    });
  }
  return out;
}
