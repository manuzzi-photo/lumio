"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "lumio.studio.filenames";

/**
 * Dateinamen in den STUDIO-Ansichten anzeigen (Grid, Lightbox, Proofing).
 *
 * Bewusst eine Geraete-Praeferenz im localStorage und kein Galerie- oder
 * Tenant-Setting: intern ist der Dateiname ein Arbeitswerkzeug
 * (Lightroom-Abgleich, Rueckfragen, Druckauftraege), und es gibt keinen
 * Grund, dass jemand anderes vorgibt, ob ein Fotograf seine eigenen
 * Dateinamen sieht.
 *
 * Davon voellig unabhaengig ist, was der KUNDE sieht — das ist
 * Gallery.customerLabelMode und wird serverseitig entschieden.
 *
 * Als Hook und nicht dreimal inline, weil die Praeferenz in mehreren
 * Routen gelesen wird (Galerie-Detail und Proofing sind getrennte
 * Seiten) und sonst irgendwann zwei verschiedene localStorage-Keys
 * entstehen.
 */
export function useShowFilenames(): {
  showFilenames: boolean;
  toggleFilenames: () => void;
} {
  // Start true und erst im Effect korrigieren: waehrend SSR/Hydration
  // gibt es kein localStorage, und ein abweichender erster Render wuerde
  // einen Hydration-Mismatch erzeugen.
  const [showFilenames, setShowFilenames] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) setShowFilenames(v === "1");
    } catch {
      /* localStorage nicht verfuegbar (Private Mode) — Default greift */
    }
  }, []);

  const toggleFilenames = useCallback(() => {
    setShowFilenames((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return { showFilenames, toggleFilenames };
}
