"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Jobs() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => load(), []);

  async function load() {
    try {
      const data = await adminCall("jobs");
      setJobs(data || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function retry(id: string) {
    try {
      await adminCall("retryJob", { jobId: id });
      load();
    } catch (e: any) {
      alert("Retry failed: " + e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl mb-4">Jobs</h1>
      {err && <p className="text-red-400">{err}</p>}

      <div className="space-y-3">
        {jobs.map((j) => (
          <div key={j.id} className="card p-3 flex justify-between items-center">
            <div>
              <p>{j.type}</p>
              <p className="text-sm text-slate-400">{j.status}</p>
            </div>
            <div className="flex items-center gap-2">
              <p>{j.progress ?? 0}%</p>
              {j.status === "failed" && (
                <button
                  className="btn btn-sm"
                  onClick={() => retry(j.id)}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}