// The clinic page. The page's own forms and the assistant's actions call the same
// methods on App.page, and the rules live in js/clinic-core.js.
import {
  CLINIC,
  POLICIES,
  SERVICES,
  ClinicStore,
  bookableDays,
  clinicToday,
  dateLabel,
  money,
  serviceById,
} from "./js/clinic-core.js";

function $(id) {
  return document.querySelector(`#${id}`);
}

function setText(id, text) {
  const element = $(id);
  if (element) {
    element.textContent = text;
  }
}

function clear(id) {
  const element = $(id);
  if (element) {
    element.replaceChildren();
  }
}

function appendRow(containerId, label, value) {
  const container = $(containerId);
  if (!container) {
    return;
  }
  const row = document.createElement("div");
  row.className = "row";
  const term = document.createElement("span");
  term.className = "row-label";
  term.textContent = label;
  const detail = document.createElement("span");
  detail.textContent = value;
  row.append(term, detail);
  container.append(row);
}

/**
 * The page object. It owns one store, so the visible forms and the assistant act on the
 * same bookings.
 */
export class App {
  static page = new App();

  constructor() {
    this.store = new ClinicStore();
    this.draft = {
      serviceId: SERVICES[0].id,
      date: clinicToday(),
      time: "",
      name: "",
      phone: "",
      notes: "",
    };
    this.latestBooking = null;
    this.latestCancellation = null;
    this.searchResult = null;
  }

  /** The ids the assistant may choose from, so it cannot invent a service. */
  catalogIds() {
    return SERVICES.map((service) => service.id);
  }

  /** Fill the page's static facts and forms. Safe to call twice. */
  render() {
    setText("clinic-address", CLINIC.address);
    setText("clinic-phone", CLINIC.phone);
    setText("clinic-hours", CLINIC.hours);
    setText("clinic-practitioner", CLINIC.practitioner);
    setText("policy-cancellation", POLICIES.cancellation);
    setText("policy-payment", POLICIES.payment);
    setText("policy-reminders", POLICIES.reminders);
    setText("policy-records", POLICIES.records);

    const cards = $("service-cards");
    if (cards) {
      cards.replaceChildren();
      for (const service of SERVICES) {
        const card = document.createElement("article");
        card.className = "card";
        const title = document.createElement("h3");
        title.textContent = service.name;
        const price = document.createElement("p");
        price.className = "price";
        price.textContent = `${money(service.priceCents)} · ${service.durationMinutes} min`;
        const description = document.createElement("p");
        description.textContent = service.description;
        card.append(title, price, description);
        cards.append(card);
      }
    }

    for (const selectId of ["search-service", "book-service"]) {
      const select = $(selectId);
      if (!select) {
        continue;
      }
      select.replaceChildren();
      for (const service of SERVICES) {
        select.append(new Option(service.name, service.id));
      }
    }
  }

  /** What the assistant reads: the clinic, the services, the diary and the visitor's draft. */
  getState() {
    const state = this.store.state();
    return {
      ...state,
      pageFacts: {
        address: this.fact("clinic-address", CLINIC.address),
        phone: this.fact("clinic-phone", CLINIC.phone),
        hours: this.fact("clinic-hours", CLINIC.hours),
        practitioner: this.fact("clinic-practitioner", CLINIC.practitioner),
        cancellationPolicy: this.fact("policy-cancellation", POLICIES.cancellation),
        paymentPolicy: this.fact("policy-payment", POLICIES.payment),
      },
      draft: { ...this.draft },
      latestBooking: this.latestBooking,
      latestSearch: this.searchResult,
      version: this.store.version,
    };
  }

  /** Read a page fact, falling back to the same text the page renders from. */
  fact(id, fallback) {
    const element = $(id);
    const text = element ? String(element.textContent || "").trim() : "";
    return text || fallback;
  }

