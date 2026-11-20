import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { locationId?: string | null; calendarId?: string | null };

/**
 * Links one clinic to a HighLevel location (sub-account) and calendar.
 * Kept as an API so clinics can be connected without a redeploy.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const db = getDb();
  const clinic = db.prepare("SELECT id FROM clinics WHERE id = ?").get(id);
  if (!clinic) return NextResponse.json({ error: "clinic not found" }, { status: 404 });

  const locationId = body.locationId?.trim() || null;
  const calendarId = body.calendarId?.trim() || null;

  db.prepare(
    "UPDATE clinics SET external_location_id = ?, external_calendar_id = ?, crm_provider = ? WHERE id = ?",
  ).run(locationId, calendarId, locationId ? "highlevel" : null, id);

  return NextResponse.json({ ok: true, locationId, calendarId });
}
