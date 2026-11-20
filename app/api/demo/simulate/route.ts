import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cancelPendingReminders } from "@/lib/queue";
import { ingestInbound } from "@/lib/whatsapp";
import { drain } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { clinicId?: string; phone?: string; text?: string; state?: unknown };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.clinicId || !body.text?.trim()) {
    return NextResponse.json({ error: "clinicId and text are required" }, { status: 400 });
  }

  const db = getDb();
  const clinic = db.prepare("SELECT id FROM clinics WHERE id = ?").get(body.clinicId);
  if (!clinic) return NextResponse.json({ error: "clinic not found" }, { status: 404 });

  const phone = body.phone?.trim() || "+971500001234";
  const startedAt = Date.now();

  const result = ingestInbound(
    db,
    body.clinicId,
    { waMessageId: `sim-${randomUUID()}`, from: phone, text: body.text, displayPhoneNumber: "" },
    startedAt,
    "demo",
  );

  const conversation = db
    .prepare("SELECT id, state FROM conversations WHERE clinic_id = ? AND patient_phone = ?")
    .get(body.clinicId, phone) as { id: string; state: string } | undefined;

  // Serverless instances do not share a database, so the demo client carries
  // the conversation state for the next turn.
  const resumed = body.state && typeof body.state === "object" ? body.state : null;
  if (conversation && resumed) {
    db.prepare("UPDATE conversations SET state = ? WHERE id = ?").run(JSON.stringify(resumed), conversation.id);
  }

  await drain(db);

  // A simulator booking must never produce an outbound reminder later, even if
  // WhatsApp credentials are configured on the host.
  const demoAppointments = db
    .prepare(
      `SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.clinic_id = ? AND p.phone = ? AND a.created_at >= ?`,
    )
    .all(body.clinicId, phone, startedAt) as { id: string }[];
  for (const appointment of demoAppointments) {
    cancelPendingReminders(db, appointment.id, "demo booking");
  }

  const after = db.prepare("SELECT state FROM conversations WHERE id = ?").get(conversation?.id ?? "") as
    | { state: string }
    | undefined;

  const replies = conversation
    ? (
        db
          .prepare(
            "SELECT body FROM messages WHERE conversation_id = ? AND direction = 'out' AND created_at >= ? ORDER BY created_at, rowid",
          )
          .all(conversation.id, startedAt) as { body: string }[]
      ).map((row) => row.body)
    : [];

  return NextResponse.json({
    replies,
    duplicate: result.duplicate,
    state: after ? (JSON.parse(after.state) as unknown) : {},
  });
}
