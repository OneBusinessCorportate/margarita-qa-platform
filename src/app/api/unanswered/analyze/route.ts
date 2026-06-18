import { NextResponse } from "next/server";
import { getAnthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseVerdicts,
  selectFewShot,
  VERDICTS_SCHEMA,
} from "@/lib/unanswered";
import {
  getUnansweredCandidates,
  listUnansweredLabels,
  recordUnansweredVerdicts,
} from "@/lib/repo";

export const dynamic = "force-dynamic";
// Batched LLM pass over chats can take a while; allow headroom on the host.
export const maxDuration = 120;

/**
 * Analyze candidate chats (client wrote last, recent, last message not yet
 * judged) with an LLM, learning from Margarita's past ✔/✘. Batched into a single
 * structured-output request to control cost/latency. Body (optional):
 *   { limit?: number, days?: number }
 */
export async function POST(req: Request) {
  const client = getAnthropic();
  if (!client) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the host." },
      { status: 503 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const limit = Math.min(Math.max(Number(body?.limit) || 40, 1), 60);
  const days = Math.min(Math.max(Number(body?.days) || 14, 1), 60);

  const candidates = await getUnansweredCandidates(limit, days);
  if (candidates.length === 0) {
    return NextResponse.json({ analyzed: 0, recorded: 0, message: "Нет новых чатов для анализа." });
  }

  const labels = await listUnansweredLabels(60);
  const system = buildSystemPrompt(selectFewShot(labels));
  const user = buildUserPrompt(candidates);

  let text = "";
  try {
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VERDICTS_SCHEMA },
      },
      system,
      messages: [{ role: "user", content: user }],
    } as any);
    const block = resp.content.find((b: any) => b.type === "text") as any;
    text = block?.text ?? "";
  } catch (e: any) {
    return NextResponse.json(
      { error: `LLM request failed: ${e?.message ?? String(e)}` },
      { status: 502 }
    );
  }

  const verdicts = parseVerdicts(text);
  const recorded = await recordUnansweredVerdicts(verdicts, candidates);

  return NextResponse.json({
    analyzed: candidates.length,
    recorded,
    flagged: verdicts.filter((v) => v.unanswered).length,
    cleared: verdicts.filter((v) => !v.unanswered).length,
  });
}
