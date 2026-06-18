import UnansweredPanel from "@/components/UnansweredPanel";
import { listLateAnswers, listUnansweredQueue } from "@/lib/repo";

export const dynamic = "force-dynamic";

// «Без ответа»: the chats we owe a reply on + recent late answers (client waited
// past SLA but got a reply). Canonical QA/SLA logic. Dead-simple list.
export default async function UnansweredPage() {
  const [{ items }, late] = await Promise.all([
    listUnansweredQueue("unanswered"),
    listLateAnswers(),
  ]);
  return <UnansweredPanel items={items} late={late} />;
}
