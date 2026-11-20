import type { CreateAppointmentInput, CrmClient, UpsertContactInput } from "./types";

const DEFAULT_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

type ContactResponse = { contact?: { id?: string } };
type AppointmentResponse = { id?: string; appointment?: { id?: string } };

/**
 * HighLevel Public API v2 client. The token is an agency-level Private
 * Integration Token; each clinic maps to a HighLevel location (sub-account).
 */
export class HighLevelCrm implements CrmClient {
  readonly name = "highlevel";

  constructor(
    private readonly token: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`highlevel_${response.status}: ${detail.slice(0, 300)}`);
    }

    return (await response.json()) as T;
  }

  async upsertContact(input: UpsertContactInput): Promise<{ externalId: string }> {
    const data = await this.request<ContactResponse>("POST", "/contacts/upsert", {
      locationId: input.locationId,
      phone: input.phone,
      name: input.name ?? undefined,
      source: "Frontdesk",
    });
    const externalId = data.contact?.id;
    if (!externalId) throw new Error("highlevel_contact_id_missing");
    return { externalId };
  }

  async createAppointment(input: CreateAppointmentInput): Promise<{ externalId: string }> {
    const data = await this.request<AppointmentResponse>("POST", "/calendars/events/appointments", {
      locationId: input.locationId,
      calendarId: input.calendarId,
      contactId: input.contactId,
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
      appointmentStatus: "confirmed",
    });
    const externalId = data.id ?? data.appointment?.id;
    if (!externalId) throw new Error("highlevel_appointment_id_missing");
    return { externalId };
  }

  async cancelAppointment(input: { locationId: string; eventId: string }): Promise<void> {
    await this.request<void>("PUT", `/calendars/events/appointments/${input.eventId}`, {
      locationId: input.locationId,
      appointmentStatus: "cancelled",
    });
  }
}
