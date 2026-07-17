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
      <div className="max-w-screen-2xl mx-auto px-4 h-12 flex items-center gap-6">
        <span className="font-semibold text-gray-900">OneBusiness QA</span>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
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
        <div className="ml-auto flex items-center gap-3 text-sm text-gray-500">
          <span>{email}</span>
          <button onClick={logout} className="btn-secondary">
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
