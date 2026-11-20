import { randomUUID } from "node:crypto";
import type { Db } from "./db";

export type JobType = "inbound_message" | "reminder" | "crm_contact" | "crm_appointment" | "crm_cancel";

export function enqueue(
  db: Db,
  job: { type: JobType; payload: Record<string, unknown>; runAt?: number },
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO jobs (id, type, payload, run_at, status, attempts, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?)",
  ).run(id, job.type, JSON.stringify(job.payload), job.runAt ?? Date.now(), Date.now());
  return id;
}

type Handler = (payload: Record<string, unknown>) => void | Promise<void>;

export async function processJobs(
  db: Db,
  handlers: Partial<Record<JobType, Handler>>,
  opts: { now?: number; limit?: number } = {},
): Promise<{ processed: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const rows = db
    .prepare("SELECT id, type, payload, attempts FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?")
    .all(now, opts.limit ?? 50) as { id: string; type: JobType; payload: string; attempts: number }[];

  let processed = 0;
  let failed = 0;

  for (const job of rows) {
    const handler = handlers[job.type];
    if (!handler) {
      db.prepare("UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?").run(
        `no handler for ${job.type}`,
        job.id,
      );
      failed++;
      continue;
    }
    try {
      await handler(JSON.parse(job.payload) as Record<string, unknown>);
      db.prepare("UPDATE jobs SET status = 'done', attempts = attempts + 1 WHERE id = ?").run(job.id);
      processed++;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "unknown error";
      if (attempts >= 3) {
        db.prepare("UPDATE jobs SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(
          attempts,
          message,
          job.id,
        );
      } else {
        db.prepare("UPDATE jobs SET attempts = ?, last_error = ?, run_at = ? WHERE id = ?").run(
          attempts,
          message,
          now + 60_000 * 2 ** attempts,
          job.id,
        );
      }
      failed++;
    }
  }

  return { processed, failed };
}

export function cancelPendingReminders(db: Db, appointmentId: string): void {
  const rows = db
    .prepare("SELECT id, payload FROM jobs WHERE status = 'pending' AND type = 'reminder'")
    .all() as { id: string; payload: string }[];
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { appointmentId?: string };
    if (payload.appointmentId === appointmentId) {
      db.prepare("UPDATE jobs SET status = 'failed', last_error = 'appointment cancelled' WHERE id = ?").run(row.id);
    }
  }
}
