"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Jobs() {

  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {

    try {

      const d = await adminCall(
        "/v1/jobs"
      );

      setJobs(d || []);

    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>

      <h1 className="text-2xl mb-4">
        Jobs
      </h1>

      {err && (
        <p className="text-red-400">
          {err}
        </p>
      )}

      <div className="space-y-3">

        {jobs.map(j => (

          <div
            key={j.id}
            className="card flex justify-between"
          >

            <div>
              <p>{j.type}</p>
              <p className="text-sm text-slate-400">
                {j.status}
              </p>
            </div>

            <div>
              {j.progress}%
            </div>

          </div>
        ))}
      </div>
    </div>
  );
}