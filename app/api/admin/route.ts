import { NextRequest, NextResponse } from "next/server";
import { callGas } from "@/lib/core";

/*
 Actions:
 - stats
 - ingest
 - items
 - jobs
*/

export async function POST(req: NextRequest) {

  try {

    const body = await req.json();

    const { action, payload } = body;

    if (!action) {
      return NextResponse.json(
        { error: "No action" },
        { status: 400 }
      );
    }

    const map: any = {
      stats: "/v1/admin/stats",
      ingest: "/v1/admin/ingest",
      items: "/v1/admin/items",
      jobs: "/v1/admin/jobs"
    };

    const path = map[action];

    if (!path) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    const data = await callGas(
      path,
      payload || {}
    );

    return NextResponse.json(data);

  } catch (e: any) {

    return NextResponse.json(
      { error: e.message },
      { status: 500 }
    );
  }
}