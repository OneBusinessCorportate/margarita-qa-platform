/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdfkit loads its font data files from node_modules at runtime — keep it
    // external so the server bundle doesn't strip them (PDF report routes).
    serverComponentsExternalPackages: ["pdfkit"],
    // Не переиспользовать клиентский Router Cache для динамических страниц: отчёт
    // и другие force-dynamic страницы всегда должны дотягивать свежие данные при
    // переходе по ссылке, а не показывать пре-фетч копию. Без этого дашборд
    // «отставал» и показывал устаревшие цифры до ручного обновления.
    staleTimes: { dynamic: 0, static: 0 },
  },
};

export default nextConfig;
