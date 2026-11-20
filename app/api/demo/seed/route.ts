import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { seedDemo } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const db = getDb();
  seedDemo(db);
  const clinics = db.prepare("SELECT COUNT(*) AS n FROM clinics").get() as { n: number };
  return NextResponse.json({ ok: true, clinics: clinics.n });
}
