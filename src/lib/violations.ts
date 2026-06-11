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
