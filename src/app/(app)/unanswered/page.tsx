import UnansweredPanel from "@/components/UnansweredPanel";
import { listUnansweredQueue } from "@/lib/repo";

export const dynamic = "force-dynamic";

// «Без ответа»: the chats we owe a reply on (canonical QA/SLA logic), longest
// wait first. Dead-simple list.
export default async function UnansweredPage() {
  const { items } = await listUnansweredQueue("unanswered");
  return <UnansweredPanel items={items} />;
}
