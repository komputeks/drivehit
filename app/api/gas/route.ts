import { NextRequest, NextResponse } from "next/server";
import { callGas } from "@/lib/core";

export async function POST(req: NextRequest) {

  const body = await req.json();

  const data = await callGas(
    body.path,
    body.payload
  );

  return NextResponse.json(data);
}