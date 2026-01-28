"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const data = await adminCall("stats");
      setStats(data);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

      {err && <p className="text-red-400 mb-4">{err}</p>}

      {!stats && <p>Loading...</p>}

      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Items" value={stats.items} />
          <Stat label="Jobs" value={stats.jobs} />
          <Stat label="Errors" value={stats.errors} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: any) {
  return (
    <div className="card p-4 bg-slate-800 rounded">
      <h3 className="font-semibold">{label}</h3>
      <p className="text-2xl mt-2">{value ?? 0}</p>
    </div>
  );
}