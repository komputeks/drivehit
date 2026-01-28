"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

type ErrorLog = {
  id: string;
  jobType: string;
  message: string;
  timestamp: string;
};

export default function Errors() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    async function loadErrors() {
      try {
        const data = await adminCall("errors");
        setErrors(data || []);
      } catch (e: any) {
        setErr(e.message);
      }
    }
    loadErrors();
  }, []);

  return (
    <div>
      <h1 className="text-2xl mb-4">Error Logs</h1>
      {err && <p className="text-red-400">{err}</p>}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {errors.map((e) => (
          <div key={e.id} className="p-2 bg-red-900 rounded">
            <p>
              <strong>{e.jobType}</strong> - {new Date(e.timestamp).toLocaleString()}
            </p>
            <p className="text-sm text-red-200">{e.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}