import { redirect } from "next/navigation";

// Страница «Регистрация» (еженедельный журнал QA менеджеров) удалена по задаче.
// Старый маршрут не показывает страницу — безопасно перенаправляем на «Отчёт»,
// чтобы не оставлять битую ссылку.
export const dynamic = "force-dynamic";

export default function RemovedRegistrationPage() {
  redirect("/dashboard");
}
