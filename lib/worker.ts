import { handleInbound, sendReminder } from "./agent";
import type { Db } from "./db";
import { getCrm } from "./crm";
import type { CrmClient } from "./crm/types";
import { enqueue, processJobs } from "./queue";
import { isWhatsAppConfigured, sendText } from "./whatsapp";

type ContactRow = {
  id: string;
  phone: string;
  externalId: string | null;
  locationId: string | null;
};

type AppointmentSyncRow = {
  id: string;
  status: string;
  startsAt: number;
  endsAt: number;
  serviceName: string;
  externalId: string | null;
  contactExternalId: string | null;
  locationId: string | null;
  calendarId: string | null;
};

/**
 * Two-phase writes: the local database is the ledger, HighLevel is synced by
 * queued jobs. A HighLevel outage can delay sync but can never lose a booking.
 */
export async function processDue(db: Db, now = Date.now(), crm: CrmClient | null = getCrm()) {
  return processJobs(
    db,
    {
      inbound_message: (payload) => {
        const replies = handleInbound(db, {
          clinicId: String(payload.clinicId),
          phone: String(payload.phone),
          text: String(payload.text),
          now,
        });
        // Delivery is its own job so a failed send retries without re-running the
        // assistant (which would write duplicate replies and re-book).
        for (const body of replies) {
          enqueue(db, {
            type: "whatsapp_send",
            payload: {
              to: String(payload.phone),
              body,
              source: payload.source === "demo" ? "demo" : "webhook",
            },
          });
        }
      },

      whatsapp_send: async (payload) => {
        if (payload.source === "demo") return;
        const ok = await sendText(String(payload.to), String(payload.body));
        if (!ok && isWhatsAppConfigured()) throw new Error("whatsapp_send_failed");
      },

      reminder: (payload) => {
        const message = sendReminder(
          db,
          { appointmentId: String(payload.appointmentId), kind: payload.kind === "2h" ? "2h" : "24h" },
          now,
        );
        if (message) {
          enqueue(db, {
            type: "whatsapp_send",
            payload: { to: message.to, body: message.body, source: "webhook" },
          });
        }
      },

      crm_contact: async (payload) => {
        if (!crm) return;
        const patient = db
          .prepare(
            `SELECT p.id, p.phone, p.external_id AS externalId, c.external_location_id AS locationId
               FROM patients p JOIN clinics c ON c.id = p.clinic_id
              WHERE p.id = ?`,
          )
          .get(String(payload.patientId)) as ContactRow | undefined;

        if (!patient || patient.externalId) return;
        if (!patient.locationId) throw new Error("clinic_missing_highlevel_location");

        const { externalId } = await crm.upsertContact({
          locationId: patient.locationId,
          phone: patient.phone,
        });
        db.prepare("UPDATE patients SET external_id = ? WHERE id = ?").run(externalId, patient.id);
      },

      crm_appointment: async (payload) => {
        if (!crm) return;
        const appointment = loadAppointmentForSync(db, String(payload.appointmentId));
        if (!appointment || appointment.status !== "booked" || appointment.externalId) return;
        if (!appointment.locationId || !appointment.calendarId) {
          throw new Error("clinic_missing_highlevel_calendar");
        }
        if (!appointment.contactExternalId) throw new Error("patient_not_synced_to_highlevel");

        const { externalId } = await crm.createAppointment({
          locationId: appointment.locationId,
          calendarId: appointment.calendarId,
          contactId: appointment.contactExternalId,
          startTime: new Date(appointment.startsAt).toISOString(),
          endTime: new Date(appointment.endsAt).toISOString(),
          title: appointment.serviceName,
        });
        db.prepare("UPDATE appointments SET external_id = ? WHERE id = ?").run(externalId, appointment.id);
      },

      crm_cancel: async (payload) => {
        if (!crm) return;
        const appointment = loadAppointmentForSync(db, String(payload.appointmentId));
        if (!appointment || !appointment.externalId) return;
        if (!appointment.locationId) throw new Error("clinic_missing_highlevel_location");
        await crm.cancelAppointment({
          locationId: appointment.locationId,
          eventId: appointment.externalId,
        });
      },
    },
    { now },
  );
}

/**
 * One pass only clears jobs that existed when it started; handlers enqueue
 * follow-ups (an inbound message books, which enqueues CRM sync). Drain until
 * a pass finds nothing left, so a single request leaves the ledger consistent.
 * The clock is re-read every pass: a follow-up job's run_at is always a few
 * milliseconds after the pass that created it.
 */
export async function drain(
  db: Db,
  crm: CrmClient | null = getCrm(),
  maxPasses = 5,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const result = await processDue(db, Date.now(), crm);
    processed += result.processed;
    failed += result.failed;
    if (result.processed === 0) break;
  }
  return { processed, failed };
}

function loadAppointmentForSync(db: Db, appointmentId: string): AppointmentSyncRow | undefined {
  return db
    .prepare(
      `SELECT a.id, a.status, a.starts_at AS startsAt, a.ends_at AS endsAt,
              s.name AS serviceName, a.external_id AS externalId,
              p.external_id AS contactExternalId,
              c.external_location_id AS locationId, c.external_calendar_id AS calendarId
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         JOIN patients p ON p.id = a.patient_id
         JOIN clinics c ON c.id = a.clinic_id
        WHERE a.id = ?`,
    )
    .get(appointmentId) as AppointmentSyncRow | undefined;
}
