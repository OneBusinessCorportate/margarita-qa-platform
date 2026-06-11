// ---------------------------------------------------------------------------
// Sample seed data (~10 chats) matching the shapes documented in the build
// brief / source sheet. Used by:
//   - the in-memory mock store (when Supabase is not configured), and
//   - scripts/seed.ts (to populate a real Supabase instance).
//
// If an Excel export is dropped into /data later, replace this with an import.
// TODO(margarita): swap sample rows for the real sheet export.
// ---------------------------------------------------------------------------

import type { Accountant, Chat, Evaluation, Task } from "./types";
import { bandFor, computeWeightedTotal } from "./scoring";

export const seedAccountants: Accountant[] = [
  { name: "Գայանե", active: true, role: "accountant" },
  { name: "Լիլիթ", active: true, role: "accountant" },
  { name: "Նաիրա", active: true, role: "accountant" },
  { name: "Արմինե", active: true, role: "accountant" },
  { name: "Տիգրան", active: true, role: "accountant" },
  { name: "Սյուզաննա", active: false, role: "dismissed" },
  { name: "Հասմիկ", active: true, role: "other-specialist" },
];

export const seedManagers = ["Մարգարիտա", "Արամ", "Դավիթ"];

export const seedChats: Chat[] = [
  {
    agr_no: "59",
    hvhh: "01234567",
    name_agr: "ԱՐՄ ՏՐԵՅԴ ՍՊԸ",
    name_tax: "ARM TRADE LLC",
    status: "Active",
    tax_activation_date: "2024-02-01",
    chat_name: "ARM TRADE — бухгалтерия",
    chat_link: "https://t.me/armtrade_chat",
    accountant: "Գայանե",
    manager: "Մարգարիտա",
    debts: "нет долга",
    created_date: "2024-01-15",
  },
  {
    agr_no: "B-3302",
    hvhh: "02345678",
    name_agr: "ԲԻԶՆԵՍ ՊԼՅՈՒՍ ՍՊԸ",
    name_tax: "BUSINESS PLUS LLC",
    status: "Active",
    tax_activation_date: "2023-11-10",
    chat_name: "Business Plus chat",
    chat_link: "https://t.me/bplus_chat",
    accountant: "Լիլիթ",
    manager: "Արամ",
    debts: "150000 AMD",
    created_date: "2023-10-01",
  },
  {
    agr_no: "104",
    hvhh: "03456789",
    name_agr: "ՆՈՐ ՀՈՐԻԶՈՆ ՍՊԸ",
    name_tax: "NEW HORIZON LLC",
    status: "Active",
    tax_activation_date: "2024-03-05",
    chat_name: "New Horizon — учёт",
    chat_link: "https://t.me/newhorizon_chat",
    accountant: "Նաիրա",
    manager: "Մարգարիտա",
    debts: "нет долга",
    created_date: "2024-02-20",
  },
  {
    agr_no: "212",
    hvhh: "04567890",
    name_agr: "ԷՅ ԷՄ ՍԵՐՎԻՍ ՍՊԸ",
    name_tax: "AM SERVICE LLC",
    status: "Active",
    tax_activation_date: "2024-01-20",
    chat_name: "AM Service chat",
    chat_link: "https://t.me/amservice_chat",
    accountant: "Արմինե",
    manager: "Դավիթ",
    debts: "75000 AMD",
    created_date: "2024-01-05",
  },
  {
    agr_no: "B-3410",
    hvhh: "05678901",
    name_agr: "ԿԱՊԻՏԱԼ ԳՐՈՒՊ ՍՊԸ",
    name_tax: "CAPITAL GROUP LLC",
    status: "Active",
    tax_activation_date: "2023-09-15",
    chat_name: "Capital Group — бухгалтер",
    chat_link: "https://t.me/capitalgroup_chat",
    accountant: "Տիգրան",
    manager: "Արամ",
    debts: "нет долга",
    created_date: "2023-08-30",
  },
  {
    agr_no: "318",
    hvhh: "06789012",
    name_agr: "ԳՐԻՆ ՖԵՐՄ ՍՊԸ",
    name_tax: "GREEN FARM LLC",
    status: "Inactive",
    tax_activation_date: null,
    chat_name: "Green Farm chat",
    chat_link: "https://t.me/greenfarm_chat",
    accountant: "Գայանե",
    manager: "Մարգարիտա",
    debts: "--",
    created_date: "2023-12-12",
  },
  {
    agr_no: "401",
    hvhh: "07890123",
    name_agr: "ՍՄԱՐՏ ՍՈԼՅՈՒՇՆՍ ՍՊԸ",
    name_tax: "SMART SOLUTIONS LLC",
    status: "Active",
    tax_activation_date: "2024-04-01",
    chat_name: "Smart Solutions — учёт",
    chat_link: "https://t.me/smartsol_chat",
    accountant: "Լիլիթ",
    manager: "Դավիթ",
    debts: "320000 AMD",
    created_date: "2024-03-18",
  },
  {
    agr_no: "B-3511",
    hvhh: "08901234",
    name_agr: "ՕՐԱՆԺ ՌԵԹԵՅԼ ՍՊԸ",
    name_tax: "ORANGE RETAIL LLC",
    status: "Active",
    tax_activation_date: "2024-02-14",
    chat_name: "Orange Retail chat",
    chat_link: "https://t.me/orangeretail_chat",
    accountant: "Նաիրա",
    manager: "Մարգարիտա",
    debts: "нет долга",
    created_date: "2024-01-28",
  },
  {
    agr_no: "523",
    hvhh: "09012345",
    name_agr: "ՎԵԿՏՈՐ ՍՊԸ",
    name_tax: "VECTOR LLC",
    status: "Active",
    tax_activation_date: "2024-05-02",
    chat_name: "Vector — бухгалтерия",
    chat_link: "https://t.me/vector_chat",
    accountant: null, // no responsible accountant -> counts as "без ответственных"
    manager: "Արամ",
    debts: "нет долга",
    created_date: "2024-04-22",
  },
  {
    agr_no: "B-3620",
    hvhh: "10123456",
    name_agr: "ՊՐԵՄԻՈՒՄ ՖՈՒԴ ՍՊԸ",
    name_tax: "PREMIUM FOOD LLC",
    status: "Active",
    tax_activation_date: "2024-03-30",
    chat_name: "Premium Food chat",
    chat_link: "https://t.me/premiumfood_chat",
    accountant: "Արմինե",
    manager: "Դավիթ",
    debts: "45000 AMD",
    created_date: "2024-03-10",
  },
];

