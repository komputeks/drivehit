import crypto from "crypto";

/* ===============================
   ENV
================================ */

function must(name: string) {

  const v = process.env[name];

  if (!v) {
    throw new Error(
      `Missing env: ${name}`
    );
  }

  return v;
}

export const env = {
  gasBase: must("NEXT_PUBLIC_API_BASE_URL"),

  signSecret: must("API_SIGNING_SECRET"),

  readSecret: must("API_READ_SECRET"),

  admins: must("ADMIN_EMAILS").split(","),

  isrSecret: must("NEXTJS_ISR_SECRET")
};


/* ===============================
   HMAC SIGN
================================ */

export function sign(payload: string) {

  return crypto
    .createHmac("sha256", env.signSecret)
    .update(payload)
    .digest("hex");
}

/* ===============================
   ADMIN CHECK
================================ */

export function isAdmin(email?: string | null) {

  if (!email) return false;

  return env.admins.includes(email.trim());
}

/* ===============================
   GAS CALL
================================ */

export async function callGas(
  path: string,
  data: any,
  method: "POST" | "GET" = "POST"
) {

  const ts = Date.now().toString();

  const body = data
    ? JSON.stringify(data)
    : "";

  const base = [
    method,
    path,
    ts,
    body
  ].join("|");

  const sig = sign(base);

  const res = await fetch(
    env.gasBase + path,
    {
      method,

      headers: {
        "content-type": "application/json",

        "x-ts": ts,
        "x-sig": sig,
        "x-read-key": env.readSecret
      },

      body: method === "POST" ? body : undefined
    }
  );

  if (!res.ok) {

    const txt = await res.text();

    throw new Error(
      "GAS error: " + txt
    );
  }

  return res.json();
}

/* ===============================
   ISR TRIGGER
================================ */

export async function triggerISR(path: string) {

  const res = await fetch(
    "/api/revalidate",
    {
      method: "POST",

      headers: {
        "x-secret": env.isrSecret
      },

      body: JSON.stringify({ path })
    }
  );

  return res.ok;
}