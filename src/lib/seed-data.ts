// ---------------------------------------------------------------------------
// Seed data derived from Margarita's real Google Sheet (accountants from the
// "Правила" tab; chats / statuses from "Чаты" / "Тех" / "Задачи"). Used by the
// in-memory mock store and scripts/seed.ts. Replace with a full import via
// scripts/import-xlsx.ts when migrating the real history.
// ---------------------------------------------------------------------------

import type { Accountant, Chat, Evaluation, Task } from "./types";
import { bandFor, computeOverall } from "./scoring";

export const seedAccountants: Accountant[] = [
  { name: "Գայանե", active: true, role: "accountant" },
  { name: "Լիլիթ", active: true, role: "accountant" },
  { name: "Նաիրա", active: true, role: "accountant" },
  { name: "Լիլիթ Ք․", active: true, role: "accountant" },
  { name: "Օլյա", active: true, role: "accountant" },
  { name: "Ավագ", active: true, role: "accountant" },
  { name: "Ստելլա", active: true, role: "accountant" },
  { name: "Թագուհի", active: true, role: "accountant" },
  { name: "Հասմիկ", active: true, role: "accountant" },
  { name: "Նաիրա Մ․", active: true, role: "accountant" },
  { name: "Էմիլյա", active: true, role: "accountant" },
  { name: "Սոնա", active: true, role: "accountant" },
  { name: "Գայանե Դ․", active: true, role: "accountant" },
  { name: "Mane Lawer", active: true, role: "other-specialist" },
  { name: "Gohar Registration", active: true, role: "other-specialist" },
  { name: "Manager", active: true, role: "other-specialist" },
];

export const seedManagers = ["Մարգարիտա", "Գայանե", "Նաիրա", "Ստելլա"];

function chat(
  agr_no: string,
  name_agr: string,
  hvhh: string,
  accountant: string | null,
  debts: string,
  link: string,
  status: "Active" | "Inactive" = "Active"
): Chat {
  return {
    agr_no,
    hvhh,
    name_agr,
    name_tax: name_agr,
    status,
    tax_activation_date: "2024-05-12",
    chat_name: name_agr,
    chat_link: link,
    accountant,
    manager: accountant,
    debts,
    created_date: "2025-01-01",
  };
}

export const seedChats: Chat[] = [
  chat("59", "ИП Фролкин Владимир N B-3932 RU", "23357581", "Գայանե", "30000", "https://web.telegram.org/a/#-4983666095"),
  chat("23", "ИП Дмитрий Родичев N-23 RU", "40113062", "Լիլիթ", "нет долга", "https://web.telegram.org/a/#-4014170511"),
  chat("19", "ИП Виталий Самарцев N-19 RU", "71064197", "Գայանե", "нет долга", "https://web.telegram.org/a/#-4018402264"),
  chat("33", "ИП Тимофей Кабанов N-33 RU", "72961955", "Լիլիթ", "нет долга", "https://web.telegram.org/a/#-4199207502"),
  chat("11", "Мишт Тей OOO N-11 RU", "40130903", "Նաիրա", "нет долга", "https://web.telegram.org/a/#-4082607480"),
  chat("100", "ИП Кирилл Оболдин N-1101 RU", "10000100", "Լիլիթ", "24000", "https://web.telegram.org/a/#-4086698328"),
  chat("102", "Ретейл Софт ООО - OneBusiness N-102 RU", "10000102", "Նաիրա", "86000", "https://web.telegram.org/a/#-4022409024"),
  chat("28", "АЕОН Девелопмент", "10000028", "Ստելլա", "100000", "https://web.telegram.org/a/?account=2#-5184209470"),
  chat("180", "ООО Пар Груп N-180 RU", "10000180", "Ավագ", "18000", "https://web.telegram.org/a/#-4173746570"),
  chat("220", "ИП Никита Капишников N-220 RU", "10000220", "Ավագ", "72000", "https://web.telegram.org/a/#-4194805297"),
  chat("336", "ИП Сурбине Арушанян N-336 RU", "10000336", "Հասմիկ", "нет долга", "https://web.telegram.org/a/#-4061368619"),
  chat("368", "Норк Вью Кондоминиум N-368 RU", "10000368", "Նաիրա", "30000", "https://web.telegram.org/a/#-4520708494"),
  chat("510", "ИП Андрей Голубков N-510 RU", "10000510", "Լիլիթ Ք․", "нет долга", "https://web.telegram.org/a/#-4175286619"),
  chat("700", "ООО Вектор N-700 RU", "10000700", null, "нет долга", "https://web.telegram.org/a/#-4500000700"),
];

