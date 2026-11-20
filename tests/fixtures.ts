import { openDb, type Db } from "../lib/db";

/** 2026-11-20 08:00 in Asia/Dubai (UTC+4). */
export const DUBAI_NOW = Date.UTC(2026, 10, 20, 4, 0, 0);

export const CLINIC_ID = "c-test";
export const PHONE = "+971500000111";

export function createTestDb(): Db {
  const db = openDb(":memory:", { seed: false });

  db.prepare(
    `INSERT INTO clinics (id, name, timezone, whatsapp_number, address, hours_note, currency, created_at)
     VALUES (?, 'Test Clinic', 'Asia/Dubai', '+971500000000', 'Test address', 'Daily 09:00-17:00', 'AED', ?)`,
  ).run(CLINIC_ID, DUBAI_NOW);

  db.prepare(
    "INSERT INTO services (id, clinic_id, name, duration_min, price_cents) VALUES ('s-30', ?, 'Consultation', 30, 15000)",
  ).run(CLINIC_ID);

  db.prepare(
    "INSERT INTO services (id, clinic_id, name, duration_min, price_cents) VALUES ('s-60', ?, 'Deep cleaning', 60, 40000)",
  ).run(CLINIC_ID);

  db.prepare("INSERT INTO practitioners (id, clinic_id, name) VALUES ('p-test', ?, 'Dr Test')").run(CLINIC_ID);

  for (let weekday = 0; weekday < 7; weekday++) {
    db.prepare(
      "INSERT INTO working_hours (practitioner_id, weekday, start_min, end_min) VALUES ('p-test', ?, 540, 1020)",
    ).run(weekday);
  }

  return db;
}

export function addPatient(db: Db, phone = PHONE): string {
  const id = `pat-${phone}`;
  db.prepare("INSERT INTO patients (id, clinic_id, phone, name, created_at) VALUES (?, ?, ?, NULL, ?)").run(
    id,
    CLINIC_ID,
    phone,
    DUBAI_NOW,
  );
  return id;
}
