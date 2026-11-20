import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { enqueue } from "./queue";

export type IncomingMessage = {
  waMessageId: string;
  from: string;
  text: string;
  displayPhoneNumber: string;
};

export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string | undefined): boolean {
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type WhatsAppPayload = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { display_phone_number?: string };
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }[];
      };
    }[];
  }[];
};

export function parseWebhook(payload: WhatsAppPayload): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      for (const message of value.messages ?? []) {
        if (message.type !== "text" || !message.text?.body || !message.id || !message.from) continue;
        out.push({
          waMessageId: message.id,
          from: message.from,
          text: message.text.body,
          displayPhoneNumber: value.metadata?.display_phone_number ?? "",
        });
      }
    }
  }
  return out;
}

const digits = (value: string) => value.replace(/\D/g, "");

export function findClinicByNumber(db: Db, displayPhoneNumber: string): string | undefined {
  const target = digits(displayPhoneNumber);
  const rows = db.prepare("SELECT id, whatsapp_number FROM clinics").all() as {
    id: string;
    whatsapp_number: string;
  }[];
  const match = rows.find((row) => digits(row.whatsapp_number) === target);
  return match?.id;
}

export type IngestResult = { duplicate: boolean; conversationId?: string };

/**
 * Stores the inbound message before anything else runs. The UNIQUE index on
 * wa_message_id is what makes Meta's retries safe.
 */
export function ingestInbound(
  db: Db,
  clinicId: string,
  message: IncomingMessage,
  now = Date.now(),
  source: "webhook" | "demo" = "webhook",
): IngestResult {
  const existing = db
    .prepare("SELECT id FROM messages WHERE wa_message_id = ?")
    .get(message.waMessageId) as { id: string } | undefined;
  if (existing) return { duplicate: true };

  const patientId = `pat-${randomUUID()}`;
  db.prepare(
    "INSERT INTO patients (id, clinic_id, phone, name, created_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(clinic_id, phone) DO NOTHING",
  ).run(patientId, clinicId, message.from, now);

  const patient = db
    .prepare("SELECT id, external_id AS externalId FROM patients WHERE clinic_id = ? AND phone = ?")
    .get(clinicId, message.from) as { id: string; externalId: string | null } | undefined;

  const conversationId = `conv-${randomUUID()}`;
  db.prepare(
    `INSERT INTO conversations (id, clinic_id, patient_phone, state, created_at, last_message_at)
     VALUES (?, ?, ?, '{}', ?, ?)
     ON CONFLICT(clinic_id, patient_phone) DO NOTHING`,
  ).run(conversationId, clinicId, message.from, now, now);

  const conversation = db
    .prepare("SELECT id FROM conversations WHERE clinic_id = ? AND patient_phone = ?")
    .get(clinicId, message.from) as { id: string } | undefined;
  if (!conversation) throw new Error("conversation_create_failed");

  try {
    db.prepare(
      `INSERT INTO messages (id, clinic_id, conversation_id, direction, body, wa_message_id, created_at)
       VALUES (?, ?, ?, 'in', ?, ?, ?)`,
    ).run(`msg-${randomUUID()}`, clinicId, conversation.id, message.text, message.waMessageId, now);
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (text.includes("UNIQUE constraint failed")) return { duplicate: true };
    throw error;
  }

  db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(now, conversation.id);
  enqueue(db, {
    type: "inbound_message",
    payload: { clinicId, phone: message.from, text: message.text, source },
  });
  if (patient && !patient.externalId) {
    enqueue(db, { type: "crm_contact", payload: { patientId: patient.id } });
  }

  return { duplicate: false, conversationId: conversation.id };
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** The Graph API expects the recipient as country code + number, digits only. */
export async function sendText(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const recipient = digits(to);
  if (!token || !phoneNumberId || !recipient) return false;

  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body: text },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
