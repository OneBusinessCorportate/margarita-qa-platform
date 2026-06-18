import UnansweredPanel from "@/components/UnansweredPanel";
import { listUnansweredQueue, type UnansweredMode } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Dedicated «Без ответа» page. AI lists chats with an unfinished communication
// (in either direction — including when the accountant asked and we're waiting on
// the client), worst wait first. Margarita confirms ✔/✘, marks chats «на
// контроле» to follow up, and the model learns — replacing her manual
// unread→mark→recheck loop.
export default async function UnansweredPage({
  searchParams,
}: {
  searchParams: { mode?: string };
}) {
  const valid: UnansweredMode[] = ["staff", "client", "watched", "all"];
  const mode = (valid.includes(searchParams.mode as UnansweredMode)
    ? searchParams.mode
    : "staff") as UnansweredMode;

  const { items, counts } = await listUnansweredQueue(mode);
  const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <UnansweredPanel items={items} counts={counts} mode={mode} aiEnabled={aiEnabled} />
  );
}
