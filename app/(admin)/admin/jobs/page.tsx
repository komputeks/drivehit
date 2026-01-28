"use client";

import { useEffect, useState } from "react";

export default function Jobs() {

  const [jobs, setJobs] = useState<any[]>([]);

  async function load() {

    const res = await fetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "jobs"
      })
    });

    const data = await res.json();

    setJobs(data.jobs || []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>

      <h1 className="text-2xl font-bold mb-4">
        Jobs
      </h1>

      <div className="space-y-3">

        {jobs.map(j => (

          <div
            key={j.id}
            className="card"
          >
            <p className="font-medium">
              {j.name}
            </p>

            <p className="text-sm text-slate-400">
              {j.status} — {j.updated}
            </p>

          </div>
        ))}
      </div>

    </div>
  );
}