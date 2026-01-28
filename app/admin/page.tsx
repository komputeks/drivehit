"use client";

import { useEffect, useState } from "react";

export default function Admin() {

  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState("");

  async function load() {

    try {

      const res = await fetch("/api/admin", {
        method: "POST",
        body: JSON.stringify({
          action: "stats"
        })
      });

      const data = await res.json();

      if (!res.ok) throw data;

      setStats(data);

    } catch (e: any) {
      setErr("Failed to load stats");
    }
  }

  async function ingest() {

    await fetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "ingest"
      })
    });

    alert("Ingestion started");
  }

  useEffect(() => {
    load();
  }, []);

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

      {stats && (

        <div className="grid grid-cols-3 gap-4 mb-6">

          <div className="card">
            <h3>Total Items</h3>
            <p className="text-2xl mt-2">
              {stats.items}
            </p>
          </div>

          <div className="card">
            <h3>Jobs</h3>
            <p className="text-2xl mt-2">
              {stats.jobs}
            </p>
          </div>

          <div className="card">
            <h3>Errors</h3>
            <p className="text-2xl mt-2">
              {stats.errors}
            </p>
          </div>

        </div>
      )}

      <button
        onClick={ingest}
        className="btn"
      >
        Start Ingestion
      </button>

    </div>
  );
}