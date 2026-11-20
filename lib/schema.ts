export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  address TEXT NOT NULL,
  hours_note TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS practitioners (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS working_hours (
  practitioner_id TEXT NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  PRIMARY KEY (practitioner_id, weekday)
);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (clinic_id, phone)
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  practitioner_id TEXT NOT NULL REFERENCES practitioners(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_slot
  ON appointments (practitioner_id, starts_at)
  WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_start
  ON appointments (clinic_id, starts_at);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE (clinic_id, patient_phone)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, run_at);
`;

type SqliteLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(): unknown };
};

type Column = { name: string };

function addColumnIfMissing(db: SqliteLike, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Column[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Versioned migrations. Each entry runs once; PRAGMA user_version tracks progress.
 * Never edit a shipped migration, add a new one.
 */
export const MIGRATIONS: { version: number; run: (db: SqliteLike) => void }[] = [
  {
    version: 1,
    run: (db) => {
      db.exec(SCHEMA);
    },
  },
  {
    version: 2,
    run: (db) => {
      // HighLevel linkage: agency token in env, location + calendar per clinic.
      addColumnIfMissing(db, "clinics", "crm_provider", "TEXT");
      addColumnIfMissing(db, "clinics", "external_location_id", "TEXT");
      addColumnIfMissing(db, "clinics", "external_calendar_id", "TEXT");
      addColumnIfMissing(db, "patients", "external_id", "TEXT");
      addColumnIfMissing(db, "appointments", "external_id", "TEXT");
    },
  },
];
