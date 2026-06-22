"use client";

// Exports the report as PDF via the browser's print dialog ("Save as PDF").
// Print CSS (globals.css) hides everything except the report + print header,
// so the PDF is just the QA marks per employee.
export default function ExportPdfButton() {
  return (
    <button className="btn-secondary" onClick={() => window.print()}>
      📄 Экспорт PDF
    </button>
  );
}
