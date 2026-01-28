export async function adminCall(
  path: string,
  payload?: any
) {

  const email =
    localStorage.getItem("admin");

  if (!email) {
    throw new Error("Not logged in");
  }

  const res = await fetch("/api/gas", {
    method: "POST",

    headers: {
      "content-type": "application/json"
    },

    body: JSON.stringify({
      email,
      path,
      payload
    })
  });

  if (!res.ok) {
    throw new Error("Request failed");
  }

  return res.json();
}