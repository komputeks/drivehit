"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

type Job = {
  id: string;
  type: string;
  status: string;
  progress?: number;
};

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    async function loadJobs() {
      try {
        const data = await adminCall("jobs");
        setJobs(data || []);
      } catch (e: any) {
        setErr(e.message);
      }
    }
    loadJobs();
  }, []);

  async function retry(id: string) {
    try {
      await adminCall("retryJob", { jobId: id });
      // Reload after retry
      const data = await adminCall("jobs");
      setJobs(data || []);
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
          <div key={j.id} className="flex justify-between items-center p-3 bg-slate-800 rounded">
            <div>
              <p>{j.type}</p>
              <p className="text-sm text-slate-400">{j.status}</p>
            </div>
            <div className="flex items-center gap-2">
              <p>{j.progress ?? 0}%</p>
              {j.status === "failed" && (
                <button
                  onClick={() => retry(j.id)}
                  className="px-2 py-1 bg-red-600 rounded hover:bg-red-500"
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