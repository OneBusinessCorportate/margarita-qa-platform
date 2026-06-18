import UnansweredPanel from "@/components/UnansweredPanel";
import { listUnansweredQueue } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Dedicated «Без ответа» page: AI lists chats genuinely awaiting a reply (worst
// wait first); Margarita confirms ✔ or dismisses ✘, and the model learns.
export default async function UnansweredPage() {
  const items = await listUnansweredQueue();
  const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
  return <UnansweredPanel items={items} aiEnabled={aiEnabled} />;
}
