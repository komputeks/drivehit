"use client";

import { useEffect, useState } from "react";
import { adminCall } from "@/lib/admin";

export default function Items() {

  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    load();
  }, [page]);

  async function load() {

    const d = await adminCall(
      "/v1/items",
      { page }
    );

    setItems(d.items || []);
  }

  return (
    <div>

      <h1 className="text-2xl mb-4">
        Items
      </h1>

      <div className="space-y-3">

        {items.map(i => (

          <div
            key={i.id}
            className="card"
          >

            <p>{i.title}</p>

            <p className="text-sm text-slate-400">
              {i.type}
            </p>

          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-4">

        <button
          className="btn"
          onClick={() => setPage(p => p - 1)}
          disabled={page === 1}
        >
          Prev
        </button>

        <button
          className="btn"
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </button>

      </div>
    </div>
  );
}