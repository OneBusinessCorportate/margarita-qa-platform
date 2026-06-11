import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA — Оценка качества чатов | OneBusiness",
  description: "Внутренняя платформа оценки качества коммуникаций с клиентами",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
