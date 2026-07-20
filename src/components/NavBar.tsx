"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/scoring", label: "Оценка" },
  { href: "/tasks", label: "Задачи" },
  { href: "/system-tasks", label: "Системные задачи" },
  { href: "/violations", label: "Нарушения" },
  { href: "/appeals", label: "Апелляции" },
  { href: "/handbook", label: "Регламент" },
  { href: "/dashboard", label: "Отчёт" },
  { href: "/confidence", label: "Уверенность AI" },
  { href: "/mailing-report", label: "Рассылки" },
  { href: "/reconcile", label: "Сверка" },
  { href: "/work-report", label: "Отчёт по работе" },
  { href: "/messages", label: "Сообщения" },
];

export default function NavBar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="bg-white border-b border-gray-200 no-print">
      {/* Панель переносится на вторую строку, а не растягивает страницу вширь:
          на 14" ноутбуке все 12 разделов + почта помещаются без горизонтальной
          прокрутки всей платформы (жалоба «приходится двигать вправо-влево»). */}
      <div className="max-w-screen-2xl mx-auto px-4 min-h-12 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-gray-900 shrink-0">OneBusiness QA</span>
        <nav className="flex flex-wrap items-center gap-1 min-w-0">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-2.5 py-1 rounded text-sm font-medium whitespace-nowrap ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-gray-500 shrink-0">
          <span className="hidden sm:inline truncate max-w-[180px]">{email}</span>
          <button onClick={logout} className="btn-secondary">
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
