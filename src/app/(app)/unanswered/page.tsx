import { redirect } from "next/navigation";

// «Без ответа» как QA-концепция удалена (задача: убрать функциональность
// «Без ответа» полностью). Старый маршрут больше не показывает страницу —
// безопасно перенаправляем на «Отчёт», чтобы не оставлять битую ссылку.
export const dynamic = "force-dynamic";

export default function RemovedUnansweredPage() {
  redirect("/dashboard");
}
