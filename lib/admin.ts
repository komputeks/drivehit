// lib/admin.ts
export async function adminCall(action: string, payload?: any) {
  const email = localStorage.getItem("admin") || "";

  const res = await fetch("/api/gas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload, email })
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Admin API failed");
  }

  return data.data;
}