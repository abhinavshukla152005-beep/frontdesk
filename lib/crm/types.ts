export type UpsertContactInput = {
  locationId: string;
  phone: string;
  name?: string;
};

export type CreateAppointmentInput = {
  locationId: string;
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title: string;
};

export type CrmClient = {
  readonly name: string;
  upsertContact(input: UpsertContactInput): Promise<{ externalId: string }>;
  createAppointment(input: CreateAppointmentInput): Promise<{ externalId: string }>;
  cancelAppointment(input: { locationId: string; eventId: string }): Promise<void>;
};
