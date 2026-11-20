import { describe, expect, it } from "vitest";
import { bookAppointment, findSlots } from "../lib/booking";
import { formatTime, zonedToUtc } from "../lib/time";
import { CLINIC_ID, DUBAI_NOW, addPatient, createTestDb } from "./fixtures";

describe("availability", () => {
  it("returns a 30-minute grid inside working hours, after the lead time", () => {
    const db = createTestDb();
    const slots = findSlots(db, {
      clinicId: CLINIC_ID,
      serviceId: "s-30",
      fromMs: DUBAI_NOW,
      days: 1,
      limit: 4,
      leadMinutes: 120,
    });

    expect(slots).toHaveLength(4);
    expect(formatTime(slots[0].startMs, "Asia/Dubai")).toBe("10:00");
    expect(slots[0].startMs).toBe(zonedToUtc("Asia/Dubai", 2026, 11, 20, 10, 0));
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startMs).toBeGreaterThan(slots[i - 1].startMs);
    }
  });

  it("hides every slot blocked by a longer booking", () => {
    const db = createTestDb();
    const patientId = addPatient(db);
    const [slot] = findSlots(db, {
      clinicId: CLINIC_ID,
      serviceId: "s-30",
      fromMs: DUBAI_NOW,
      days: 1,
      limit: 1,
      leadMinutes: 120,
    });

    const booked = bookAppointment(db, {
      clinicId: CLINIC_ID,
      serviceId: "s-60",
      practitionerId: "p-test",
      patientId,
      startMs: slot.startMs,
      now: DUBAI_NOW,
    });
    expect(booked.ok).toBe(true);

    const remaining = findSlots(db, {
      clinicId: CLINIC_ID,
      serviceId: "s-30",
      fromMs: DUBAI_NOW,
      days: 1,
      limit: 12,
      leadMinutes: 120,
    });

    expect(remaining.some((s) => s.startMs === slot.startMs)).toBe(false);
    expect(remaining.some((s) => s.startMs === slot.startMs + 30 * 60_000)).toBe(false);
  });

  it("rejects a second booking for the same practitioner and start time", () => {
    const db = createTestDb();
    const patientId = addPatient(db);
    const [slot] = findSlots(db, {
      clinicId: CLINIC_ID,
      serviceId: "s-30",
      fromMs: DUBAI_NOW,
      days: 1,
      limit: 1,
      leadMinutes: 120,
    });

    const input = {
      clinicId: CLINIC_ID,
      serviceId: "s-30",
      practitionerId: "p-test",
      patientId,
      startMs: slot.startMs,
      now: DUBAI_NOW,
    };

    expect(bookAppointment(db, input)).toEqual({ ok: true, appointmentId: expect.any(String) });
    expect(bookAppointment(db, input)).toEqual({ ok: false, reason: "slot_taken" });
  });
});

describe("timezone conversion", () => {
  it("crosses the London spring-forward boundary correctly", () => {
    // DST begins 2027-03-28 01:00 UTC; 09:00 local is 08:00 UTC.
    expect(zonedToUtc("Europe/London", 2027, 3, 28, 9, 0)).toBe(Date.UTC(2027, 2, 28, 8, 0));
  });

  it("keeps GMT during winter", () => {
    expect(zonedToUtc("Europe/London", 2026, 11, 20, 9, 0)).toBe(Date.UTC(2026, 10, 20, 9, 0));
  });

  it("handles half-hour offsets", () => {
    expect(zonedToUtc("Asia/Kolkata", 2026, 11, 20, 10, 0)).toBe(Date.UTC(2026, 10, 20, 4, 30));
  });
});
