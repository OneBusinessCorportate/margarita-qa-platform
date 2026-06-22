"use client";

import { useState } from "react";

export default function CopyButton({
  text,
  label = "Копировать",
  className = "btn-secondary",
  title,
}: {
  text: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={copy} className={className} title={title}>
      {copied ? "Скопировано ✓" : label}
    </button>
  );
}
