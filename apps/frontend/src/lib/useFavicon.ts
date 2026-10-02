"use client";

import { useEffect } from "react";

/** Every way a page declares its favicon. */
const ICON_SELECTOR = 'link[rel="icon"], link[rel="shortcut icon"]';
/** A link with a rel the browser does not know is ignored. */
const PARKED_REL = "lumio-parked-icon";

/**
 * Shows `url` as the tab's icon (a studio's or a branding's own favicon) for as
 * long as the calling component is mounted. Without a url the default stays.
 *
 * The root layout declares several icons (SVG plus two PNG sizes, see
 * app/layout.tsx), and browsers prefer the size-annotated PNGs, so adding one
 * more link is not enough: the default icons have to get out of the way.
 *
 * They must not be removed from the DOM, though. Next renders them with every
 * page's metadata, so React owns those nodes and removes them itself on the
 * next navigation. Finding one already gone, React throws mid-commit ("can't
 * access property removeChild, parentNode is null") and the app is stuck: the
 * URL changes, the page does not, and nothing navigates any more.
 *
 * So they are parked instead (their rel changed, which the browser ignores) and
 * restored on unmount. Each navigation brings fresh default icons with the new
 * page's metadata; the observer parks those as they arrive.
 */
export function useFavicon(url: string | null | undefined): void {
  useEffect(() => {
    if (!url) return;
    // No type attribute: the browser detects the format itself, and a wrong
    // type makes it discard the icon.
    const own = document.createElement("link");
    own.rel = "icon";
    own.href = url;

    function park() {
      document.querySelectorAll<HTMLLinkElement>(ICON_SELECTOR).forEach((el) => {
        if (el === own) return;
        el.dataset.parkedRel = el.rel;
        el.rel = PARKED_REL;
      });
    }

    park();
    document.head.appendChild(own);
    const observer = new MutationObserver(park);
    observer.observe(document.head, { childList: true });

    return () => {
      observer.disconnect();
      own.remove();
      document
        .querySelectorAll<HTMLLinkElement>(`link[rel="${PARKED_REL}"]`)
        .forEach((el) => {
          el.rel = el.dataset.parkedRel ?? "icon";
          delete el.dataset.parkedRel;
        });
    };
  }, [url]);
}
