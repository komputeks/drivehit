import crypto from "crypto";

/* ENV */

export const env = {
  secret: process.env.API_SECRET!,
  admins: process.env.ADMIN_EMAILS!.split(","),
  gas: process.env.GAS_URL!
};

/* SECURITY */

export function sign(data: string) {
  return crypto
    .createHmac("sha256", env.secret)
    .update(data)
    .digest("hex");
}

/* ADMIN CHECK */

export function isAdmin(email?: string | null) {
  if (!email) return false;
  return env.admins.includes(email);
}

/* GAS CLIENT */

export async function callGas(
  path: string,
  body: any
) {
  const ts = Date.now().toString();

  const base = ts + JSON.stringify(body || {});
  const sig = sign(base);

  const res = await fetch(env.gas + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ts": ts,
      "x-sig": sig
    },
    body: JSON.stringify(body)
  });

  return res.json();
}
