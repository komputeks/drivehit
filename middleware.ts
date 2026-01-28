import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {

  if (!req.nextUrl.pathname.startsWith("/admin")) {
    return;
  }

  const cookie = req.cookies.get("admin");

  if (!cookie) {
    return NextResponse.redirect(
      new URL("/login", req.url)
    );
  }
}

export const config = {
  matcher: ["/admin/:path*"]
};