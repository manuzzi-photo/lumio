import { describe, it, expect } from "vitest";
import {
  shouldExposeFilename,
  hasVisibleLabel,
} from "./customerLabel.js";

describe("shouldExposeFilename", () => {
  it("exposes the real filename only in filename mode", () => {
    expect(shouldExposeFilename("filename")).toBe(true);
  });

  it("withholds the filename in hidden mode", () => {
    // Der eigentliche Punkt der Funktion: nicht bloss nicht rendern,
    // sondern gar nicht ausliefern. Sonst steht der Name im
    // Netzwerk-Tab.
    expect(shouldExposeFilename("hidden")).toBe(false);
  });

  it("withholds the filename in index mode", () => {
    // "index" zeigt eine neutrale Nummer — der Dateiname waere dort
    // genau die Information, die die Nummer ersetzen soll.
    expect(shouldExposeFilename("index")).toBe(false);
  });

  it("fails closed on unknown, null or undefined values", () => {
    // Bei einem kaputten Enum-Wert (Migration halb durch, Handeingriff
    // in der DB, spaeter neuer Modus) ist Zurueckhalten die harmlosere
    // Richtung — lieber eine fehlende Bezeichnung als ein geleakter
    // Dateiname.
    expect(shouldExposeFilename("Filename")).toBe(false);
    expect(shouldExposeFilename("")).toBe(false);
    expect(shouldExposeFilename("something_new")).toBe(false);
    expect(shouldExposeFilename(null)).toBe(false);
    expect(shouldExposeFilename(undefined)).toBe(false);
  });
});

describe("hasVisibleLabel", () => {
  it("is true for both modes that show something", () => {
    expect(hasVisibleLabel("filename")).toBe(true);
    expect(hasVisibleLabel("index")).toBe(true);
  });

  it("is false for hidden and for junk values", () => {
    expect(hasVisibleLabel("hidden")).toBe(false);
    expect(hasVisibleLabel(null)).toBe(false);
    expect(hasVisibleLabel(undefined)).toBe(false);
    expect(hasVisibleLabel("nope")).toBe(false);
  });

  it("never promises a visible label where the filename is withheld and no index applies", () => {
    // Invariante zwischen den beiden Funktionen: wenn ein Dateiname
    // ausgeliefert wird, muss auch eine Bezeichnung sichtbar sein.
    // Andernfalls senden wir Daten, die niemand anzeigt.
    for (const mode of ["hidden", "filename", "index", "junk", null]) {
      if (shouldExposeFilename(mode)) {
        expect(hasVisibleLabel(mode)).toBe(true);
      }
    }
  });
});
