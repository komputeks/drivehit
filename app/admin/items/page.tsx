"use client";

import { useEffect, useState } from "react";

export default function Items() {

  const [list, setList] = useState<any[]>([]);

  async function load() {

    const res = await fetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "items",
        payload: { page: 1 }
      })
    });

    const data = await res.json();

    setList(data.items || []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>

      <h1 className="text-2xl font-bold mb-4">
        Items
      </h1>

      <div className="space-y-3">

        {list.map(it => (

          <div
            key={it.id}
            className="card flex justify-between"
          >
            <div>
              <p className="font-medium">
                {it.title}
              </p>

              <p className="text-sm text-slate-400">
                {it.type}
              </p>
            </div>

            <span>
              {it.status}
            </span>

          </div>
        ))}
      </div>

    </div>
  );
}