import type { Db } from "./db";
import { localDate, zonedToUtc } from "./time";

type SeedClinic = {
  id: string;
  name: string;
  timezone: string;
  whatsappNumber: string;
  address: string;
  hoursNote: string;
  currency: string;
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  practitioner: { id: string; name: string };
  weekdays: { weekday: number; startMin: number; endMin: number }[];
};

const CLINICS: SeedClinic[] = [
  {
    id: "c-aurora",
    name: "Aurora Dental Studio",
    timezone: "Asia/Dubai",
    whatsappNumber: "+971500000001",
    address: "Villa 12, Jumeirah 1, Dubai",
    hoursNote: "Sat-Thu 09:00-19:00, closed Friday",
    currency: "AED",
    services: [
      { id: "s-aurora-consult", name: "Consultation", durationMin: 30, priceCents: 15000 },
      { id: "s-aurora-cleaning", name: "Teeth cleaning", durationMin: 45, priceCents: 25000 },
      { id: "s-aurora-whitening", name: "Whitening", durationMin: 60, priceCents: 60000 },
    ],
    practitioner: { id: "p-layla", name: "Dr. Layla Haddad" },
    weekdays: [
      { weekday: 0, startMin: 540, endMin: 1140 },
      { weekday: 1, startMin: 540, endMin: 1140 },
      { weekday: 2, startMin: 540, endMin: 1140 },
      { weekday: 3, startMin: 540, endMin: 1140 },
      { weekday: 4, startMin: 540, endMin: 1140 },
      { weekday: 6, startMin: 600, endMin: 960 },
    ],
  },
  {
    id: "c-pearl",
    name: "Pearl Aesthetics",
    timezone: "Asia/Dubai",
    whatsappNumber: "+971500000002",
    address: "Marina Plaza, Dubai Marina, Dubai",
    hoursNote: "Daily 10:00-20:00",
    currency: "AED",
    services: [
      { id: "s-pearl-skin", name: "Skin consultation", durationMin: 30, priceCents: 20000 },
      { id: "s-pearl-hydra", name: "Hydrafacial", durationMin: 60, priceCents: 45000 },
      { id: "s-pearl-laser", name: "Laser session", durationMin: 45, priceCents: 80000 },
    ],
    practitioner: { id: "p-noor", name: "Noor Al Sayed" },
    weekdays: [
      { weekday: 0, startMin: 600, endMin: 1200 },
      { weekday: 1, startMin: 600, endMin: 1200 },
      { weekday: 2, startMin: 600, endMin: 1200 },
      { weekday: 3, startMin: 600, endMin: 1200 },
      { weekday: 4, startMin: 600, endMin: 1200 },
      { weekday: 5, startMin: 600, endMin: 1200 },
      { weekday: 6, startMin: 600, endMin: 1200 },
    ],
  },
  {
    id: "c-smileworks",
    name: "SmileWorks London",
    timezone: "Europe/London",
    whatsappNumber: "+447700900001",
    address: "18 Brick Lane, London E1 6RF",
    hoursNote: "Mon-Fri 09:00-18:00, Sat 10:00-14:00",
    currency: "GBP",
    services: [
      { id: "s-smile-check", name: "Check-up", durationMin: 30, priceCents: 4500 },
      { id: "s-smile-hygiene", name: "Hygiene appointment", durationMin: 45, priceCents: 8000 },
      { id: "s-smile-bonding", name: "Composite bonding", durationMin: 90, priceCents: 25000 },
    ],
    practitioner: { id: "p-james", name: "Dr. James Patel" },
    weekdays: [
      { weekday: 1, startMin: 540, endMin: 1080 },
      { weekday: 2, startMin: 540, endMin: 1080 },
      { weekday: 3, startMin: 540, endMin: 1080 },
      { weekday: 4, startMin: 540, endMin: 1080 },
      { weekday: 5, startMin: 540, endMin: 1080 },
      { weekday: 6, startMin: 600, endMin: 840 },
    ],
  },
];

function insertDemoActivity(db: Db, clinic: SeedClinic, now: number): void {
  const patientId = `pat-${clinic.id}`;
  db.prepare(
    "INSERT OR IGNORE INTO patients (id, clinic_id, phone, name, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(patientId, clinic.id, "+971500009999", "Demo patient", now);

  const conversationId = `conv-${clinic.id}`;
  db.prepare(
    `INSERT OR IGNORE INTO conversations (id, clinic_id, patient_phone, state, created_at, last_message_at)
     VALUES (?, ?, ?, '{}', ?, ?)`,
  ).run(conversationId, clinic.id, "+971500009999", now - 3600_000, now - 3000_000);

  const lines: [string, string][] = [
    ["in", "Hi, what are your prices?"],
    ["out", "Hello! Consultation is listed on our price list. Would you like me to book a slot?"],
    ["in", "Yes please"],
    ["out", "Great, tell me a day that suits you and I will share the open slots."],
  ];
  lines.forEach(([direction, body], i) => {
    db.prepare(
      `INSERT OR IGNORE INTO messages (id, clinic_id, conversation_id, direction, body, wa_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(`msg-seed-${clinic.id}-${i}`, clinic.id, conversationId, direction, body, now - 3000_000 + i * 60_000);
  });

  const ahead = now + 86_400_000;
  const { year, month, day } = localDate(ahead, clinic.timezone);
  const startMs = zonedToUtc(clinic.timezone, year, month, day, 10, 0);
  db.prepare(
    `INSERT OR IGNORE INTO appointments
       (id, clinic_id, practitioner_id, service_id, patient_id, starts_at, ends_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', ?)`,
  ).run(
    `appt-seed-${clinic.id}`,
    clinic.id,
    clinic.practitioner.id,
    clinic.services[0].id,
    patientId,
    startMs,
    startMs + clinic.services[0].durationMin * 60_000,
    now,
  );
}

export function seedDemo(db: Db): void {
  const now = Date.now();
  for (const c of CLINICS) {
    db.prepare(
      `INSERT OR IGNORE INTO clinics (id, name, timezone, whatsapp_number, address, hours_note, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.id, c.name, c.timezone, c.whatsappNumber, c.address, c.hoursNote, c.currency, now);

    for (const s of c.services) {
      db.prepare(
        "INSERT OR IGNORE INTO services (id, clinic_id, name, duration_min, price_cents) VALUES (?, ?, ?, ?, ?)",
      ).run(s.id, c.id, s.name, s.durationMin, s.priceCents);
    }

    db.prepare("INSERT OR IGNORE INTO practitioners (id, clinic_id, name) VALUES (?, ?, ?)").run(
      c.practitioner.id,
      c.id,
      c.practitioner.name,
    );

    for (const w of c.weekdays) {
      db.prepare(
        "INSERT OR IGNORE INTO working_hours (practitioner_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)",
      ).run(c.practitioner.id, w.weekday, w.startMin, w.endMin);
    }

    insertDemoActivity(db, c, now);
  }
}
