"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Filters {
  from?: string;
  to?: string;
  accountant?: string;
  client?: string;
}

// Saves the current Отчёт (for the active filters) into the site's history.
export default function SaveReportButton({ filters }: { filters: Filters }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/report-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Ошибка ${res.status}`);
      }
      setState("saved");
      router.refresh(); // show the new entry in the history list
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setState("idle");
      const msg = e instanceof Error ? e.message : "Попробуйте ещё раз.";
      alert(`Не удалось сохранить отчёт: ${msg}`);
    }
  }

  return (
    <button className="btn-primary" onClick={save} disabled={state === "saving"}>
      {state === "saving"
        ? "Сохранение…"
        : state === "saved"
          ? "Сохранено ✓"
          : "💾 Сохранить в историю"}
    </button>
  );
}
