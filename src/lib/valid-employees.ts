// ---------------------------------------------------------------------------
// Единый источник правды по действующим сотрудникам (бухгалтерия).
// Список утверждён вручную (14 человек). Всё, чего нет в этом списке, НЕ
// участвует в расчётах дашборда: нарушения, штрафы, бонусы, отчёты.
//
// Имена в источниках пишутся по-разному (армянский / русский / английский,
// сокращения, опечатки вроде «Առփինե»), поэтому каждое каноническое имя несёт
// список алиасов. Сопоставление НЕ агрессивное: неизвестное или неоднозначное
// имя (например «Լիլիթ 2») попадает в «Требует ручной проверки», а не
// приклеивается к похожему сотруднику.
// ---------------------------------------------------------------------------

export interface ValidEmployee {
  /** Полное каноническое имя (как в утверждённом списке). */
  canonical: string;
  /** Короткое имя — ключ в БД платформы (mqa_accountants.name) и в таблицах. */
  short: string;
  /** Все известные написания (армянские сокращения, русский, английский). */
  aliases: string[];
  /** Действующий сотрудник. */
  active: boolean;
  /** Грейд из листа «KPI и результаты» (Май 2026); null — нет данных. */
  role: string | null;
}

// ВАЖНО: `short` должен совпадать с mqa_accountants.name — это FK для чатов.
export const VALID_EMPLOYEES: ValidEmployee[] = [
  {
    canonical: "Գայանե Աբգարյան",
    short: "Գայանե",
    aliases: ["Գայանե", "Гаяне", "Gayane", "Gayane Abgaryan"],
    active: true,
    role: "Ведущий бухгалтер",
  },
  {
    canonical: "Օլյա Հակոբյան",
    short: "Օլյա",
    aliases: ["Օլյա", "Оля", "Olya", "Olya Hakobyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Ստելլա Փաթաթանյան",
    short: "Ստելլա",
    aliases: ["Ստելլա", "Стелла", "Stella", "Stella Patatanyan"],
    active: true,
    role: "Младший бухгалтер",
  },
  {
    canonical: "Նաիրա Զալինյան",
    short: "Նաիրա",
    aliases: ["Նաիրա", "Наира", "Naira", "Naira Zalinian"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Արփինե Ապրեսյան",
    // «Առփինե» — реальная опечатка в mqa_accountants / mqa_chats (Ռ вместо Ր).
    short: "Արփինե",
    aliases: ["Արփինե", "Առփինե", "Арпине", "Arpine"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Թագուհի Ղահրամանյան",
    short: "Թագուհի",
    aliases: ["Թագուհի", "Тагуи", "Тагуги", "Taguhi", "Taguhi Ghahramanyan"],
    active: true,
    role: "Младший бухгалтер",
  },
  {
    canonical: "Ավագ Հայրապետյան",
    short: "Ավագ",
    aliases: ["Ավագ", "Аваг", "Avag", "Avag Hayrapetyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Նաիրա Մխիթարյան",
    short: "Նաիրա Մ․",
    aliases: ["Նաիրա Մ․", "Նաիրա Մ.", "Նաիրա Մ", "Наира М.", "Наира М", "Naira M.", "Naira Mkhitaryan"],
    active: true,
    role: "Ведущий бухгалтер",
  },
  {
    canonical: "Հասմիկ Բադալյան",
    short: "Հասմիկ",
    aliases: ["Հասմիկ", "Асмик", "Хасмик", "Hasmik", "Hasmik Badalyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    // Голая «Լիլիթ» во всех источниках (БД, КК Сопровождение, Excel
    // «Нарушения») идёт ОТДЕЛЬНО от «Լիլիթ Ք․», поэтому детерминированно
    // означает Хосровян. «Լիլիթ 2» сюда НЕ мапится (см. NEEDS_REVIEW).
    canonical: "Լիլիթ Խոսրովյան",
    short: "Լիլիթ",
    aliases: ["Լիլիթ", "Лилит", "Lilit", "Lilit Khosrovyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Դավիթ Ալոյան",
    short: "Դավիթ",
    aliases: ["Դավիթ", "Давид", "Давит", "Davit", "David", "Davit Aloyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Ռոբերտ Թառլանյան",
    short: "Ռոբերտ",
    aliases: ["Ռոբերտ", "Роберт", "Robert", "Robert Tarlanyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Լիլիթ Քյաբաբչյան",
    short: "Լիլիթ Ք․",
    aliases: ["Լիլիթ Ք․", "Լիլիթ Ք.", "Լիլիթ Ք", "Лилит К.", "Лилит К", "Lilit K.", "Lilit Kyababchyan"],
    active: true,
    role: "Бухгалтер",
  },
  {
    canonical: "Արթուր Բարսեղյան",
    short: "Արթուր",
    aliases: ["Արթուր", "Артур", "Artur", "Arthur", "Artur Barseghyan"],
    active: true,
    // В листе «KPI и результаты» строки нет — грейд не выдумываем.
    role: null,
  },
  {
    // Новый бухгалтер (добавлен по отзыву Маргариты, июль 2026).
    canonical: "Մարիաննա",
    short: "Մարիաննա",
    aliases: ["Մարիաննա", "Марианна", "Marianna", "Marianne"],
    active: true,
    role: null,
  },
  {
    // Новый бухгалтер (добавлен по отзыву Маргариты, июль 2026).
    canonical: "Ալիսա",
    short: "Ալիսա",
    aliases: ["Ալիսա", "Алиса", "Alisa", "Alice"],
    active: true,
    role: null,
  },
];

// Имена, которые ВСТРЕЧАЮТСЯ в источниках, но заведомо не действующие
// сотрудники (уволены / другие отделы / служебные значения). Их нарушения и
// оценки исключаются из расчётов и показываются в разделе «Невалидные имена».
export const KNOWN_INVALID_NAMES: string[] = [
  "Արտակ", "Артак", // KPI: «Увольнение»
  "Աիդա", "Аида", // в mqa_accountants: dismissed
  "Սոնա", "Сона", // KPI: «Счетовод», уволена (лист «Проблемы и достижения»)
  "Սաթենիկ", "Сатеник", // KPI: «Увольнение»
  "Տաթև", "Татев",
  "Շուշանիկ", "Шушаник",
  "Անահիտ", "Анаит", // KPI: «Увольнение»
  "Էրիկ", "Эрик", // KPI: «Увольнение»
  "Էմիլյա", "Эмилия", // менеджер CSAT, не бухгалтер списка
  "Գայանե Դ․", "Գայանե Դ.", // другая Гаяне, не Абгарян
  "հանձնված", "Հանձնված", // «передан» — служебная пометка, не человек
  "Mane Lawer", "Gohar Registration", "Manager",
];

// Неоднозначные имена: похоже на сотрудника, но однозначно сопоставить нельзя.
// По листу «Проблемы и достижения» «Лилит - 2» — бухгалтер, с которым
// «больше не продолжаем сотрудничество», то есть это скорее ТРЕТЬЯ Лилит,
// а не Хосровян/Кябабчян. Не гадаем — ручная проверка.
export const NEEDS_REVIEW_NAMES: string[] = [
  "Լիլիթ 2", "Лилит 2", "Лилит - 2", "Лилит-2",
];

/** Служебные "пустые" значения — это не сотрудник, а отсутствие назначения. */
const UNASSIGNED_VALUES = new Set(["", "-", "—", "--", "#n/a", "n/a"]);

/**
 * Нормализация имени для сопоставления: трим, схлопывание пробелов, единый
 * символ точки-сокращения (․ U+2024 / . / ։ U+0589), нижний регистр.
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/[․։]/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const aliasIndex = new Map<string, ValidEmployee>();
for (const emp of VALID_EMPLOYEES) {
  for (const a of [emp.canonical, emp.short, ...emp.aliases]) {
    const key = normalizeName(a);
    const existing = aliasIndex.get(key);
    if (existing && existing !== emp) {
      throw new Error(
        `valid-employees: алиас «${a}» указывает и на ${existing.canonical}, и на ${emp.canonical}`
      );
    }
    aliasIndex.set(key, emp);
  }
}
const invalidIndex = new Set(KNOWN_INVALID_NAMES.map(normalizeName));
const reviewIndex = new Set(NEEDS_REVIEW_NAMES.map(normalizeName));

export type EmployeeResolution =
  | { status: "valid"; employee: ValidEmployee }
  | { status: "invalid"; name: string }
  | { status: "review"; name: string }
  | { status: "unassigned" };

/**
 * Сопоставить произвольное имя из источника с утверждённым списком.
 *  - valid      → один из 14 сотрудников (через алиасы);
 *  - invalid    → заведомо не действующий сотрудник;
 *  - review     → неизвестное/неоднозначное имя, нужна ручная проверка;
 *  - unassigned → пусто / «-» / #N/A — назначения нет.
 */
export function resolveEmployee(raw: string | null | undefined): EmployeeResolution {
  const key = normalizeName(raw);
  if (UNASSIGNED_VALUES.has(key)) return { status: "unassigned" };
  const emp = aliasIndex.get(key);
  if (emp) return { status: "valid", employee: emp };
  if (invalidIndex.has(key)) return { status: "invalid", name: (raw ?? "").trim() };
  if (reviewIndex.has(key)) return { status: "review", name: (raw ?? "").trim() };
  return { status: "review", name: (raw ?? "").trim() };
}

/** true, если имя принадлежит одному из 14 действующих сотрудников. */
export function isValidEmployee(raw: string | null | undefined): boolean {
  return resolveEmployee(raw).status === "valid";
}

/**
 * Каноническое короткое имя (ключ БД) для валидного сотрудника, иначе null.
 * Используется, чтобы «Լիլիթ Ք.» из Excel и «Լիլիթ Ք․» из БД считались одним
 * человеком во всех агрегатах.
 */
export function canonicalShortName(raw: string | null | undefined): string | null {
  const r = resolveEmployee(raw);
  return r.status === "valid" ? r.employee.short : null;
}

/** Найти сотрудника по короткому имени/алиасу. */
export function findEmployee(raw: string | null | undefined): ValidEmployee | null {
  const r = resolveEmployee(raw);
  return r.status === "valid" ? r.employee : null;
}
