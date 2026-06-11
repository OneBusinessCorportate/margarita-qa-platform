import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSession } from "@/lib/session";

// Server-side gate as defence-in-depth (middleware already redirects).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <NavBar email={session.email} />
      <main className="max-w-7xl mx-auto px-4 py-4">{children}</main>
    </div>
  );
}
