import { useEffect } from "react";

const APP_NAME = "Paperclip";

/**
 * Set the page title and optionally inject/update a `<meta name="description">`
 * tag in `<head>`.
 *
 * Call this at the top level of every page component. Child routes override
 * parent meta — the last call in the tree wins because React bottoms-out
 * effects in insertion order and runs the deepest effect last.
 *
 * @param title - Page-specific title (e.g. "Dashboard"). Appended with
 *   " - Paperclip" automatically. Pass empty string for the bare app name.
 * @param description - Optional meta description.
 */
export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    const fullTitle = title ? `${title} - ${APP_NAME}` : APP_NAME;
    const prevTitle = document.title;
    document.title = fullTitle;

    // Manage <meta name="description">
    const META_SELECTOR = 'meta[name="description"]';
    let metaEl = document.querySelector<HTMLMetaElement>(META_SELECTOR);

    if (description && description.length > 0) {
      if (metaEl) {
        metaEl.setAttribute("content", description);
      } else {
        metaEl = document.createElement("meta");
        metaEl.name = "description";
        metaEl.content = description;
        document.head.appendChild(metaEl);
      }
    } else if (metaEl) {
      // No description provided — remove the tag so crawlers don't read a
      // stale one from a previous page.
      metaEl.remove();
    }

    return () => {
      document.title = prevTitle;
      // Best-effort cleanup: if we created this meta element, remove it.
      // If a deeper component replaced it, leave it alone.
      if (metaEl && document.head.contains(metaEl)) {
        const currentDescription = metaEl.getAttribute("content");
        if (currentDescription === description) {
          metaEl.remove();
        }
      }
    };
    // Intentionally runs only on mount + when inputs change. The cleanup
    // restores the previous values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description]);
}
