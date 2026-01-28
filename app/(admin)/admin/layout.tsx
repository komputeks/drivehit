import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {

  /* Get cookie store */
  const store = await cookies();

  /* Read admin cookie */
  const admin = store.get("admin");

  /* Not logged in → redirect */
  if (!admin) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">

      <aside className="w-56 p-4 border-r border-slate-800">

        <h2 className="font-bold mb-6">
          DriveHit Admin
        </h2>

        <nav className="space-y-2">

          <Link href="/admin">Dashboard</Link>
          <Link href="/admin/items">Items</Link>
          <Link href="/admin/jobs">Jobs</Link>
          <Link href="/admin/settings">Settings</Link>

        </nav>
      </aside>

      <main className="flex-1 p-6">
        {children}
      </main>

    </div>
  );
}

