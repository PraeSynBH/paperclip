import { afterEach, describe, expect, it, vi } from "vitest";

describe("SMTP graceful degradation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isSmtpConfigured returns false when SMTP env vars are unset", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");

    const { isSmtpConfigured } = await import("./notifications.js");
    expect(isSmtpConfigured()).toBe(false);
  });

  it("isSmtpConfigured returns false when only SMTP_HOST is set", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");

    const { isSmtpConfigured } = await import("./notifications.js");
    expect(isSmtpConfigured()).toBe(false);
  });

  it("sendEmailViaSmtp returns false without throwing when SMTP not configured", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");

    const { sendEmailViaSmtp } = await import("./notifications.js");
    const result = await sendEmailViaSmtp({
      to: "test@example.com",
      subject: "Test",
      text: "Hello",
    });
    expect(result).toBe(false);
  });
});

describe("VAPID push graceful degradation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isVapidConfigured returns false when VAPID env vars are unset", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");

    const { isVapidConfigured } = await import("./notifications.js");
    expect(isVapidConfigured()).toBe(false);
  });

  it("isVapidConfigured returns false when only one key is set", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "abc123");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");

    const { isVapidConfigured } = await import("./notifications.js");
    expect(isVapidConfigured()).toBe(false);
  });

  it("sendWebPush returns false without importing web-push when VAPID not configured", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");

    const { sendWebPush } = await import("./notifications.js");
    const result = await sendWebPush(
      { endpoint: "https://example.com/push", p256dh: "abc", auth: "def" },
      { title: "Test", body: "Hello" },
    );
    expect(result).toBe(false);
  });
});
