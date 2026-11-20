import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import {
  bookAppointment,
  cancelAppointment,
  findSlots,
  getClinic,
  listServices,
  nextAppointmentForPatient,
  type Slot,
} from "./booking";
import { formatDateTime } from "./time";

type ConversationState = {
  stage?: "choose_service" | "choose_slot";
  serviceIds?: string[];
  serviceId?: string;
  slots?: { startMs: number; practitionerId: string; label: string }[];
  needsHuman?: boolean;
};

type ConversationRow = { id: string; state: string };

const BOOK = /\b(book|booking|appointment|appoint|slot|schedule|available|availability|visit)\b/i;
const CANCEL = /\b(cancel|reschedule|postpone)\b/i;
const PRICE = /\b(price|prices|fee|fees|cost|charge|charges|how much)\b/i;
const HOURS = /\b(hours?|timing|timings|open|opening|close|closing)\b/i;
const ADDRESS = /\b(address|where|location|directions?|parking)\b/i;
const GREETING = /\b(hi|hello|hey|salam|assalam|namaste|good morning|good evening)\b/i;
const HELP = /\b(help|menu|options)\b/i;

function money(cents: number, currency: string): string {
  const value = cents / 100;
  return `${currency} ${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function pickIndex(text: string, max: number): number | null {
  const match = text.trim().match(/^(?:option\s*)?(\d{1,2})\s*[.)]?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= max ? n - 1 : null;
}

function outbound(db: Db, clinicId: string, conversationId: string, body: string, now: number): void {
  db.prepare(
    `INSERT INTO messages (id, clinic_id, conversation_id, direction, body, wa_message_id, created_at)
     VALUES (?, ?, ?, 'out', ?, NULL, ?)`,
  ).run(`msg-${randomUUID()}`, clinicId, conversationId, body, now);
}

export type AgentInput = { clinicId: string; phone: string; text: string; now?: number };

export function handleInbound(db: Db, input: AgentInput): string[] {
  const now = input.now ?? Date.now();
  const clinic = getClinic(db, input.clinicId);
  if (!clinic) throw new Error("clinic_not_found");

  const conversation = db
    .prepare("SELECT id, state FROM conversations WHERE clinic_id = ? AND patient_phone = ?")
    .get(clinic.id, input.phone) as ConversationRow | undefined;
  if (!conversation) throw new Error("conversation_not_found");

  const patient = db
    .prepare("SELECT id FROM patients WHERE clinic_id = ? AND phone = ?")
    .get(clinic.id, input.phone) as { id: string } | undefined;
  if (!patient) throw new Error("patient_not_found");

  const services = listServices(db, clinic.id);
  const tz = clinic.timezone;
  const text = input.text.trim();
  const lower = text.toLowerCase();
  let state = JSON.parse(conversation.state) as ConversationState;
  let replies: string[] = [];

  const listSlots = (serviceId: string): void => {
    const service = services.find((s) => s.id === serviceId);
    const slots: Slot[] = findSlots(db, { clinicId: clinic.id, serviceId, fromMs: now });
    if (!service || slots.length === 0) {
      state = {};
      replies = ["I do not see open slots in the next week. A team member will message you here shortly."];
      return;
    }
    state = {
      stage: "choose_slot",
      serviceId,
      slots: slots.map((s) => ({ startMs: s.startMs, practitionerId: s.practitionerId, label: s.label })),
    };
    const lines = slots.map((slot, i) => `${i + 1}) ${slot.label}`).join("\n");
    replies = [`Next open slots for ${service.name}:\n${lines}\n\nReply with the number you want.`];
  };

  const listServicesForChoice = (): void => {
    state = { stage: "choose_service", serviceIds: services.map((s) => s.id) };
    const lines = services
      .map((s, i) => `${i + 1}) ${s.name} - ${s.duration_min} min - ${money(s.price_cents, clinic.currency)}`)
      .join("\n");
    replies = [`Which service do you need?\n${lines}\n\nReply with a number.`];
  };

  if (state.stage === "choose_service") {
    const ids = state.serviceIds ?? [];
    let serviceId: string | undefined;
    const index = pickIndex(text, ids.length);
    if (index !== null) serviceId = ids[index];
    if (!serviceId) serviceId = services.find((s) => lower.includes(s.name.toLowerCase()))?.id;
    if (!serviceId) {
      replies = ["Please reply with the number of the service you want."];
    } else {
      listSlots(serviceId);
    }
  } else if (state.stage === "choose_slot") {
    const slots = state.slots ?? [];
    const index = pickIndex(text, slots.length);
    const serviceId = state.serviceId;
    if (index === null || !serviceId) {
      replies = [`Please reply with a number from 1 to ${slots.length}.`];
    } else {
      const slot = slots[index];
      const result = bookAppointment(db, {
        clinicId: clinic.id,
        serviceId,
        practitionerId: slot.practitionerId,
        patientId: patient.id,
        startMs: slot.startMs,
        now,
      });
      const service = services.find((s) => s.id === serviceId);
      if (result.ok) {
        state = {};
        replies = [
          `Booked: ${service?.name ?? "appointment"} on ${formatDateTime(slot.startMs, tz)} at ${clinic.name}. ` +
            `We will send a reminder before your visit. Reply CANCEL to cancel.`,
        ];
      } else {
        const fresh = findSlots(db, { clinicId: clinic.id, serviceId, fromMs: now });
        if (fresh.length === 0) {
          state = {};
          replies = ["That slot was just taken and nothing else is open this week. The team will follow up here."];
        } else {
          state = {
            stage: "choose_slot",
            serviceId,
            slots: fresh.map((s) => ({ startMs: s.startMs, practitionerId: s.practitionerId, label: s.label })),
          };
          const lines = fresh.map((s, i) => `${i + 1}) ${s.label}`).join("\n");
          replies = [`That slot was just taken. Next open slots:\n${lines}\n\nReply with a number.`];
        }
      }
    }
  } else if (CANCEL.test(lower)) {
    const next = nextAppointmentForPatient(db, clinic.id, patient.id, now);
    if (next && cancelAppointment(db, clinic.id, next.id)) {
      replies = [`Cancelled your ${next.serviceName} on ${formatDateTime(next.startMs, tz)}. Reply BOOK to pick a new time.`];
    } else {
      replies = ["I could not find an upcoming appointment for this number. A team member will confirm."];
    }
  } else if (BOOK.test(lower)) {
    if (services.length === 1) listSlots(services[0].id);
    else listServicesForChoice();
  } else if (PRICE.test(lower)) {
    const lines = services
      .map((s) => `- ${s.name}: ${money(s.price_cents, clinic.currency)} (${s.duration_min} min)`)
      .join("\n");
    replies = [`Our treatments:\n${lines}\n\nReply BOOK to see open slots.`];
  } else if (HOURS.test(lower)) {
    replies = [`We are open ${clinic.hours_note}. Reply BOOK to see open slots.`];
  } else if (ADDRESS.test(lower)) {
    replies = [`We are at ${clinic.address}. Reply BOOK to see open slots.`];
  } else if (GREETING.test(lower)) {
    replies = [
      `Hello, you have reached ${clinic.name}. I can share prices, opening hours, our address, or book an appointment. What do you need?`,
    ];
  } else if (HELP.test(lower)) {
    replies = ["I can help with:\n1) Prices\n2) Opening hours\n3) Address\n\nOr send BOOK to schedule an appointment."];
  } else {
    state = { ...state, needsHuman: true };
    replies = ["I have passed this to the clinic team and they will reply here shortly."];
  }

  replies.forEach((body, i) => outbound(db, clinic.id, conversation.id, body, now + i));
  db.prepare("UPDATE conversations SET state = ?, last_message_at = ? WHERE id = ?").run(
    JSON.stringify(state),
    now + replies.length,
    conversation.id,
  );

  return replies;
}

export function sendReminder(
  db: Db,
  payload: { appointmentId: string; kind: "24h" | "2h" },
  now = Date.now(),
): { to: string; body: string } | null {
  const row = db
    .prepare(
      `SELECT a.starts_at AS startMs, a.status, s.name AS serviceName, c.name AS clinicName,
              c.timezone, c.id AS clinicId, p.phone, cv.id AS conversationId
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         JOIN clinics c ON c.id = a.clinic_id
         JOIN patients p ON p.id = a.patient_id
         JOIN conversations cv ON cv.clinic_id = a.clinic_id AND cv.patient_phone = p.phone
        WHERE a.id = ?`,
    )
    .get(payload.appointmentId) as
    | {
        startMs: number;
        status: string;
        serviceName: string;
        clinicName: string;
        timezone: string;
        clinicId: string;
        phone: string;
        conversationId: string;
      }
    | undefined;

  if (!row || row.status !== "booked") return null;
  const label = formatDateTime(row.startMs, row.timezone);
  const body =
    payload.kind === "24h"
      ? `Reminder: your ${row.serviceName} at ${row.clinicName} is on ${label}. Reply CANCEL if you need to change it.`
      : `See you soon: your ${row.serviceName} at ${row.clinicName} is today at ${formatDateTime(row.startMs, row.timezone)}.`;
  outbound(db, row.clinicId, row.conversationId, body, now);
  return { to: row.phone, body };
}
