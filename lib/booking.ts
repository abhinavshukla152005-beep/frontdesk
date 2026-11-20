import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { cancelPendingReminders, enqueue } from "./queue";
import { formatDateTime, localDate, weekday, zonedToUtc } from "./time";

export type Slot = {
  startMs: number;
  endMs: number;
  practitionerId: string;
  label: string;
};

export type FindSlotsInput = {
  clinicId: string;
  serviceId: string;
  fromMs?: number;
  days?: number;
  limit?: number;
  stepMin?: number;
  leadMinutes?: number;
};

type ClinicRow = {
  id: string;
  timezone: string;
  name: string;
  currency: string;
  address: string;
  hours_note: string;
};
type ServiceRow = { id: string; clinic_id: string; name: string; duration_min: number; price_cents: number };

export function getClinic(db: Db, clinicId: string): ClinicRow | undefined {
  return db
    .prepare("SELECT id, timezone, name, currency, address, hours_note FROM clinics WHERE id = ?")
    .get(clinicId) as ClinicRow | undefined;
}

export function getService(db: Db, serviceId: string): ServiceRow | undefined {
  return db
    .prepare("SELECT id, clinic_id, name, duration_min, price_cents FROM services WHERE id = ?")
    .get(serviceId) as ServiceRow | undefined;
}

export function listServices(db: Db, clinicId: string): ServiceRow[] {
  return db
    .prepare("SELECT id, clinic_id, name, duration_min, price_cents FROM services WHERE clinic_id = ? ORDER BY duration_min")
    .all(clinicId) as ServiceRow[];
}

export function findSlots(db: Db, input: FindSlotsInput): Slot[] {
  const clinic = getClinic(db, input.clinicId);
  const service = getService(db, input.serviceId);
  if (!clinic) throw new Error("clinic_not_found");
  if (!service || service.clinic_id !== clinic.id) throw new Error("service_not_in_clinic");

  const tz = clinic.timezone;
  const fromMs = input.fromMs ?? Date.now();
  const days = input.days ?? 7;
  const limit = input.limit ?? 6;
  const stepMin = input.stepMin ?? 30;
  const minStart = fromMs + (input.leadMinutes ?? 180) * 60_000;
  const durationMs = service.duration_min * 60_000;

  const slots: Slot[] = [];
  const seen = new Set<number>();

  const rangeStmt = db.prepare(
    `SELECT p.id AS practitioner_id, wh.start_min, wh.end_min
       FROM practitioners p
       JOIN working_hours wh ON wh.practitioner_id = p.id
      WHERE p.clinic_id = ? AND wh.weekday = ?`,
  );
  const bookedStmt = db.prepare(
    `SELECT starts_at, ends_at FROM appointments
      WHERE practitioner_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ?`,
  );

  for (let d = 0; d < days && slots.length < limit; d++) {
    const base = fromMs + d * 86_400_000;
    const { year, month, day } = localDate(base, tz);
    const wd = weekday(base, tz);
    const dayStart = zonedToUtc(tz, year, month, day, 0, 0);
    const dayEnd = dayStart + 26 * 3_600_000;

    const ranges = rangeStmt.all(clinic.id, wd) as {
      practitioner_id: string;
      start_min: number;
      end_min: number;
    }[];

    for (const range of ranges) {
      const booked = bookedStmt.all(range.practitioner_id, dayEnd, dayStart) as {
        starts_at: number;
        ends_at: number;
      }[];

      for (let t = range.start_min; t + service.duration_min <= range.end_min; t += stepMin) {
        const startMs = zonedToUtc(tz, year, month, day, Math.floor(t / 60), t % 60);
        const endMs = startMs + durationMs;
        if (startMs < minStart) continue;
        if (seen.has(startMs)) continue;
        const overlaps = booked.some((b) => startMs < b.ends_at && endMs > b.starts_at);
        if (overlaps) continue;
        seen.add(startMs);
        slots.push({
          startMs,
          endMs,
          practitionerId: range.practitioner_id,
          label: formatDateTime(startMs, tz),
        });
        if (slots.length >= limit) break;
      }
      if (slots.length >= limit) break;
    }
  }

  return slots;
}

export type BookInput = {
  clinicId: string;
  serviceId: string;
  practitionerId: string;
  patientId: string;
  startMs: number;
  now?: number;
};

export type BookResult =
  | { ok: true; appointmentId: string }
  | { ok: false; reason: "slot_taken" | "invalid" };

export function bookAppointment(db: Db, input: BookInput): BookResult {
  const clinic = getClinic(db, input.clinicId);
  const service = getService(db, input.serviceId);
  if (!clinic || !service || service.clinic_id !== clinic.id) return { ok: false, reason: "invalid" };

  const practitioner = db
    .prepare("SELECT id FROM practitioners WHERE id = ? AND clinic_id = ?")
    .get(input.practitionerId, clinic.id);
  if (!practitioner) return { ok: false, reason: "invalid" };

  const now = input.now ?? Date.now();
  const endsAt = input.startMs + service.duration_min * 60_000;
  const appointmentId = randomUUID();

  try {
    db.prepare(
      `INSERT INTO appointments (id, clinic_id, practitioner_id, service_id, patient_id, starts_at, ends_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', ?)`,
    ).run(appointmentId, clinic.id, input.practitionerId, service.id, input.patientId, input.startMs, endsAt, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return { ok: false, reason: "slot_taken" };
    throw error;
  }

  for (const [kind, offsetMs] of [
    ["24h", 24 * 3_600_000],
    ["2h", 2 * 3_600_000],
  ] as const) {
    const runAt = input.startMs - offsetMs;
    // Skip a reminder that would fire immediately anyway.
    if (runAt > now + 60_000) enqueue(db, { type: "reminder", payload: { appointmentId, kind }, runAt });
  }

  enqueue(db, { type: "crm_appointment", payload: { appointmentId } });

  return { ok: true, appointmentId };
}

export function cancelAppointment(db: Db, clinicId: string, appointmentId: string): boolean {
  const result = db
    .prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ? AND clinic_id = ? AND status = 'booked'")
    .run(appointmentId, clinicId);
  if (result.changes === 0) return false;
  cancelPendingReminders(db, appointmentId);
  enqueue(db, { type: "crm_cancel", payload: { appointmentId } });
  return true;
}

export type AppointmentRow = {
  id: string;
  startMs: number;
  status: string;
  serviceName: string;
  patientPhone: string;
};

export function nextAppointmentForPatient(db: Db, clinicId: string, patientId: string, now = Date.now()): AppointmentRow | undefined {
  return db
    .prepare(
      `SELECT a.id, a.starts_at AS startMs, a.status, s.name AS serviceName, p.phone AS patientPhone
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         JOIN patients p ON p.id = a.patient_id
        WHERE a.clinic_id = ? AND a.patient_id = ? AND a.status = 'booked' AND a.starts_at > ?
        ORDER BY a.starts_at LIMIT 1`,
    )
    .get(clinicId, patientId, now) as AppointmentRow | undefined;
}
