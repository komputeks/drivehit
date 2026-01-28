"use client";

import { useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Settings() {

  const [folder, setFolder] = useState("");
  const [msg, setMsg] = useState("");

  async function ingest() {

    setMsg("Running...");

    try {

      await adminCall(
        "/v1/ingest",
        { folderId: folder }
      );

      setMsg("Started");

    } catch {
      setMsg("Failed");
    }
  }

  async function reindex() {

    setMsg("Reindexing...");

    await adminCall("/v1/reindex");

    setMsg("Done");
  }

  return (
    <div>

      <h1 className="text-2xl mb-4">
        Settings
      </h1>

      <div className="card space-y-4">

        <div>

          <label>Drive Folder ID</label>

          <input
            value={folder}
            onChange={e => setFolder(e.target.value)}
          />

        </div>

        <button
          className="btn"
          onClick={ingest}
        >
          Start Ingestion
        </button>

        <button
          className="btn"
          onClick={reindex}
        >
          Rebuild Index
        </button>

        {msg && (
          <p>{msg}</p>
        )}

      </div>
    </div>
  );
}