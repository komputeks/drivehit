import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/core";

export async function POST(req: NextRequest) {

  const { email } = await req.json();

  if (!isAdmin(email)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ok: true,
    email
  });
}