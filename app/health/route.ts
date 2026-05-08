import { NextResponse } from "next/server";

/** Lightweight probe for CDN / monitoring; does not call external services. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "cpu-web", check: "live" });
}
