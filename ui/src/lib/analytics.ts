/**
 * GA4 analytics client-side tracking module.
 *
 * Conditionally loads Google's gtag.js when VITE_GA4_MEASUREMENT_ID is set.
 * This is the PostHog contingency — when PostHog is blocked, GA4 provides
 * client-side page view tracking and event instrumentation.
 *
 * Usage:
 *   import { ga4 } from "@/lib/analytics";
 *   ga4.event("signup", { method: "email" });
 *
 * Environment variables:
 *   VITE_GA4_MEASUREMENT_ID — GA4 measurement ID (e.g. G-XXXXXXXXXX)
 *   VITE_GA4_ENABLED — set to "true" to activate (default: false)
 *
 * Server-side event tracking (business events) is handled separately by
 * server/src/services/ga4-analytics.ts.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID ?? "";
const ENABLED = import.meta.env.VITE_GA4_ENABLED === "true";

let initialized = false;

/**
 * Load the gtag.js script and initialize GA4.
 * Only loads when VITE_GA4_MEASUREMENT_ID is set AND VITE_GA4_ENABLED=true.
 */
function init(): void {
  if (initialized) return;
  if (!ENABLED || !MEASUREMENT_ID) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        `[GA4] analytics disabled (VITE_GA4_ENABLED=${import.meta.env.VITE_GA4_ENABLED ?? "unset"}, VITE_GA4_MEASUREMENT_ID=${MEASUREMENT_ID ? "set" : "unset"})`,
      );
    }
    initialized = true;
    return;
  }

  // Standard gtag.js initialization
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line
  function gtag(...args: unknown[]) { window.dataLayer!.push(args); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    send_page_view: false, // We'll send page views manually
  });

  // Load the gtag.js script
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  initialized = true;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[GA4] initialized with measurement ID ${MEASUREMENT_ID}`);
  }
}

export const ga4 = {
  /** Send a page_view event manually (useful for SPAs). */
  pageView(path: string, title?: string): void {
    init();
    if (!initialized || !window.gtag) return;
    window.gtag("event", "page_view", {
      page_path: path,
      page_title: title ?? document.title,
    });
  },

  /** Send a custom event with optional params. */
  event(name: string, params?: Record<string, string | number | boolean | null | undefined>): void {
    init();
    if (!initialized || !window.gtag) return;
    window.gtag("event", name, params);
  },

  /** Check if GA4 client-side tracking is active. */
  get enabled(): boolean {
    return ENABLED && Boolean(MEASUREMENT_ID);
  },
};

// Auto-initialize on module load (runs at import time)
init();