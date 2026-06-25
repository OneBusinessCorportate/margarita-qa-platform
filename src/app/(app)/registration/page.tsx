import RegistrationPanel from "@/components/RegistrationPanel";
import { listAccountants, listManagerEvaluations } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function RegistrationPage() {
  const [accountants, evaluations] = await Promise.all([
    listAccountants(),
    listManagerEvaluations(),
  ]);

  // Manager suggestions: names already used in the journal + non-accountant
  // specialists (registration managers). Free text is allowed regardless.
  const used = evaluations.map((e) => e.manager);
  const specialists = accountants
    .filter((a) => a.role !== "accountant")
    .map((a) => a.name);
  const managers = Array.from(new Set([...used, ...specialists])).sort();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Регистрация — еженедельная оценка</h1>
        <p className="text-sm text-gray-500">
          Одна оценка на менеджера в неделю. Старт 100 баллов, минус штрафы.
        </p>
        <div className="mt-1 text-xs text-gray-400 space-y-0.5">
          <div>📋 Отдел продаж: <span className="font-medium text-gray-600">Рипсиме, Шогер</span> — оценка индивидуальная</div>
          <div>📋 Отдел регистрации: <span className="font-medium text-gray-600">общий аккаунт</span> — оценка общая</div>
        </div>
      </div>
      <RegistrationPanel
        managers={managers}
        initialEvaluations={evaluations.slice(0, 200)}
      />
    </div>
  );
}
