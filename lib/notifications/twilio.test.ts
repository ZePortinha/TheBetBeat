import { describe, expect, it, vi } from "vitest";
import { TwilioSmsProvider } from "./twilio";

function provider(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { sms: new TwilioSmsProvider({ accountSid: "AC123", authToken: "secret", from: "BetBeat", fetchImpl }), calls };
}

describe("Twilio SMS", () => {
  it("sends the code as a real SMS", async () => {
    const { sms, calls } = provider(201, { sid: "SM1" });
    expect(await sms.send("+351912345678", "BetBeat: o teu código é 123456.")).toEqual({ ok: true, ref: "SM1" });
    expect(calls[0]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const form = new URLSearchParams(String(calls[0]!.init?.body));
    expect(Object.fromEntries(form)).toEqual({ To: "+351912345678", From: "BetBeat", Body: "BetBeat: o teu código é 123456." });
  });

  it("reports a refusal without throwing", async () => {
    const { sms } = provider(400, { code: 21211, message: "invalid To" });
    expect(await sms.send("+351912345678", "x")).toEqual({ ok: false });
  });
});