const M = (status: string, prev = "--") => ({ status, prev });

function evalRow(
  id: string,
  chat_agr_no: string,
  accountant: string,
  checking_date: string,
  criteria: { accuracy: number; sla: number },
  monthly: {
    main_taxes: string;
    salary: string;
    primary_docs: string;
    debts: string;
  },
  comment: string,
  override?: number
): Evaluation {
  const monthlyMap = {
    main_taxes: M(monthly.main_taxes),
    salary: M(monthly.salary),
    primary_docs: M(monthly.primary_docs),
    debts: M(monthly.debts),
  };
  const total =
    typeof override === "number"
      ? override
      : computeOverall(criteria, monthlyMap);
  return {
    id,
    chat_agr_no,
    period: checking_date.slice(0, 7).replace("-", ""),
    checking_date,
    accountant,
    scores: { criteria, monthly: monthlyMap },
    total_score: total,
    quality_band: bandFor(total),
    comment,
    created_at: `${checking_date}T09:00:00.000Z`,
  };
}

const D = "2026-06-11";
const Dy = "2026-06-10";

export const seedEvaluations: Evaluation[] = [
  evalRow("e1", "59", "Գայանե", D, { accuracy: 5, sla: 5 }, { main_taxes: "Предстоящая", salary: "Получил", primary_docs: "Получил", debts: "1ый написал" }, "Всё в срок."),
  evalRow("e2", "23", "Լիլիթ", D, { accuracy: 5, sla: 5 }, { main_taxes: "Предстоящая", salary: "Получил", primary_docs: "Получил", debts: "нет долга" }, ""),
  evalRow("e3", "11", "Նաիրա", D, { accuracy: 4, sla: 4 }, { main_taxes: "Предстоящая", salary: "Не запросил 1", primary_docs: "Получил", debts: "нет долга" }, "Зарплату не запросил вовремя."),
  evalRow("e4", "100", "Լիլիթ", D, { accuracy: 3, sla: 3 }, { main_taxes: "Предстоящая", salary: "Получил", primary_docs: "Получил", debts: "Не написал 2" }, "По долгам молчит."),
  evalRow("e5", "180", "Ավագ", D, { accuracy: 1, sla: 1 }, { main_taxes: "Предстоящая", salary: "Получил", primary_docs: "Не запросил 1", debts: "Не написал 2" }, "Критично: первичка не запрошена.", 23),
  evalRow("e6", "336", "Հասմիկ", D, { accuracy: 5, sla: 4 }, { main_taxes: "Предстоящая", salary: "Получил", primary_docs: "Получил", debts: "нет долга" }, ""),
  evalRow("e7", "102", "Նաիրա", Dy, { accuracy: 4, sla: 5 }, { main_taxes: "Отправил", salary: "Получил", primary_docs: "Получил", debts: "Не написал 2" }, "Вчерашняя оценка."),
  evalRow("e8", "28", "Ստելլա", D, { accuracy: 2, sla: 2 }, { main_taxes: "Предстоящая", salary: "Не запросил 1", primary_docs: "Получил", debts: "Не написал 2" }, "Слабо.", 47),
];

function task(
  id: string,
  chat_agr_no: string,
  accountant: string,
  description: string,
  due_original: string,
  status: Task["task_status"],
  completed_at: string | null,
  due_postponed: string | null = null,
  result: string | null = null
): Task {
  return {
    id,
    chat_agr_no,
    type: "single",
    category: null,
    status: null,
    prev_status: null,
    due_date_original: due_original,
    due_date_postponed: due_postponed,
    completed_at,
    priority: "Medium",
    description,
    result,
    task_status: status,
    accountant,
    checking_date: D,
    period: "202606",
  };
}

export const seedTasks: Task[] = [
  task("t1", "59", "Գայանե", "example", "2026-06-10", "Completed (Late)", "2026-06-12", "2026-06-11"),
  task("t2", "23", "Լիլիթ", "Registered for work permit", "2026-06-13", "Completed (On Time)", "2026-06-13"),
  task("t3", "11", "Նաիրա", "Call", "2026-06-07", "Completed (Late)", "2026-06-08", "2026-06-08"),
  task("t4", "220", "Ավագ", "call/no update", "2026-06-17", "Overdue", null, "2026-06-20"),
  task("t5", "368", "Նաիրա", "Встреча", "2026-06-16", "Cancelled", null, null, "Cancelled"),
];
