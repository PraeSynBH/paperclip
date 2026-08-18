import { describe, expect, it } from "vitest";
import {
  renderNotificationEmail,
  renderDigestEmail,
} from "../services/email-templates.js";

describe("renderNotificationEmail", () => {
  it("produces subject, plain text, and HTML with the title and body", () => {
    const email = renderNotificationEmail({
      title: "Review requested: PAP-42",
      body: "The report is ready for your review.",
      linkUrl: "https://example.com/issues/PAP-42",
      recipientName: "Alice",
      companyName: "Acme",
    });

    expect(email.subject).toContain("Review requested");
    expect(email.text).toContain("The report is ready for your review.");
    expect(email.text).toContain("Open: https://example.com/issues/PAP-42");
    expect(email.html).toContain("Review requested: PAP-42");
    expect(email.html).toContain("The report is ready for your review.");
    expect(email.html).toContain("Hi Alice,");
    expect(email.html).toContain("Open in board");
  });

  it("escapes user-controlled content in HTML", () => {
    const email = renderNotificationEmail({
      title: "Review <script>alert(1)</script>",
      body: "Body <img src=x onerror=alert(1)>",
      linkUrl: "javascript:alert(1)",
    });

    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    // The URL is not http(s), so it must be dead-linked rather than injected.
    expect(email.html).toContain('href="#"');
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("falls back to a generic greeting when no recipient name is given", () => {
    const email = renderNotificationEmail({ title: "T", body: "B" });
    expect(email.html).toContain("Hi there,");
  });
});

describe("renderDigestEmail", () => {
  it("lists items with click-through links", () => {
    const email = renderDigestEmail({
      frequency: "daily",
      companyName: "Acme",
      recipientName: "Bob",
      items: [
        { title: "PAP-1 done", body: "First item", linkUrl: "https://example.com/i/1" },
        { title: "PAP-2 review", body: "Second item" },
      ],
    });

    expect(email.subject).toContain("Daily summary");
    expect(email.text).toContain("• PAP-1 done: First item");
    expect(email.html).toContain("PAP-1 done");
    expect(email.html).toContain("PAP-2 review");
    expect(email.html).toContain("Acme");
  });

  it("escapes item content", () => {
    const email = renderDigestEmail({
      frequency: "weekly",
      items: [{ title: "<b>X</b>", body: "a<b>", linkUrl: "https://example.com" }],
    });

    expect(email.html).not.toContain("<b>X</b>");
    expect(email.html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