// A small set of evaluations dated "today-ish" so the dashboard has content.
// total_score / quality_band are derived to keep data self-consistent.
function evalRow(
  id: string,
  chat: string,
  accountant: string,
  date: string,
  criteria: { accuracy: number; sla: number; fcr: number; clarity: number },
  comment: string
): Evaluation {
  const total = computeWeightedTotal(criteria);
  return {
    id,
    chat_agr_no: chat,
    period: date.slice(0, 7).replace("-", ""),
    checking_date: date,
    accountant,
    scores: { criteria },
    total_score: total,
    quality_band: bandFor(total),
    comment,
    created_at: `${date}T09:00:00.000Z`,
  };
}

const TODAY = "2026-06-11"; // matches the seed snapshot; dashboard defaults to range

export const seedEvaluations: Evaluation[] = [
  evalRow("e1", "59", "Գայանե", TODAY, { accuracy: 5, sla: 5, fcr: 5, clarity: 5 }, "Отличная работа, всё в срок."),
  evalRow("e2", "B-3302", "Լիլիթ", TODAY, { accuracy: 4, sla: 4, fcr: 4, clarity: 5 }, "Хорошо, мелкие задержки."),
  evalRow("e3", "104", "Նաիրա", TODAY, { accuracy: 3, sla: 3, fcr: 4, clarity: 3 }, "Средне, есть пробелы по срокам."),
  evalRow("e4", "212", "Արմինե", TODAY, { accuracy: 2, sla: 2, fcr: 3, clarity: 3 }, "Много недочётов, требует внимания."),
  evalRow("e5", "B-3410", "Տիգրան", TODAY, { accuracy: 1, sla: 1, fcr: 1, clarity: 2 }, "Критично: сорваны сроки."),
  evalRow("e6", "401", "Լիլիթ", TODAY, { accuracy: 5, sla: 4, fcr: 5, clarity: 4 }, "Очень хорошо."),
  evalRow("e7", "B-3511", "Նաիրա", "2026-06-10", { accuracy: 4, sla: 5, fcr: 4, clarity: 4 }, "Вчерашняя оценка."),
];

export const seedTasks: Task[] = [
  {
    id: "t1",
    chat_agr_no: "59",
    type: "monthly",
    category: "Основные налоги",
    status: "Отправил",
    prev_status: "Предстоящая",
    due_date_original: "2026-06-15",
    due_date_postponed: null,
    completed_at: "2026-06-12",
    priority: 1,
    description: "Сдача основных налогов за май",
    result: "Сдано",
    task_status: "Completed On Time",
  },
  {
    id: "t2",
    chat_agr_no: "B-3302",
    type: "monthly",
    category: "Заработная плата",
    status: "Запросил 1, не получил",
    prev_status: "Не запросил 1",
    due_date_original: "2026-06-10",
    due_date_postponed: "2026-06-13",
    completed_at: null,
    priority: 2,
    description: "Расчёт ЗП",
    result: null,
    task_status: "Late",
  },
  {
    id: "t3",
    chat_agr_no: "104",
    type: "single",
    category: "Первичная документация / очная встреча",
    status: "1ый/2ой написал",
    prev_status: "Не написал 1",
    due_date_original: "2026-06-28",
    due_date_postponed: null,
    completed_at: null,
    priority: 3,
    description: "Очная встреча по первичке",
    result: null,
    task_status: null,
  },
  {
    id: "t4",
    chat_agr_no: "B-3410",
    type: "monthly",
    category: "Долги",
    status: "Не запросил 1",
    prev_status: "--",
    due_date_original: "2026-06-05",
    due_date_postponed: null,
    completed_at: null,
    priority: 1,
    description: "Запрос по долгам",
    result: null,
    task_status: "Overdue",
  },
];

// Default credentials seed note: see AUTH_USERS in .env.example.
