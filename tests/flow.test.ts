import { describe, expect, it } from "vitest";
import type { CrmClient } from "../lib/crm/types";
import type { Db } from "../lib/db";
import { ingestInbound } from "../lib/whatsapp";
import { drain } from "../lib/worker";
import { CLINIC_ID, PHONE, createTestDb } from "./fixtures";

// Same path the HTTP handlers use: one drain must also run the follow-up jobs
// the assistant enqueues (CRM sync), not just the inbound message.
async function say(db: Db, text: string, waMessageId: string, crm: CrmClient | null = null) {
  ingestInbound(db, CLINIC_ID, { waMessageId, from: PHONE, text, displayPhoneNumber: "" });
  await drain(db, crm);
}

function lastReply(db: Db): string {
  const row = db
    .prepare("SELECT body FROM messages WHERE direction = 'out' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get() as { body: string };
  return row.body;
}

function countAppointments(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n;
}

describe("webhook ingestion", () => {
  it("stores a retried message only once", () => {
    const db = createTestDb();
    const message = { waMessageId: "wamid-1", from: PHONE, text: "Hello", displayPhoneNumber: "" };

    expect(ingestInbound(db, CLINIC_ID, message).duplicate).toBe(false);
    expect(ingestInbound(db, CLINIC_ID, message).duplicate).toBe(true);

    const stored = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE wa_message_id = 'wamid-1'").get() as {
      n: number;
    };
    expect(stored.n).toBe(1);
  });
});

describe("assistant", () => {
  it("answers a greeting and a price question", async () => {
    const db = createTestDb();
    await say(db, "Hello", "w1");
    expect(lastReply(db)).toContain("Test Clinic");

    await say(db, "What are your prices?", "w2");
    expect(lastReply(db)).toContain("Consultation");
    expect(lastReply(db)).toContain("AED 150");
  });

  it("books an appointment end to end", async () => {
    const db = createTestDb();

    await say(db, "Book", "w1");
    expect(lastReply(db)).toContain("Which service");

    await say(db, "1", "w2");
    expect(lastReply(db)).toContain("Next open slots");

    await say(db, "1", "w3");
    expect(lastReply(db)).toContain("Booked:");

    expect(countAppointments(db)).toBe(1);
  });

  it("does not answer twice when Meta retries a message", async () => {
    const db = createTestDb();
    await say(db, "Hello", "w1");

    const before = (db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
    await say(db, "Hello", "w1");
    const after = (db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;

    expect(after).toBe(before);
  });

  it("schedules reminders relative to the appointment", async () => {
    const db = createTestDb();
    await say(db, "Book", "w1");
    await say(db, "1", "w2");
    await say(db, "1", "w3");

    const appointment = db.prepare("SELECT starts_at AS startsAt FROM appointments LIMIT 1").get() as {
      startsAt: number;
    };
    const reminders = db
      .prepare("SELECT payload, run_at AS runAt FROM jobs WHERE type = 'reminder' AND status = 'pending'")
      .all() as { payload: string; runAt: number }[];

    expect(reminders.length).toBeGreaterThan(0);
    for (const reminder of reminders) {
      const { kind } = JSON.parse(reminder.payload) as { kind: string };
      const offset = kind === "24h" ? 24 * 3_600_000 : 2 * 3_600_000;
      expect(reminder.runAt).toBe(appointment.startsAt - offset);
    }
  });

  it("cancels the next appointment", async () => {
    const db = createTestDb();
    await say(db, "Book", "w1");
    await say(db, "1", "w2");
    await say(db, "1", "w3");

    await say(db, "Cancel", "w4");
    expect(lastReply(db)).toContain("Cancelled");

    const row = db.prepare("SELECT status FROM appointments LIMIT 1").get() as { status: string };
    expect(row.status).toBe("cancelled");
  });

  it("flags questions it cannot answer for a human", async () => {
    const db = createTestDb();
    await say(db, "Do you treat impacted wisdom teeth under sedation?", "w1");

    expect(lastReply(db)).toContain("clinic team");
    const conversation = db.prepare("SELECT state FROM conversations LIMIT 1").get() as { state: string };
    expect(JSON.parse(conversation.state).needsHuman).toBe(true);
  });
});

describe("HighLevel sync", () => {
  it("mirrors the patient and the appointment into the CRM", async () => {
    const db = createTestDb();
    db.prepare("UPDATE clinics SET external_location_id = 'loc-1', external_calendar_id = 'cal-1' WHERE id = ?").run(
      CLINIC_ID,
    );

    const contacts: { locationId: string; phone: string }[] = [];
    const appointments: { locationId: string; calendarId: string; contactId: string; title: string }[] = [];
    const cancellations: { locationId: string; eventId: string }[] = [];

    const crm: CrmClient = {
      name: "fake",
      async upsertContact(input) {
        contacts.push({ locationId: input.locationId, phone: input.phone });
        return { externalId: "ghl-contact-1" };
      },
      async createAppointment(input) {
        appointments.push({
          locationId: input.locationId,
          calendarId: input.calendarId,
          contactId: input.contactId,
          title: input.title,
        });
        return { externalId: "ghl-event-1" };
      },
      async cancelAppointment(input) {
        cancellations.push(input);
      },
    };

    await say(db, "Hello", "w1", crm);
    expect(contacts).toEqual([{ locationId: "loc-1", phone: PHONE }]);

    const patient = db.prepare("SELECT external_id AS externalId FROM patients LIMIT 1").get() as {
      externalId: string;
    };
    expect(patient.externalId).toBe("ghl-contact-1");

    await say(db, "Book", "w2", crm);
    await say(db, "1", "w3", crm);
    await say(db, "1", "w4", crm);

    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({ calendarId: "cal-1", contactId: "ghl-contact-1", title: "Consultation" });

    const appointment = db.prepare("SELECT external_id AS externalId FROM appointments LIMIT 1").get() as {
      externalId: string;
    };
    expect(appointment.externalId).toBe("ghl-event-1");

    await say(db, "Cancel", "w5", crm);
    expect(cancellations).toEqual([{ locationId: "loc-1", eventId: "ghl-event-1" }]);
  });
});
