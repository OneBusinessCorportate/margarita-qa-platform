"use client";

export default function PrintComparisonButton() {
  function handlePrint() {
    document.body.classList.add("print-comparison-mode");
    window.print();
    const cleanup = () => {
      document.body.classList.remove("print-comparison-mode");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
  }

  return (
    <button className="btn-secondary !py-0.5 !px-2 text-xs" onClick={handlePrint}>
      📄 PDF
    </button>
  );
}
