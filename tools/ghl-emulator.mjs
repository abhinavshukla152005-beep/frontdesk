/**
 * Local emulator of the subset of the HighLevel API this app uses.
 *
 * It exists so the integration can be built, demoed and tested without a paid
 * HighLevel account. It is NOT HighLevel: response shapes are modelled on the
 * public API v2 docs and should be re-checked against a live account.
 *
 * Run: npm run ghl:mock
 * Point the app at it:
 *   GHL_API_TOKEN=emulator GHL_BASE_URL=http://127.0.0.1:4010 npm run dev
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);

const contacts = new Map();
const appointments = new Map();
let sequence = 0;

function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const body = await readJson(request);
  console.log(`${request.method} ${url.pathname}`);

  if (url.pathname === "/__state") {
    return send(response, 200, {
      contacts: [...contacts.values()],
      appointments: [...appointments.values()],
    });
  }

  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.trim() === "Bearer") {
    return send(response, 401, { error: "unauthorized" });
  }

  if (request.method === "POST" && url.pathname === "/contacts/upsert") {
    if (!body.locationId || !body.phone) return send(response, 400, { error: "locationId and phone required" });
    const key = `${body.locationId}:${body.phone}`;
    let contact = contacts.get(key);
    if (!contact) {
      contact = { id: nextId("em-ct"), locationId: body.locationId, phone: body.phone, name: body.name ?? null };
      contacts.set(key, contact);
    }
    return send(response, 200, { contact: { id: contact.id } });
  }

  if (request.method === "POST" && url.pathname === "/calendars/events/appointments") {
    const contact = [...contacts.values()].find((c) => c.id === body.contactId);
    if (!contact) return send(response, 400, { error: "contact_not_found" });
    if (!body.calendarId) return send(response, 400, { error: "calendarId required" });

    const appointment = {
      id: nextId("em-ev"),
      locationId: body.locationId,
      calendarId: body.calendarId,
      contactId: body.contactId,
      startTime: body.startTime,
      endTime: body.endTime,
      title: body.title ?? null,
      status: body.appointmentStatus ?? "confirmed",
    };
    appointments.set(appointment.id, appointment);
    return send(response, 200, { appointment: { id: appointment.id } });
  }

  const update = url.pathname.match(/^\/calendars\/events\/appointments\/([^/]+)$/);
  if (request.method === "PUT" && update) {
    const appointment = appointments.get(update[1]);
    if (!appointment) return send(response, 404, { error: "appointment_not_found" });
    appointment.status = body.appointmentStatus ?? appointment.status;
    return send(response, 200, { appointment: { id: appointment.id, status: appointment.status } });
  }

  return send(response, 404, { error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`HighLevel emulator on http://127.0.0.1:${PORT}`);
});
