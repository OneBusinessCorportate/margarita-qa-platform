// ---------------------------------------------------------------------------
// Structured mailing classifier (RU / HY / EN + mixed) on top of the signal
// engine (mailings-detect.ts). Adds, per category:
//   • status        — the single-message status (Отправил / Получил / …)
//   • confidence     — 0..1 weighted evidence score
//   • evidence       — short human reasons (why this category fired)
//   • source         — how it was decided: confirmed | learned | template | rule
//
// Plus a deterministic SELF-LEARNING layer: Margarita's confirmed marks and
// corrections are turned into reusable token fingerprints. A fingerprint is
// trusted only once ≥ `minSupport` confirmed messages back it (safeguard — one
// accidental correction can't rewrite the classifier), and a learned/confirmed
// match takes PRIORITY over the generic keyword rules.
//
// This module autonomously rewrites NO source code and mutates NO business
// rules — learning is data (fingerprints) fed in at call time.
// ---------------------------------------------------------------------------
import {
  detectAllSignals,
  deriveStatus,
  isOnboardingMessage,
  type MailingSignal,
  type SignalType,
} from "./mailings-detect";

export type Category = MailingSignal["category"];
export const ALL_CATEGORIES: Category[] = [
  "main_taxes",
  "salary",
  "primary_docs",
  "debts",
];

/** Russian labels for the categories (UI display under «📌 Сохранено»). */
export const CATEGORY_LABEL_RU: Record<Category, string> = {
  main_taxes: "Налоги",
  salary: "Зарплата",
  primary_docs: "Первичка",
  debts: "Долги",
};

export type DetectionSource = "confirmed" | "learned" | "template" | "rule";

export interface DetectedCategory {
  category: Category;
  /** Single-message status derived from this message alone. */
  status: string;
  /** Dominant signal type behind the status. */
  type: SignalType;
  /** Weighted evidence score, 0..1. */
  confidence: number;
  /** Short human reasons (debug / admin only — never shown to normal users). */
  evidence: string[];
  source: DetectionSource;
}

export interface ClassifyResult {
  categories: DetectedCategory[];
  /** The message is a client-onboarding / service-info template. */
  isOnboarding: boolean;
  /** ISO date of the message (relevant date for the display), if provided. */
  date: string | null;
}

// --- Text normalization ------------------------------------------------------

const STOPWORDS = new Set([
  // RU
  "это", "как", "что", "для", "или", "при", "над", "под", "про", "без", "все",
  "вас", "нам", "они", "оно", "она", "его", "нас", "там", "тут", "уже", "ещё",
  "еще", "быть", "если", "чтобы", "также", "здравствуйте", "добрый", "день",
  "спасибо", "пожалуйста",
  // EN
  "the", "and", "for", "with", "you", "your", "please", "have", "this", "that",
  "from", "are", "was", "will", "not", "can", "our", "all",
]);

/** Normalize: NFKC, lowercase, strip emoji/punctuation/digits, collapse spaces. */
export function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content tokens (len ≥ 4, not a stopword) — the unit of a fingerprint. */
export function contentTokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

// --- Self-learning: confirmed fingerprints -----------------------------------

export interface ConfirmedExample {
  text: string;
  category: Category;
  status: string;
  type?: SignalType;
}

export interface LearnedFingerprint {
  category: Category;
  status: string;
  type: SignalType;
  /** Tokens that must (mostly) be present for a match. */
  tokens: string[];
  /** How many confirmed messages back this fingerprint. */
  support: number;
}

/** Default: a learned fingerprint is trusted only once ≥ 3 examples back it. */
export const DEFAULT_MIN_SUPPORT = 3;

/**
 * Build reusable fingerprints from Margarita's confirmed examples. Group by
 * (category, status, type); within a group keep the tokens that appear in at
 * least `minSupport` of the group's messages (frequency-based, capped). Only
 * groups with ≥ `minSupport` examples yield a fingerprint — the safeguard that
 * stops one accidental correction from generalizing.
 */
