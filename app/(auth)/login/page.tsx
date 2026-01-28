"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {

  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function submit() {

  setErr("");

  const res = await fetch("/api/auth", {
    method: "POST",
    body: JSON.stringify({ email })
  });

  if (!res.ok) {
    setErr("Access denied");
    return;
  }

  /* Set cookie via document */
  document.cookie =
    `admin=${email}; path=/; max-age=604800; samesite=lax`;

  router.push("/admin");
}

  return (
    <main className="container max-w-md">

      <h1 className="text-2xl font-bold mb-4">
        Admin Login
      </h1>

      <input
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />

      <button
        onClick={submit}
        className="btn w-full mt-4"
      >
        Login
      </button>

      {err && (
        <p className="text-red-400 mt-3">
          {err}
        </p>
      )}
    </main>
  );
}