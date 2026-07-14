import { listChats, listChatMailings, listAccountants } from "@/lib/repo";
import {
  buildMailingCompliance,
  type ComplianceChatInput,
  type ComplianceMailingInput,
} from "@/lib/mailing-compliance";
import { buildMailingComplianceMessage } from "@/lib/templates";
import { currentYerevanPeriod } from "@/lib/mailings-run";
import CopyButton from "@/components/CopyButton";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

/** "202607" → "07.2026" */
function periodLabel(p: string): string {
  return `${p.slice(4, 6)}.${p.slice(0, 4)}`;
}

export default async function MailingReportPage({
  searchParams,
}: {
  searchParams: { period?: string; accountant?: string };
}) {
  const period = /^\d{6}$/.test(searchParams.period ?? "")
    ? (searchParams.period as string)
    : currentYerevanPeriod();

  const [chats, mailings, accountants] = await Promise.all([
    listChats(),
    listChatMailings(period),
    listAccountants(),
  ]);

  const roster = accountants
    .filter((a) => a.active && a.role === "accountant")
    .map((a) => a.name);

  const chatInputs: ComplianceChatInput[] = chats.map((c) => ({
    agr_no: c.agr_no,
    accountant: c.accountant,
    status: c.status,
    client: c.chat_name ?? c.name_agr ?? c.agr_no,
    contract: c.agr_no,
    chat_link: c.chat_link,
  }));
  const mailingInputs: ComplianceMailingInput[] = mailings.map((m) => ({
    agr_no: m.agr_no,
    category: m.category,
    status: m.status,
    source: m.source,
    confirmed: m.confirmed,
    confirmed_by: m.confirmed_by,
    confirmed_at: m.confirmed_at,
    detected_at: m.detected_at,
  }));

  const filterAcc = searchParams.accountant || undefined;
  const rosterForBuild = filterAcc ? [filterAcc] : roster;
  const report = buildMailingCompliance(chatInputs, mailingInputs, period, {
    roster: rosterForBuild,
  });
  const message = buildMailingComplianceMessage(report, { periodLabel: periodLabel(period) });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Отчёт по рассылкам</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Соответствие рассылок по бухгалтерам за цикл — уникальные применимые
          чаты по каждой стадии. Подтверждение Маргариты приоритетнее авто; каждый
          счётчик разворачивается до точного списка чатов. Неактивные клиенты
          исключены.
        </p>
      </div>

      <form className="card p-3 flex flex-wrap gap-3 items-end no-print" method="get">
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Период (YYYYMM)</span>
          <input className="input" name="period" defaultValue={period} placeholder="202607" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Бухгалтер</span>
          <select className="input" name="accountant" defaultValue={filterAcc ?? ""}>
            <option value="">Все</option>
            {roster.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary" type="submit">Показать</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {report.perAccountant.filter((a) => a.categories.some((c) => c.statuses.length)).length === 0 ? (
            <div className="card p-4 text-sm text-gray-500">
              Нет данных по рассылкам за период {periodLabel(period)}.
            </div>
          ) : (
            report.perAccountant
              .filter((a) => a.categories.some((c) => c.statuses.length))
              .map((acc) => (
                <div key={acc.accountant} className="card p-3 space-y-2">
                  <div className="font-semibold text-gray-800">
                    {acc.accountant}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      активных чатов: {acc.totalChats}
                    </span>
                  </div>
                  {acc.categories
                    .filter((c) => c.statuses.length > 0)
                    .map((cat) => (
                      <div key={cat.category} className="border-t border-gray-100 pt-2">
                        <div className="text-sm font-medium text-gray-700">{cat.label}</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {cat.statuses.map((s) => (
                            <details key={s.status} className="rounded border border-gray-200 bg-gray-50">
                              <summary className="cursor-pointer select-none px-2 py-1 text-xs">
                                {s.status} — <span className="font-semibold tabular-nums">{s.count}</span>
                              </summary>
                              <div className="px-2 py-1 max-h-64 overflow-y-auto">
                                <table className="w-full text-[11px]">
                                  <thead className="text-gray-400">
                                    <tr>
                                      <th className="text-left pr-2">Клиент</th>
                                      <th className="text-left pr-2">Договор</th>
                                      <th className="text-left pr-2">Чат</th>
                                      <th className="text-left pr-2">Статус</th>
                                      <th className="text-left">Подтв.</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.chats.map((c) => (
                                      <tr key={c.agr_no} className="border-t border-gray-100">
                                        <td className="pr-2">{c.client ?? "—"}</td>
                                        <td className="pr-2">{c.contract ?? "—"}</td>
                                        <td className="pr-2">
                                          {c.chat_link ? (
                                            <a href={c.chat_link} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">чат</a>
                                          ) : "—"}
                                        </td>
                                        <td className="pr-2">{c.status}</td>
                                        <td>{c.confirmed ? "✓ Маргарита" : "авто"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ))
          )}
        </div>

        <div className="space-y-2">
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">📨 Для Telegram</div>
              <CopyButton label="Копировать" className="btn-primary !py-0.5 !px-2 text-xs" text={message} />
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{message}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
