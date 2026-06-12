// Config for the "Нарушения" log (item 6). Derived from her "Нарушения" tab.
// Free text is allowed everywhere; these lists just drive the dropdowns.
export const VIOLATION_SEVERITIES = ["Среднее", "Критичное", "Грубое"] as const;

// Сервисные нарушения — common service-violation descriptions.
// TODO(margarita): extend / adjust this vocabulary as needed.
export const VIOLATION_TYPES = [
  "Нет расс. по Долгу",
  "Долгий ответ",
  "Незакрытый запрос клиента / ощущение незавершённой работы",
  "Игнорирование задач",
  "Нет ответа на упоминание",
  "Некорректный ответ",
  "Не отправлена рассылка",
  "Другое",
] as const;

// Грубые нарушения — gross violations (their own vocabulary).
export const GROSS_VIOLATION_TYPES = [
  "Игнорирование задач",
  "Грубость / некорректное общение с клиентом",
  "Дезинформация клиента",
  "Срыв сроков по вине бухгалтера",
  "Потеря клиента",
  "Другое (грубое)",
] as const;

/** All violation-type suggestions for a given severity. */
export function violationTypeOptions(severity?: string): readonly string[] {
  if (severity === "Грубое") return GROSS_VIOLATION_TYPES;
  return VIOLATION_TYPES;
}