  /** Answer an availability question without touching the page. */
  checkAvailability(args) {
    const service = serviceById(args.serviceId);
    if (!service) {
      return { ok: false, reason: "Choose one of the listed services.", field: "serviceId" };
    }
    if (!bookableDays().some((day) => day.date === args.date)) {
      return { ok: false, reason: "The diary is open for the next 14 days only. Use a date from bookableDays.", field: "date" };
    }
    if (!bookableDays().find((day) => day.date === args.date).open) {
      return { ok: false, reason: `The clinic is closed on ${args.date}.`, field: "date" };
    }
    const slots = this.store.openSlots(service.id, args.date);
    return {
      ok: true,
      service: service.name,
      date: args.date,
      dateLabel: dateLabel(args.date),
      price: money(service.priceCents),
      priceCents: service.priceCents,
      durationMinutes: service.durationMinutes,
      slots: slots.map((time) => ({ time, label: `${dateLabel(args.date)}, ${time}` })),
      version: this.store.version,
    };
  }

  /** Put a booking request in the visible form. Reversible. */
  fillBookingForm(args) {
    const service = serviceById(args.serviceId);
    if (!service) {
      return { ok: false, reason: "Choose one of the listed services.", field: "serviceId" };
    }
    const day = bookableDays().find((entry) => entry.date === args.date);
    if (!day) {
      return { ok: false, reason: "The diary is open for the next 14 days only.", field: "date" };
    }
    if (!day.open) {
      return { ok: false, reason: `The clinic is closed on ${day.weekday}.`, field: "date" };
    }
    if (!this.store.openSlots(service.id, args.date).includes(args.time)) {
      return { ok: false, reason: `${args.time} is not a free start time for ${service.name} on ${day.label}.`, field: "time" };
    }
    const name = String(args.name ?? "").trim();
    const notes = String(args.notes ?? "").trim();
    if (name.length > 80) {
      return { ok: false, reason: "The name is too long. Use at most 80 characters.", field: "name" };
    }
    if (notes.length > 300) {
      return { ok: false, reason: "The note is too long. Use at most 300 characters.", field: "notes" };
    }
    this.draft = {
      serviceId: args.serviceId,
      date: args.date,
      time: args.time,
      name,
      phone: String(args.phone ?? "").trim(),
      notes,
    };
    this.renderDraft();
    this.renderTimes(this.draft.serviceId, this.draft.date);
    setText("book-result", `Form filled for ${service.name} on ${day.label} at ${args.time}. Fill in anything missing, then press Book appointment.`);
    return { ok: true, draft: { ...this.draft }, version: this.store.bump() };
  }

  /** Book the slot. The assistant asks the visitor first; the page's button does not. */
  bookAppointment(args) {
    const receipt = this.store.book(args);
    if (!receipt.ok) {
      setText("book-result", receipt.reason);
      return receipt;
    }
    this.latestBooking = receipt.booking;
    this.draft = { ...this.draft, ...args, time: "" };
    this.renderTimes(args.serviceId, args.date);
    this.renderBooking(receipt.booking);
    return receipt;
  }

  /** Read one of the visitor's own bookings. */
  lookUpBooking(args) {
    const check = this.store.checkCancel({ code: args.code, name: args.name });
    if (!check.ok) {
      return check;
    }
    return { ok: true, booking: check.booking, feeCents: check.feeCents, fee: check.fee, version: this.store.version };
  }

  /** Cancel after the visitor confirms the fee. */
  cancelAppointment(args) {
    const receipt = this.store.cancel(args);
    if (!receipt.ok) {
      setText("manage-result", receipt.reason);
      return receipt;
    }
    this.latestCancellation = receipt;
    this.renderCancellation(receipt);
    return receipt;
  }

  /** The read-only check the confirmation dialogs and site.js share. */
  checkBooking(args) {
    return this.store.checkBooking(args);
  }

  checkCancellation(args) {
    return this.store.checkCancel(args);
  }

  renderDraft() {
    const values = {
      "book-service": this.draft.serviceId,
      "book-date": this.draft.date,
      "book-name": this.draft.name,
      "book-phone": this.draft.phone,
      "book-notes": this.draft.notes,
    };
    for (const [id, value] of Object.entries(values)) {
      const element = $(id);
      if (element) {
        element.value = value;
      }
    }
  }

  /** Offer the start times that are free for the chosen service and day. */
  renderTimes(serviceId, date) {
    const select = $("book-time");
    if (!select) {
      return;
    }
    select.replaceChildren();
    const slots = serviceId && date ? this.store.openSlots(serviceId, date) : [];
    for (const time of slots) {
      select.append(new Option(time, time));
    }
    if (slots.length) {
      select.value = this.draft.time || slots[0];
    }
  }

