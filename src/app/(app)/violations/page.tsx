import ViolationsPanel from "@/components/ViolationsPanel";
import { listAccountants, listChats, listViolations } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ViolationsPage() {
  const [accountants, chats, violations] = await Promise.all([
    listAccountants(),
    listChats(),
    listViolations(),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Нарушения</h1>
        <p className="text-sm text-gray-500">
          Журнал нарушений по критичным чатам: дата, бухгалтер, клиент, тип
          нарушения, санкция и комментарий. Новая запись — в нижней строке.
        </p>
      </div>
      <ViolationsPanel
        accountants={accountants.map((a) => a.name)}
        chats={chats}
        initialViolations={violations.slice(0, 200)}
      />
    </div>
  );
}
