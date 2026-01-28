export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { callGas, isAdmin } from "@/lib/core";

/* ===============================
   ACTION MAP
================================ */

const ACTIONS: Record<string, string> = {

  stats:   "/v1/admin/stats",
  ingest:  "/v1/admin/ingest",
  items:   "/v1/admin/items",
  jobs:    "/v1/admin/jobs",
  reindex: "/v1/admin/reindex"

};

/* ===============================
   MAIN
================================ */

export async function POST(req: NextRequest) {

  try {

    /* ---------- Parse ---------- */

    const body = await req.json();

    const {
      action,
      payload,
      email
    } = body || {};

    /* ---------- Validate ---------- */

    if (!action) {
      return bad("Missing action");
    }

    if (!email) {
      return bad("Missing email");
    }

    if (!isAdmin(email)) {
      return deny();
    }

    const path = ACTIONS[action];

    if (!path) {
      return bad("Invalid action");
    }

    /* ---------- Execute ---------- */

    const data = await callGas(
      path,
      payload || {}
    );

    /* ---------- Success ---------- */

    return NextResponse.json({
      ok: true,
      data
    });

  } catch (e: any) {

    console.error("[ADMIN_API]", e);

    return NextResponse.json(
      {
        ok: false,
        error: "Internal error"
      },
      { status: 500 }
    );
  }
}

/* ===============================
   HELPERS
================================ */

function bad(msg: string) {

  return NextResponse.json(
    {
      ok: false,
      error: msg
    },
    { status: 400 }
  );
}

function deny() {

  return NextResponse.json(
    {
      ok: false,
      error: "Unauthorized"
    },
    { status: 403 }
  );
}