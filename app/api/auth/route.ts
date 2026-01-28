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

  const res = NextResponse.json({
    ok: true
  });

  /* Secure cookie */
  res.cookies.set({
    name: "admin",
    value: email,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7 // 7 days
  });

  return res;
}