import { listChats } from "@/lib/repo";
import { computeChatHealth, type ReconcileRow } from "@/lib/chat-reconcile";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const chats = await listChats();
  const rows: ReconcileRow[] = chats.map((c) => ({
    agr_no: c.agr_no,
    chat_link: c.chat_link,
    chat_name: c.chat_name,
    accountant: c.accountant,
    status: c.status,
    name_agr: c.name_agr,
  }));
  const h = computeChatHealth(rows);

  const stat = (label: string, value: number, alert = false) => (
    <div className="card p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${alert && value > 0 ? "text-red-600" : "text-gray-900"}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Сверка чатов</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Диагностика реестра чатов: пропущенные договоры, отсутствие
          ответственного, чаты без ссылки и дублирующие привязки. Так недостающие
          и «сломанные» чаты видны сразу, а не теряются молча.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stat("Всего чатов", h.total)}
        {stat("Активных", h.active)}
        {stat("Неактивных", h.inactive)}
        {stat("Без № договора (TG-)", h.withoutContract, true)}
        {stat("Без бухгалтера", h.withoutAccountant, true)}
        {stat("Без ссылки на чат", h.withoutLink, true)}
        {stat("Дубли привязки чата", h.duplicateChatIds, true)}
      </div>

      <div className="card overflow-x-auto">
        <table className="qa dense">
          <thead>
            <tr>
              <th>№ договора</th>
              <th>Чат</th>
              <th>Проблема</th>
            </tr>
          </thead>
          <tbody>
            {h.issues.length === 0 ? (
              <tr><td colSpan={3} className="text-sm text-gray-500 p-3">Проблем не найдено ✅</td></tr>
            ) : (
              h.issues.map((it, i) => (
                <tr key={i}>
                  <td className="text-xs">{it.agr_no ?? "—"}</td>
                  <td className="text-xs">
                    {it.chat_link ? (
                      <a href={it.chat_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
                        {it.chat_link}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="text-xs text-gray-700">{it.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
