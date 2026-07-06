/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdfkit loads its font data files from node_modules at runtime — keep it
    // external so the server bundle doesn't strip them (PDF report routes).
    serverComponentsExternalPackages: ["pdfkit"],
  },
};

export default nextConfig;
