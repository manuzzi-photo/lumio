import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * docker-compose schreibt `VAR=${VAR:-}` in die Umgebung. Eine nicht
 * gesetzte Variable kommt dort als LEERER STRING an, nicht als undefined.
 *
 * Ohne Behandlung dieses Falls scheiterte z.string().url() am "" und die
 * API startete gar nicht — auf jeder Instanz, die den Wert nicht setzt,
 * also praktisch allen. Der Smoke-Test hat es gefangen; dieser Test haelt
 * es fest, damit die naechste optionale URL nicht dieselbe Falle stellt.
 */
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional()
);

describe("optional env vars from docker-compose", () => {
  it("accepts an empty string as unset", () => {
    expect(optionalUrl.parse("")).toBeUndefined();
  });

  it("accepts a real value", () => {
    expect(optionalUrl.parse("https://lumio-cloud.de")).toBe(
      "https://lumio-cloud.de"
    );
  });

  it("still rejects a malformed value", () => {
    expect(() => optionalUrl.parse("not-a-url")).toThrow();
  });

  it("would have failed without the preprocessing", () => {
    // Die alte Form, zum Vergleich — sie ist der Fehler.
    expect(() => z.string().url().optional().parse("")).toThrow();
  });
});
