import { after } from "next/server";
import { getDb } from "@/lib/db";
import {
  findClinicByNumber,
  ingestInbound,
  parseTwilioWebhook,
  verifyTwilioSignature,
} from "@/lib/whatsapp";
import { drain } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");

  if (authToken) {
    if (!verifyTwilioSignature(request.url, params, signature, authToken)) {
      return new Response("invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("TWILIO_AUTH_TOKEN is not configured", { status: 503 });
  }

  const db = getDb();
  const messages = parseTwilioWebhook(params);
  const clinicRows = db.prepare("SELECT id FROM clinics").all() as { id: string }[];
  // The sandbox reuses one Twilio number, so it cannot identify a clinic.
  const fallbackClinic =
    process.env.TWILIO_CLINIC_ID || (clinicRows.length === 1 ? clinicRows[0].id : undefined);

  for (const message of messages) {
    const clinicId = findClinicByNumber(db, message.displayPhoneNumber) ?? fallbackClinic;
    if (!clinicId) continue;
    ingestInbound(db, clinicId, message);
  }

  after(async () => {
    await drain(db);
  });

  // Replies go out through the API from the outbox, not as TwiML.
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
