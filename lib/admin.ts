export async function adminCall(
  action: string,
  payload?: any
) {
  const res = await fetch("/api/gas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      payload,
      email: localStorage.getItem("admin") || ""
    })
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Admin API failed");
  }

  return data.data;
}