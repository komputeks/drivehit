"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Admin() {

  const [stats, setStats] = useState<any>();
  const [err, setErr] = useState("");

  useEffect(() => {

    load();

  }, []);

  async function load() {

    try {

      const d = await adminCall(
        "/v1/stats"
      );

      setStats(d);

    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>

      <h1 className="text-3xl font-bold mb-6">
        Dashboard
      </h1>

      {err && (
        <p className="text-red-400 mb-4">
          {err}
        </p>
      )}

      {!stats && (
        <p>Loading...</p>
      )}

      {stats && (

        <div className="grid grid-cols-3 gap-4">

          <Stat
            label="Items"
            value={stats.items}
          />

          <Stat
            label="Jobs"
            value={stats.jobs}
          />

          <Stat
            label="Errors"
            value={stats.errors}
          />

        </div>
      )}
    </div>
  );
}

/* ===================== */

function Stat({
  label,
  value
}: any) {

  return (
    <div className="card">

      <h3>{label}</h3>

      <p className="text-2xl mt-2">
        {value ?? 0}
      </p>

    </div>
  );
}