export function buildLearnedFingerprints(
  examples: ConfirmedExample[],
  minSupport = DEFAULT_MIN_SUPPORT
): LearnedFingerprint[] {
  const groups = new Map<string, { ex: ConfirmedExample[] }>();
  for (const e of examples) {
    if (!e.text || !e.status) continue;
    const type = e.type ?? "done";
    const key = `${e.category}|${e.status}|${type}`;
    if (!groups.has(key)) groups.set(key, { ex: [] });
    groups.get(key)!.ex.push(e);
  }

  const out: LearnedFingerprint[] = [];
  for (const [key, { ex }] of groups) {
    if (ex.length < minSupport) continue; // threshold safeguard
    const [category, status, type] = key.split("|") as [Category, string, SignalType];
    const freq = new Map<string, number>();
    for (const e of ex) {
      for (const t of new Set(contentTokens(e.text))) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    const tokens = [...freq.entries()]
      .filter(([, n]) => n >= minSupport) // token shared by ≥ minSupport messages
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    if (tokens.length >= 2) {
      out.push({ category, status, type, tokens, support: ex.length });
    }
  }
  return out;
}

/**
 * The best learned fingerprint matching `text` for a given category (or all).
 * A match needs ≥ 80% of the fingerprint's tokens present — conservative so a
 * broad message doesn't trip a narrow learned rule.
 */
function matchLearned(
  tokenSet: Set<string>,
  learned: LearnedFingerprint[],
  category?: Category
): LearnedFingerprint | null {
  let best: LearnedFingerprint | null = null;
  for (const f of learned) {
    if (category && f.category !== category) continue;
    if (f.tokens.length < 2) continue;
    const present = f.tokens.filter((t) => tokenSet.has(t)).length;
    if (present / f.tokens.length >= 0.8) {
      if (!best || f.support > best.support) best = f;
    }
  }
  return best;
}

// --- Confidence weights ------------------------------------------------------

const TYPE_CONFIDENCE: Record<SignalType, number> = {
  done: 0.8,
  paid: 0.8,
  call: 0.72,
  req: 0.68,
  neg: 0.6,
};

/** Priority when several signal types fire for one category in one message. */
const TYPE_PRIORITY: SignalType[] = ["done", "paid", "call", "req", "neg"];

export interface ClassifyOptions {
  learned?: LearnedFingerprint[];
  minSupport?: number;
  date?: string | null;
}

/**
 * Classify a single message into detected mailing categories with confidence,
 * evidence and source. Onboarding/service-info templates never yield a
 * completed («done»/«paid») category. Confirmed/learned fingerprints override
 * the keyword rules and carry higher confidence.
 */
export function classifyMessage(
  text: string,
  options: ClassifyOptions = {}
): ClassifyResult {
  const date = options.date ?? null;
  const learned = options.learned ?? [];
  const onboarding = isOnboardingMessage(text);

  // Count this message's signals per category.
  const counts = new Map<Category, Record<SignalType, number>>();
  for (const s of detectAllSignals(text)) {
    if (!counts.has(s.category))
      counts.set(s.category, { done: 0, req: 0, call: 0, paid: 0, neg: 0 });
    counts.get(s.category)![s.type] += 1;
  }

  const tokenSet = new Set(contentTokens(text));
  const categories: DetectedCategory[] = [];

  for (const category of ALL_CATEGORIES) {
    const c = counts.get(category);
    const learnedMatch = matchLearned(tokenSet, learned, category);

    // A confirmed/learned fingerprint takes priority over the keyword rules.
    if (learnedMatch) {
      // Onboarding still cannot be a completed mailing, even if learned.
      if (onboarding && (learnedMatch.type === "done" || learnedMatch.type === "paid")) {
        // fall through to rule-based handling below
      } else {
        categories.push({
          category,
          status: learnedMatch.status,
          type: learnedMatch.type,
          confidence: 0.95,
          evidence: [
            `подтверждённый шаблон Маргариты (примеров: ${learnedMatch.support})`,
          ],
          source: learnedMatch.support >= DEFAULT_MIN_SUPPORT ? "confirmed" : "learned",
        });
        continue;
      }
    }

    if (!c) continue;

    // Onboarding guard: strip completion signals so a welcome message that
    // merely lists tax dates is never «Отправил»/«Получил»/«Нет долга».
    if (onboarding) {
      c.done = 0;
      c.paid = 0;
    }

    const status = deriveStatus(category, c);
    if (!status) continue;

    // Dominant type = the highest-priority type that actually fired.
    const type =
      TYPE_PRIORITY.find((t) => (c[t] ?? 0) > 0) ?? "req";
    const evidence: string[] = [];
    for (const t of TYPE_PRIORITY) if (c[t] > 0) evidence.push(`${t}×${c[t]}`);
    // More corroborating signals nudge confidence up (capped).
    const total = c.done + c.req + c.call + c.paid + c.neg;
    const confidence = Math.min(
      0.95,
      TYPE_CONFIDENCE[type] + Math.min(0.1, (total - 1) * 0.03)
    );

    categories.push({
      category,
      status,
      type,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
      source: "rule",
    });
  }

  return { categories, isOnboarding: onboarding, date };
}
