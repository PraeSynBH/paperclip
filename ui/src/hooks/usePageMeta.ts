import { useEffect } from "react";

/**
 * Set the document title and meta description for the current page.
 * Falls back gracefully on SSR/manual mode changes.
 */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let metaEl: HTMLMetaElement | null = null;
    if (description) {
      metaEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!metaEl) {
        metaEl = document.createElement("meta");
        metaEl.name = "description";
        document.head.appendChild(metaEl);
      }
      metaEl.content = description;
    }

    return () => {
      document.title = prevTitle;
      if (metaEl && description) {
        metaEl.content = "";
      }
    };
  }, [title, description]);
}
