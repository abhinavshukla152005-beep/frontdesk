import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestInbound } from "../lib/whatsapp";
import { drain } from "../lib/worker";
import { CLINIC_ID, createTestDb } from "./fixtures";

const ORIGINAL = {
  token: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

function configure(): void {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "pn-test";
}

function unconfigure(): void {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
}

type Sent = { url: string; body: { to: string; messaging_product: string; text: { body: string } } };

function stubGraphApi(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) as Sent["body"] });
    return new Response("{}", { status: 200 });
  });
  return sent;
}

afterEach(() => {
  if (ORIGINAL.token === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
  else process.env.WHATSAPP_ACCESS_TOKEN = ORIGINAL.token;
  if (ORIGINAL.phoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  else process.env.WHATSAPP_PHONE_NUMBER_ID = ORIGINAL.phoneNumberId;
  vi.unstubAllGlobals();
});

describe("WhatsApp delivery", () => {
  it("sends webhook replies through the Graph API with a digits-only recipient", async () => {
    configure();
    const sent = stubGraphApi();
    const db = createTestDb();

    ingestInbound(db, CLINIC_ID, {
      waMessageId: "d1",
      from: "+971 50 123 4567",
      text: "Hello",
      displayPhoneNumber: "",
    });
    await drain(db, null);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://graph.facebook.com/v21.0/pn-test/messages");
    expect(sent[0].body.to).toBe("971501234567");
    expect(sent[0].body.messaging_product).toBe("whatsapp");
    expect(sent[0].body.text.body).toContain("Test Clinic");
  });

  it("never sends simulated demo messages, even when credentials exist", async () => {
    configure();
    const sent = stubGraphApi();
    const db = createTestDb();

    ingestInbound(
      db,
      CLINIC_ID,
      { waMessageId: "d2", from: "+971 50 123 4567", text: "Hello", displayPhoneNumber: "" },
      Date.now(),
      "demo",
    );
    await drain(db, null);

    expect(sent).toHaveLength(0);
    const stored = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction = 'out'").get() as { n: number };
    expect(stored.n).toBe(1);
  });

  it("keeps working in local mode with no credentials", async () => {
    unconfigure();
    const sent = stubGraphApi();
    const db = createTestDb();

    ingestInbound(db, CLINIC_ID, {
      waMessageId: "d3",
      from: "+971500000111",
      text: "Hello",
      displayPhoneNumber: "",
    });
    await drain(db, null);

    expect(sent).toHaveLength(0);
    const reply = db.prepare("SELECT body FROM messages WHERE direction = 'out'").get() as { body: string };
    expect(reply.body).toContain("Test Clinic");
  });
});
