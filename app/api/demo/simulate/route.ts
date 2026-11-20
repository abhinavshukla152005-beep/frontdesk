import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingestInbound } from "@/lib/whatsapp";
import { drain } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { clinicId?: string; phone?: string; text?: string };

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
  );

  await drain(db);

  const conversation = db
    .prepare("SELECT id FROM conversations WHERE clinic_id = ? AND patient_phone = ?")
    .get(body.clinicId, phone) as { id: string } | undefined;

  const replies = conversation
    ? (
        db
          .prepare(
            "SELECT body FROM messages WHERE conversation_id = ? AND direction = 'out' AND created_at >= ? ORDER BY created_at, rowid",
          )
          .all(conversation.id, startedAt) as { body: string }[]
      ).map((row) => row.body)
    : [];

  return NextResponse.json({ replies, duplicate: result.duplicate });
}
