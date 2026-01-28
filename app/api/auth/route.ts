import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/core";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!isAdmin(email)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const res = NextResponse.json({ ok: true });

    /* Set httpOnly admin cookie */
    res.cookies.set({
      name: "admin",
      value: email,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7
    });

    return res;

  } catch (e: any) {
    console.error("[AUTH_API]", e);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}