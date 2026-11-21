// The clinic's data and booking rules. No DOM here: the page, the site actions and the
// tests all call these functions, so they cannot drift apart.

export const CLINIC = {
  name: "Aurora Dental Studio",
  address: "Villa 12, Jumeirah 1, Dubai",
  phone: "+971 50 000 0001",
  timezone: "Asia/Dubai",
  currency: "AED",
  hours: "Sat-Thu 09:00-19:00, Sat until 16:00, closed Friday",
  practitioner: "Dr. Layla Haddad",
};

export const SERVICES = [
  {
    id: "s-consult",
    name: "Consultation",
    durationMinutes: 30,
    priceCents: 15000,
    description: "A 30-minute check-up with the dentist, including a treatment plan.",
  },
  {
    id: "s-cleaning",
    name: "Teeth cleaning",
    durationMinutes: 45,
    priceCents: 25000,
    description: "Scaling and polishing with the hygienist.",
  },
  {
    id: "s-whitening",
    name: "Whitening",
    durationMinutes: 60,
    priceCents: 60000,
    description: "In-chair whitening session, one hour.",
  },
];

export const POLICIES = {
  cancellation:
    "Cancelling is free up to 24 hours before the appointment. Cancelling within 24 hours costs 50% of the service price.",
  payment: "Payment is taken at the clinic. This page takes no payment and no card details.",
  reminders:
    "The clinic's production front desk sends WhatsApp reminders. This demo page sends nothing.",
  records:
    "This page is a demo. Bookings stay in this browser tab and disappear when it is reloaded. Nothing is sent to the clinic.",
};

// 0 = Sunday. The clinic is closed on Friday (5). Saturday is shorter.
const HOURS = {
  0: [540, 1140],
  1: [540, 1140],
  2: [540, 1140],
  3: [540, 1140],
  4: [540, 1140],
  6: [600, 960],
};

const SLOT_STEP = 30;
const BOOKABLE_DAYS = 14;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let nowForTests = null;

/** Pin the clock in tests, so dates are the same on every day. */
export function setNowForTests(fn) {
  nowForTests = fn;
}

function now() {
  return nowForTests ? nowForTests() : new Date();
}

