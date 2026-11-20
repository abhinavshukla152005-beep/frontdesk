import type { Db } from "./db";

export type ClinicSummary = {
  id: string;
  name: string;
  timezone: string;
  address: string;
  hoursNote: string;
  currency: string;
  whatsappNumber: string;
  conversations: number;
  bookings: number;
  openJobs: number;
  nextAppointment: number | null;
};

export function listClinics(db: Db): ClinicSummary[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.timezone, c.address, c.hours_note AS hoursNote, c.currency,
              c.whatsapp_number AS whatsappNumber,
              (SELECT COUNT(*) FROM conversations cv WHERE cv.clinic_id = c.id) AS conversations,
              (SELECT COUNT(*) FROM appointments a WHERE a.clinic_id = c.id AND a.status = 'booked') AS bookings,
              (SELECT COUNT(*) FROM jobs j
                 JOIN clinics c2 ON c2.id = c.id
                WHERE j.status = 'pending' AND j.payload LIKE '%' || c.id || '%') AS openJobs,
              (SELECT MIN(a.starts_at) FROM appointments a
                WHERE a.clinic_id = c.id AND a.status = 'booked' AND a.starts_at > ?) AS nextAppointment
         FROM clinics c
        ORDER BY c.name`,
    )
    .all(Date.now()) as ClinicSummary[];
  return rows;
}

export type MessageView = { id: string; direction: "in" | "out"; body: string; createdAt: number };

export type ConversationView = {
  id: string;
  patientPhone: string;
  needsHuman: boolean;
  lastMessageAt: number;
  messages: MessageView[];
};

export type AppointmentView = {
  id: string;
  startMs: number;
  status: string;
  serviceName: string;
  practitionerName: string;
  patientPhone: string;
  externalId: string | null;
};

export type ClinicDashboard = {
  clinic: {
    id: string;
    name: string;
    timezone: string;
    address: string;
    hoursNote: string;
    currency: string;
    whatsappNumber: string;
  };
  metrics: {
    conversations: number;
    inbound: number;
    outbound: number;
    bookings: number;
    cancelled: number;
    medianFirstResponseMin: number | null;
  };
  conversations: ConversationView[];
  appointments: AppointmentView[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value);
}

export function getClinicDashboard(db: Db, clinicId: string): ClinicDashboard | null {
  const clinic = db
    .prepare(
      `SELECT id, name, timezone, address, hours_note AS hoursNote, currency,
              whatsapp_number AS whatsappNumber
         FROM clinics WHERE id = ?`,
    )
    .get(clinicId) as ClinicDashboard["clinic"] | undefined;
  if (!clinic) return null;

  const counts = (direction: "in" | "out") =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE clinic_id = ? AND direction = ?")
        .get(clinicId, direction) as { n: number }
    ).n;

  const conversations = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM conversations WHERE clinic_id = ?",
      )
      .get(clinicId) as { n: number }
  ).n;

  const bookings = (
    db
      .prepare("SELECT COUNT(*) AS n FROM appointments WHERE clinic_id = ? AND status = 'booked'")
      .get(clinicId) as { n: number }
  ).n;

  const cancelled = (
    db
      .prepare("SELECT COUNT(*) AS n FROM appointments WHERE clinic_id = ? AND status = 'cancelled'")
      .get(clinicId) as { n: number }
  ).n;

  const timeline = db
    .prepare(
      "SELECT conversation_id AS conversationId, direction, created_at AS createdAt FROM messages WHERE clinic_id = ? ORDER BY conversation_id, created_at, rowid",
    )
    .all(clinicId) as { conversationId: string; direction: "in" | "out"; createdAt: number }[];

  const firstIn = new Map<string, number>();
  const firstReply = new Map<string, number>();
  for (const row of timeline) {
    if (row.direction === "in" && !firstIn.has(row.conversationId)) {
      firstIn.set(row.conversationId, row.createdAt);
    }
    if (row.direction === "out" && firstIn.has(row.conversationId) && !firstReply.has(row.conversationId)) {
      firstReply.set(row.conversationId, row.createdAt);
    }
  }
  const gaps = [...firstReply.entries()].map(([id, replyAt]) => (replyAt - (firstIn.get(id) ?? replyAt)) / 60_000);

  const conversationRows = db
    .prepare(
      "SELECT id, patient_phone AS patientPhone, state, last_message_at AS lastMessageAt FROM conversations WHERE clinic_id = ? ORDER BY last_message_at DESC LIMIT 8",
    )
    .all(clinicId) as { id: string; patientPhone: string; state: string; lastMessageAt: number }[];

  const messageStmt = db.prepare(
    "SELECT id, direction, body, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 8",
  );

  const conversationViews: ConversationView[] = conversationRows.map((row) => {
    let needsHuman = false;
    try {
      needsHuman = Boolean((JSON.parse(row.state) as { needsHuman?: boolean }).needsHuman);
    } catch {
      needsHuman = false;
    }
    const recent = (messageStmt.all(row.id) as MessageView[]).reverse();
    return {
      id: row.id,
      patientPhone: row.patientPhone,
      needsHuman,
      lastMessageAt: row.lastMessageAt,
      messages: recent,
    };
  });

  const appointments = db
    .prepare(
      `SELECT a.id, a.starts_at AS startMs, a.status, s.name AS serviceName,
              pr.name AS practitionerName, p.phone AS patientPhone,
              a.external_id AS externalId
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         JOIN practitioners pr ON pr.id = a.practitioner_id
         JOIN patients p ON p.id = a.patient_id
        WHERE a.clinic_id = ?
        ORDER BY a.starts_at DESC LIMIT 10`,
    )
    .all(clinicId) as AppointmentView[];

  return {
    clinic,
    metrics: {
      conversations,
      inbound: counts("in"),
      outbound: counts("out"),
      bookings,
      cancelled,
      medianFirstResponseMin: median(gaps),
    },
    conversations: conversationViews,
    appointments,
  };
}
