# M6 Trial Feature — Release Notes (DRAFT)

**Status:** DRAFT — awaiting production deployment
**Version:** v0.3.0 (estimated)
**When to publish:** After M6 deployment is verified live (RE notifies Support Engineer)

---

## Release Notes Entry

### v0.3.0 — Self-Serve Trial & Onboarding (M6)
**Date:** 2026-08-24

**Category:** New Feature

Self-serve trial signup — create an account and start planning with Sage in under a minute, no credit card required.

- **New signup experience** at voyonder.com/join — sign up with your email (magic link) and start a 7-day free trial immediately. No credit card required.
- **Onboarding wizard** — after signup, choose your travel role and get relevant starter packs deployed to your account automatically. Skip anytime.
- **7-day free trial** on the Explorer tier — full access to Sage AI, trip planning, and collaboration features. Trial reminders before expiry.
- **Simple conversion** — when your trial ends, pick a plan at voyonder.com/pricing and complete Stripe Checkout. Your data is preserved through the transition.
- **Billing portal** — manage your subscription, update payment method, download invoices, or cancel at voyonder.com/settings/billing.
- **Trial expiry grace period** — expired trials preserve your trips and data. Subscribe anytime to re-activate.
- **Under the hood:** All signup, onboarding, and billing routes now run on a dedicated service for improved reliability and separation from the frontend application.

---

## Notes

- This draft should replace the "pending" commit hash on the /documentation/releases page with the actual deployed commit hash.
- The version number v0.3.0 is estimated — confirm with the Release Engineer.
- The "Under the hood" line is intentionally light on technical detail (no mention of Docker, Traefik, or database schemas).