import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HighLevelCrm } from "../lib/crm/highlevel";

type Captured = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

let server: Server;
let baseUrl: string;
let captured: Captured[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      captured.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: raw ? JSON.parse(raw) : null,
      });

      response.setHeader("content-type", "application/json");
      if (request.url === "/contacts/upsert") {
        response.end(JSON.stringify({ contact: { id: "contact-1" } }));
        return;
      }
      if (request.method === "POST" && request.url === "/calendars/events/appointments") {
        response.end(JSON.stringify({ appointment: { id: "event-1" } }));
        return;
      }
      if (request.method === "PUT" && request.url?.startsWith("/calendars/events/appointments/")) {
        response.end("{}");
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  captured = [];
});

describe("HighLevel API client", () => {
  it("upserts a contact with the versioned agency token", async () => {
    const crm = new HighLevelCrm("test-token", baseUrl);

    const result = await crm.upsertContact({ locationId: "loc-1", phone: "+971500000111" });

    expect(result).toEqual({ externalId: "contact-1" });
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/contacts/upsert");
    expect(captured[0].headers.authorization).toBe("Bearer test-token");
    expect(captured[0].headers.version).toBe("2021-07-28");
    expect(captured[0].body).toMatchObject({ locationId: "loc-1", phone: "+971500000111", source: "Frontdesk" });
  });

  it("creates a calendar appointment and maps the response id", async () => {
    const crm = new HighLevelCrm("test-token", baseUrl);
    const startTime = "2026-11-21T06:00:00.000Z";
    const endTime = "2026-11-21T06:30:00.000Z";

    const result = await crm.createAppointment({
      locationId: "loc-1",
      calendarId: "cal-1",
      contactId: "contact-1",
      startTime,
      endTime,
      title: "Consultation",
    });

    expect(result).toEqual({ externalId: "event-1" });
    expect(captured[0].url).toBe("/calendars/events/appointments");
    expect(captured[0].body).toMatchObject({
      locationId: "loc-1",
      calendarId: "cal-1",
      contactId: "contact-1",
      startTime,
      endTime,
      appointmentStatus: "confirmed",
    });
  });

  it("cancels through the update endpoint", async () => {
    const crm = new HighLevelCrm("test-token", baseUrl);

    await crm.cancelAppointment({ locationId: "loc-1", eventId: "event-1" });

    expect(captured[0].method).toBe("PUT");
    expect(captured[0].url).toBe("/calendars/events/appointments/event-1");
    expect(captured[0].body).toMatchObject({ locationId: "loc-1", appointmentStatus: "cancelled" });
  });

  it("surfaces API errors with status and body", async () => {
    const failing = new HighLevelCrm("test-token", `${baseUrl}/missing`);
    await expect(failing.upsertContact({ locationId: "loc-1", phone: "+971500000111" })).rejects.toThrow(
      /highlevel_404/,
    );
  });
});
