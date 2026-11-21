// Registers this page's operations with the agent runtime. agent-manifest.json loads
// this module through "actions.module"; only the names in "actions.agentTools" become
// model tools, called website_<name>. Every one wraps a method on App.page, so the
// assistant and the page's own forms follow the same rules.
import { App } from "./app.js";

const SERVICE_IDS = App.page.catalogIds();

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.availabilityAction());
    actions.register(SiteActions.fillFormAction());
    actions.register(SiteActions.bookAction());
    actions.register(SiteActions.lookUpAction());
    actions.register(SiteActions.cancelAction());
  }

  static readStateAction() {
    return {
      name: "get_clinic_state",
      description:
        "Read the clinic's name, address, phone, hours and cancellation policy, the services with prices, today's clinic date, the next 14 days with the days the clinic is open, and the visitor's booking-form draft. Call it before answering about services, prices, opening hours or policies, and again in each turn that needs current data: the visitor can also use the page's forms.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readState,
    };
  }

  static readState() {
    return App.page.getState();
  }

  static availabilityAction() {
    return {
      name: "check_availability",
      description:
        "List the free start times for one service on one date, with the price, without changing the page. Pass a date from bookableDays in website_get_clinic_state. Returns ok false with a reason when the clinic is closed that day, the date is outside the diary, or no time is free. Use its times for website_fill_booking_form and website_book_appointment.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "date"],
        properties: {
          serviceId: {
            type: "string",
            enum: SERVICE_IDS,
            description: "Service id from website_get_clinic_state.",
          },
          date: {
            type: "string",
            description: "Date as YYYY-MM-DD, from bookableDays in website_get_clinic_state.",
          },
        },
      },
      execute: (args) => App.page.checkAvailability(args),
    };
  }

  static fillFormAction() {
    return {
      name: "fill_booking_form",
      description:
        "Put a service, date, time and optional patient details into the visible booking form, so the visitor can finish it by hand. Changes nothing else and books nothing. Call it only when the visitor asks to fill the form. The time must be free: call website_check_availability first in the same turn and use one of its times. Returns the draft, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "date", "time"],
        properties: {
          serviceId: {
            type: "string",
            enum: SERVICE_IDS,
            description: "Service id from website_get_clinic_state.",
          },
          date: {
            type: "string",
            description: "Date as YYYY-MM-DD, from bookableDays in website_get_clinic_state.",
          },
          time: {
            type: "string",
            description: "Start time as HH:MM, from website_check_availability.",
          },
          name: {
            type: "string",
            maxLength: 80,
            description: "The patient's full name, only when the visitor gave it.",
          },
          phone: {
            type: "string",
            maxLength: 20,
            description: "The patient's phone, only when the visitor gave it.",
          },
          notes: {
            type: "string",
            maxLength: 300,
            description: "Anything the visitor wants the clinic to know, in their words.",
          },
        },
      },
      execute: (args) => App.page.fillBookingForm(args),
    };
  }

  static bookAction() {
    return {
      name: "book_appointment",
      description:
        "Book one appointment and return its booking code. Ask the visitor for the full name and a phone number first, and use a time from website_check_availability in the same turn: slots change, and a taken time is refused. The browser asks the visitor to confirm before it runs. Returns the booking receipt with the code, or ok false with the site's reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "date", "time", "name", "phone"],
        properties: {
          serviceId: {
            type: "string",
            enum: SERVICE_IDS,
            description: "Service id from website_get_clinic_state.",
          },
          date: {
            type: "string",
            description: "Date as YYYY-MM-DD, from bookableDays in website_get_clinic_state.",
          },
          time: {
            type: "string",
            description: "Start time as HH:MM, from website_check_availability.",
          },
          name: {
            type: "string",
            minLength: 2,
            maxLength: 80,
            description: "The patient's full name, as the visitor gave it.",
          },
          phone: {
            type: "string",
            minLength: 9,
            maxLength: 20,
            description: "The patient's phone, with country code when the visitor gave one.",
          },
          notes: {
            type: "string",
            maxLength: 300,
            description: "Optional note for the clinic, in the visitor's words. Leave it out when there is none.",
          },
        },
      },
      execute: (args) => App.page.bookAppointment(args),
    };
  }

  static lookUpAction() {
    return {
      name: "look_up_booking",
      description:
        "Read one of the visitor's own bookings by its code and the name it was booked under, with the cancellation fee that applies now. Changes nothing. Call it before answering about a booking and in the same turn as website_cancel_appointment, whose expectedFeeCents comes from its result. A near miss in the code or name is refused. The demo record FD-4K2Q under Nadia Farouk is listed on the page.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "name"],
        properties: {
          code: {
            type: "string",
            minLength: 2,
            maxLength: 10,
            description: "Booking code, such as FD-4K2Q.",
          },
          name: {
            type: "string",
            minLength: 2,
            maxLength: 80,
            description: "The name the booking was made under.",
          },
        },
      },
      execute: (args) => App.page.lookUpBooking(args),
    };
  }

  static cancelAction() {
    return {
      name: "cancel_appointment",
      description:
        "Cancel one booking and return the cancellation fee charged. Ask the visitor to confirm the fee in words first, and call website_look_up_booking in the same turn: expectedFeeCents must be the feeCents it just returned, because the fee grows inside 24 hours. The browser then asks the visitor to confirm. The site refuses a wrong code or name, and a stale fee. Returns the receipt, or ok false with a reason.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "name", "expectedFeeCents"],
        properties: {
          code: {
            type: "string",
            minLength: 2,
            maxLength: 10,
            description: "Booking code from the visitor or from the booking receipt.",
          },
          name: {
            type: "string",
            minLength: 2,
            maxLength: 80,
            description: "The name the booking was made under.",
          },
          expectedFeeCents: {
            type: "integer",
            minimum: 0,
            description: "The feeCents from website_look_up_booking in this turn.",
          },
        },
      },
      execute: (args) => App.page.cancelAppointment(args),
    };
  }
}

export const registerActions = SiteActions.registerActions;
