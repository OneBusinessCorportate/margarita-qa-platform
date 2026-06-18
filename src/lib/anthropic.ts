import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client for the unanswered-chat classifier. Returns null when
 * ANTHROPIC_API_KEY is not set so the app degrades gracefully (the AI features
 * are disabled, the rule-based unanswered signal keeps working). The key MUST be
 * set on the host (Render dashboard) — see .env.example.
 */
let cached: Anthropic | null | undefined;

export function getAnthropic(): Anthropic | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  cached = apiKey ? new Anthropic({ apiKey }) : null;
  return cached;
}

/** Model + caller conventions for this app, in one place. */
export const CLAUDE_MODEL = "claude-opus-4-8";
