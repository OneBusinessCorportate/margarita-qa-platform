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

/** The model's verdict for one chat. */
export interface Verdict {
  agr_no: string;
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
    "переписку клиента с бухгалтером (Telegram, языки: русский, армянский,",
    "транслит). Реши, ОЖИДАЕТ ли чат ответа сотрудника прямо сейчас.",
    "",
    "Правила:",
    "- «ждёт ответа» = клиент задал вопрос / попросил что-то сделать / прислал",
    "  данные, на которые нужна реакция, и сотрудник ещё не ответил.",
    "- «ответа не требуется» = последнее сообщение клиента — это благодарность,",
    "  подтверждение или закрытие диалога («спасибо», «ок», «понятно», «принято»,",
    "  «хорошо»), ИЛИ на вопрос клиента сотрудник уже ответил последним.",
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
          unanswered: { type: "boolean" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["agr_no", "unanswered", "reason", "confidence"],
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
    if (!r || typeof r.agr_no !== "string" || typeof r.unanswered !== "boolean")
      continue;
    const confidence =
      r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
        ? r.confidence
        : "low";
    out.push({
      agr_no: r.agr_no,
      unanswered: r.unanswered,
      reason: typeof r.reason === "string" ? r.reason : "",
      confidence,
    });
  }
  return out;
}
