import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTwilioWebhook,
  sendText,
  verifyTwilioSignature,
} from "../lib/whatsapp";

const KEYS = [
  "WHATSAPP_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
] as const;

const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof KEYS)[number],
  string | undefined
>;

function configure(): void {
  process.env.WHATSAPP_PROVIDER = "twilio";
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_AUTH_TOKEN = "secret";
  process.env.TWILIO_WHATSAPP_FROM = "+14155238886";
}

afterEach(() => {
  for (const key of KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  vi.unstubAllGlobals();
});

describe("Twilio outbound", () => {
  it("posts a form-encoded message with Basic auth", async () => {
    configure();
    let captured: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} };
      return new Response("{}", { status: 201 });
    });

    expect(await sendText("+971 50 123 4567", "Hello")).toBe(true);
    expect(captured?.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(captured?.init.method).toBe("POST");

    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(String(captured?.init.body));
    expect(body.get("From")).toBe("whatsapp:+14155238886");
    expect(body.get("To")).toBe("whatsapp:+971501234567");
    expect(body.get("Body")).toBe("Hello");
  });

  it("stays silent when the Twilio credentials are incomplete", async () => {
    configure();
    delete process.env.TWILIO_WHATSAPP_FROM;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await sendText("+971501234567", "Hello")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Twilio inbound", () => {
  const url = "https://frontdesk.example/api/webhooks/twilio";
  const params = new URLSearchParams({
    From: "whatsapp:+971501234567",
    Body: "Hello",
    MessageSid: "SM123",
    To: "whatsapp:+14155238886",
  });

  function sign(): string {
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    let payload = url;
    for (const [key, value] of sorted) payload += key + value;
    return createHmac("sha1", "secret").update(payload).digest("base64");
  }

  it("accepts Twilio's signature and rejects anything else", () => {
    expect(verifyTwilioSignature(url, params, sign(), "secret")).toBe(true);
    expect(verifyTwilioSignature(url, params, "invalid", "secret")).toBe(false);
    expect(verifyTwilioSignature(url, params, sign(), "other-token")).toBe(false);
    expect(verifyTwilioSignature(url, params, null, "secret")).toBe(false);
  });

  it("maps the form fields to an incoming message", () => {
    expect(parseTwilioWebhook(params)).toEqual([
      {
        waMessageId: "SM123",
        from: "971501234567",
        text: "Hello",
        displayPhoneNumber: "whatsapp:+14155238886",
      },
    ]);
  });

  it("ignores non-WhatsApp traffic", () => {
    expect(
      parseTwilioWebhook(new URLSearchParams({ From: "+15550001111", Body: "x", MessageSid: "SM9" })),
    ).toEqual([]);
  });
});
