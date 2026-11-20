import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { findClinicByNumber, ingestInbound, parseWebhook, verifySignature } from "@/lib/whatsapp";
import { drain } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256");

  if (secret) {
    if (!verifySignature(raw, signature, secret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "WHATSAPP_APP_SECRET is not configured" }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const db = getDb();
  const messages = parseWebhook(payload as Parameters<typeof parseWebhook>[0]);
  const clinicRows = db.prepare("SELECT id FROM clinics").all() as { id: string }[];
  const onlyClinic = clinicRows.length === 1 ? clinicRows[0].id : undefined;

  let accepted = 0;
  let duplicates = 0;
  let unmatched = 0;

  for (const message of messages) {
    const clinicId = findClinicByNumber(db, message.displayPhoneNumber) ?? onlyClinic;
    if (!clinicId) {
      unmatched++;
      continue;
    }
    const result = ingestInbound(db, clinicId, message);
    if (result.duplicate) duplicates++;
    else accepted++;
  }

  // Acknowledge Meta first, then run the agent outside the request path.
  after(async () => {
    await drain(db);
  });

  return NextResponse.json({ ok: true, accepted, duplicates, unmatched });
}