const IS0_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date at the clinic, as YYYY-MM-DD. */
export function clinicToday(at = now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The clinic's wall-clock time in minutes after midnight. */
export function clinicNowMinutes(at = now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour").value);
  const minute = Number(parts.find((part) => part.type === "minute").value);
  return hour * 60 + minute;
}

export function isValidDate(date) {
  if (!IS0_DATE.test(String(date))) {
    return false;
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "Sat 21 Nov" for a date. */
export function dateLabel(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function minutesToTime(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hour}:${String(minutes % 60).padStart(2, "0")}`;
}

export function timeToMinutes(time) {
  if (!/^\d{2}:\d{2}$/.test(String(time))) {
    return null;
  }
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

export function money(cents) {
  return `${CLINIC.currency} ${(cents / 100).toFixed(2)}`;
}

export function serviceById(id) {
  return SERVICES.find((service) => service.id === id) ?? null;
}

export function isOpen(date) {
  return Boolean(HOURS[weekdayOf(date)]);
}

/** The next two weeks of clinic dates, whether open or not. */
export function bookableDays(at = now()) {
  const today = clinicToday(at);
  const days = [];
  for (let offset = 0; offset < BOOKABLE_DAYS; offset++) {
    const date = addDays(today, offset);
    days.push({ date, label: dateLabel(date), weekday: weekdayLabel(date), open: isOpen(date) });
  }
  return days;
}

export function weekdayLabel(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" })
    .format(new Date(`${date}T00:00:00Z`));
}

function normalizeName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function randomCode() {
  let code = "FD-";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * In-memory clinic store. One page has one store, so the page's own forms and the
 * assistant's actions change the same bookings.
 */
export class ClinicStore {
  constructor({ now } = {}) {
    this.clock = now ?? (() => (nowForTests ? nowForTests() : new Date()));
    this.bookings = new Map();
    this.version = 0;
    this.seed();
  }

  seed() {
    const today = clinicToday(this.clock());
    this.addSeed("FD-4K2Q", "Nadia Farouk", "s-consult", addDays(today, 1), "10:30");
    this.addSeed("FD-7X1M", "Omar Haddad", "s-whitening", addDays(today, 3), "14:00");
    this.addSeed("FD-2B9R", "Priya Menon", "s-cleaning", addDays(today, 2), "11:00");
  }

  addSeed(code, name, serviceId, date, time) {
    const service = serviceById(serviceId);
    this.bookings.set(code, {
      code,
      name,
      serviceId,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents,
      date,
      time,
      startMin: timeToMinutes(time),
      status: "booked",
    });
  }

  bump() {
    this.version += 1;
    return this.version;
  }

  /** A booking record or null. Other visitors' records stay out of this. */
  findBooking(code, name) {
    const booking = this.bookings.get(normalizeCode(code));
    if (!booking || booking.status !== "booked") {
      return null;
    }
    return normalizeName(booking.name) === normalizeName(name) ? booking : null;
  }

  /** Start times inside the clinic's hours that no booking occupies. */
  openSlots(serviceId, date) {
    const service = serviceById(serviceId);
    const hours = HOURS[weekdayOf(date)];
    if (!service || !hours) {
      return [];
    }
    const [open, close] = hours;
    const today = clinicToday(this.clock());
    const pastStart = date === today ? clinicNowMinutes(this.clock()) : -1;
    const taken = [...this.bookings.values()]
      .filter((booking) => booking.status === "booked" && booking.date === date);
    const slots = [];
    for (let start = open; start + service.durationMinutes <= close; start += SLOT_STEP) {
      const end = start + service.durationMinutes;
      if (start <= pastStart) {
        continue;
      }
      const clash = taken.some((booking) => start < booking.startMin + booking.durationMinutes
        && booking.startMin < end);
      if (!clash) {
        slots.push(minutesToTime(start));
      }
    }
    return slots;
  }

  /** How many days from the clinic's today the date is. */
  daysAhead(date) {
    const [year, month, day] = date.split("-").map(Number);
    const target = Date.UTC(year, month - 1, day);
    const [ty, tm, td] = clinicToday(this.clock()).split("-").map(Number);
    return Math.round((target - Date.UTC(ty, tm - 1, td)) / DAY_MS);
  }

  /** Check a booking request without changing anything. */
  checkBooking(args) {
    const name = String(args.name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      return { ok: false, reason: "Please give the patient's full name.", field: "name" };
    }
    if (name.length > 80) {
      return { ok: false, reason: "The name is too long. Use at most 80 characters.", field: "name" };
    }
    const digits = String(args.phone ?? "").replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) {
      return { ok: false, reason: "Please give a phone number with 9 to 15 digits.", field: "phone" };
    }
    const notes = String(args.notes ?? "").trim();
    if (notes.length > 300) {
      return { ok: false, reason: "The note is too long. Use at most 300 characters.", field: "notes" };
    }
    const service = serviceById(args.serviceId);
    if (!service) {
      return { ok: false, reason: "Choose one of the listed services.", field: "serviceId" };
    }
    if (!isValidDate(args.date)) {
      return { ok: false, reason: "Give the date as YYYY-MM-DD.", field: "date" };
    }
    const ahead = this.daysAhead(args.date);
    if (ahead < 0) {
      return { ok: false, reason: "That date has passed. Choose today or a later date.", field: "date" };
    }
    if (ahead >= BOOKABLE_DAYS) {
      return { ok: false, reason: `The diary is open for the next ${BOOKABLE_DAYS} days only.`, field: "date" };
    }
    if (!isOpen(args.date)) {
      return { ok: false, reason: `The clinic is closed on ${weekdayLabel(args.date)}s.`, field: "date" };
    }
    const start = timeToMinutes(args.time);
    if (start === null) {
      return { ok: false, reason: "Give the time as HH:MM, on the hour or half hour.", field: "time" };
    }
    const slots = this.openSlots(service.id, args.date);
    if (!slots.includes(args.time)) {
      return {
        ok: false,
        reason: `${args.time} is not free on ${dateLabel(args.date)}. Available: ${slots.join(", ") || "none"}.`,
        field: "time",
      };
    }
    return {
      ok: true,
      service,
      name,
      phone: digits,
      notes,
      date: args.date,
      dateLabel: dateLabel(args.date),
      time: args.time,
      priceCents: service.priceCents,
      price: money(service.priceCents),
    };
  }

  /** Book a slot after the checks pass. */
  book(args) {
    const check = this.checkBooking(args);
    if (!check.ok) {
      return check;
    }
    let code = randomCode();
    while (this.bookings.has(code)) {
      code = randomCode();
    }
    const booking = {
      code,
      name: check.name,
      serviceId: check.service.id,
      serviceName: check.service.name,
      durationMinutes: check.service.durationMinutes,
      priceCents: check.priceCents,
      date: check.date,
      time: check.time,
      startMin: timeToMinutes(check.time),
      phone: check.phone,
      notes: check.notes,
      status: "booked",
    };
    this.bookings.set(code, booking);
    this.bump();
    return { ok: true, booking: this.publicBooking(booking), version: this.version };
  }

  /** A booking as the page and the assistant may show it. */
  publicBooking(booking) {
    return {
      code: booking.code,
      name: booking.name,
      service: booking.serviceName,
      durationMinutes: booking.durationMinutes,
      date: booking.date,
      dateLabel: dateLabel(booking.date),
      time: booking.time,
      priceCents: booking.priceCents,
      price: money(booking.priceCents),
      status: booking.status,
    };
  }

  cancellationFee(booking) {
    const [year, month, day] = booking.date.split("-").map(Number);
    const [hour, minute] = booking.time.split(":").map(Number);
    const appointment = Date.UTC(year, month - 1, day, hour, minute);
    // Both sides are clinic wall-clock times read as UTC, so the offset cancels out.
    const [todayYear, todayMonth, todayDay] = clinicToday(this.clock()).split("-").map(Number);
    const minutes = clinicNowMinutes(this.clock());
    const clinicNow = Date.UTC(todayYear, todayMonth - 1, todayDay, Math.floor(minutes / 60), minutes % 60);
    const hoursAhead = (appointment - clinicNow) / HOUR_MS;
    const feeCents = hoursAhead >= 24 ? 0 : Math.round(booking.priceCents / 2);
    return {
      hoursAhead,
      feeCents,
      fee: money(feeCents),
      freeUntil: hoursAhead >= 24,
    };
  }

  /** Check a cancellation without changing anything. */
  checkCancel(args) {
    const booking = this.findBooking(args.code, args.name);
    if (!booking) {
      return {
        ok: false,
        reason: "No booking matches that code and name. Check both, or ask the clinic.",
        field: "code",
      };
    }
    const fee = this.cancellationFee(booking);
    if (args.expectedFeeCents !== undefined && args.expectedFeeCents !== fee.feeCents) {
      return {
        ok: false,
        reason: `The cancellation fee is now ${fee.fee}. Read the booking again and confirm the new fee.`,
        field: "expectedFeeCents",
      };
    }
    return { ok: true, booking: this.publicBooking(booking), feeCents: fee.feeCents, fee: fee.fee };
  }

  cancel(args) {
    const check = this.checkCancel(args);
    if (!check.ok) {
      return check;
    }
    const booking = this.findBooking(args.code, args.name);
    booking.status = "cancelled";
    this.bump();
    return {
      ok: true,
      code: booking.code,
      service: booking.serviceName,
      dateLabel: dateLabel(booking.date),
      time: booking.time,
      feeCents: check.feeCents,
      fee: check.fee,
      version: this.version,
    };
  }

  /** What the agent and the page read. Other visitors' records are not included. */
  state() {
    const at = this.clock();
    const days = bookableDays(at);
    return {
      clinic: { ...CLINIC, today: clinicToday(at), todayLabel: dateLabel(clinicToday(at)) },
      policies: { ...POLICIES },
      services: SERVICES.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        price: money(service.priceCents),
        description: service.description,
      })),
      bookableDays: days,
      version: this.version,
    };
  }
}