  renderBooking(booking) {
    clear("book-result");
    const container = $("book-result");
    if (!container) {
      return;
    }
    const heading = document.createElement("p");
    heading.className = "receipt-title";
    heading.textContent = `Booked. Your code is ${booking.code}.`;
    container.append(heading);
    appendRow("book-result", "Service", `${booking.service} (${booking.durationMinutes} min)`);
    appendRow("book-result", "When", `${booking.dateLabel} at ${booking.time}, clinic time`);
    appendRow("book-result", "Price", `${booking.price}, paid at the clinic`);
    appendRow("book-result", "Name", booking.name);
  }

  renderCancellation(receipt) {
    clear("manage-result");
    const container = $("manage-result");
    if (!container) {
      return;
    }
    const heading = document.createElement("p");
    heading.className = "receipt-title";
    heading.textContent = `Cancelled booking ${receipt.code}.`;
    container.append(heading);
    appendRow("manage-result", "Service", receipt.service);
    appendRow("manage-result", "Was", `${receipt.dateLabel} at ${receipt.time}`);
    appendRow("manage-result", "Cancellation fee", receipt.fee);
  }

  /** Wire the page's own buttons. They call the same methods as the assistant. */
  start() {
    this.render();
    this.renderDraft();
    this.renderTimes(this.draft.serviceId, this.draft.date);

    $("search-submit")?.addEventListener("click", () => {
      const result = this.checkAvailability({
        serviceId: $("search-service").value,
        date: $("search-date").value,
      });
      const container = $("search-result");
      if (!container) {
        return;
      }
      container.replaceChildren();
      if (!result.ok) {
        setText("search-result", result.reason);
        return;
      }
      this.searchResult = result;
      const heading = document.createElement("p");
      heading.textContent = `${result.service} on ${result.dateLabel}: ${result.price}`;
      container.append(heading);
      if (!result.slots.length) {
        const none = document.createElement("p");
        none.textContent = "No free times that day. Try another date.";
        container.append(none);
        return;
      }
      const list = document.createElement("div");
      list.className = "slots";
      for (const slot of result.slots) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot";
        button.textContent = slot.time;
        button.addEventListener("click", () => {
          const filled = this.fillBookingForm({
            serviceId: $("search-service").value,
            date: result.date,
            time: slot.time,
          });
          if (filled.ok) {
            this.focusName();
          } else {
            setText("book-result", filled.reason);
          }
        });
        list.append(button);
      }
      container.append(list);
    });

    $("book-submit")?.addEventListener("click", () => {
      const receipt = this.bookAppointment({
        serviceId: $("book-service").value,
        date: $("book-date").value,
        time: $("book-time").value,
        name: $("book-name").value,
        phone: $("book-phone").value,
        notes: $("book-notes").value,
      });
      if (receipt.ok) {
        $("book-name").value = "";
        $("book-phone").value = "";
        $("book-notes").value = "";
      }
    });

    $("manage-submit")?.addEventListener("click", () => {
      const code = $("manage-code").value;
      const name = $("manage-name").value;
      const lookup = this.lookUpBooking({ code, name });
      if (!lookup.ok) {
        setText("manage-result", lookup.reason);
        return;
      }
      const container = $("manage-result");
      container.replaceChildren();
      const heading = document.createElement("p");
      heading.textContent = `Booking ${lookup.booking.code}: ${lookup.booking.service}, ${lookup.booking.dateLabel} at ${lookup.booking.time}.`;
      container.append(heading);
      appendRow("manage-result", "Cancellation fee now", lookup.fee);
      const button = document.createElement("button");
      button.type = "button";
      button.id = "manage-cancel";
      button.textContent = `Cancel booking and accept the ${lookup.fee} fee`;
      button.addEventListener("click", () => {
        this.cancelAppointment({
          code,
          name,
          expectedFeeCents: lookup.feeCents,
        });
      });
      container.append(button);
    });
  }

  focusName() {
    $("book-name")?.focus();
  }
}

if (typeof document !== "undefined") {
  App.page.start();
}
