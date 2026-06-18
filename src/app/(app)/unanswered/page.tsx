import UnansweredPanel from "@/components/UnansweredPanel";
import { listUnansweredQueue, type UnansweredMode } from "@/lib/repo";

export const dynamic = "force-dynamic";

// «Без ответа» page. Detection is the canonical QA/SLA logic (working-hours clock,
// meaningful/strong request, substantive staff reply, closing/nudge rules). Shows
// only chats WE owe a reply on, longest wait first; ★ keeps one «на контроле».
export default async function UnansweredPage({
  searchParams,
}: {
  searchParams: { mode?: string };
}) {
  const valid: UnansweredMode[] = ["unanswered", "watched"];
  const mode = (valid.includes(searchParams.mode as UnansweredMode)
    ? searchParams.mode
    : "unanswered") as UnansweredMode;

  const { items, counts } = await listUnansweredQueue(mode);
  return <UnansweredPanel items={items} counts={counts} mode={mode} />;
}
