import { describe, it, expect } from "vitest";
import {
  resolveUpdateSource,
  DEFAULT_UPDATE_REPO,
} from "./system-health.js";

describe("resolveUpdateSource", () => {
  it("falls back to the public GitHub mirror", () => {
    // Frueher stand hier das Forgejo-Repo. Das ist die Entwicklungs-
    // quelle, aber privat — bei jeder fremden Instanz kam 404 und der
    // Update-Check stand dauerhaft auf "nicht erreichbar".
    expect(resolveUpdateSource({})).toEqual({
      repoBase: DEFAULT_UPDATE_REPO,
      repoToken: undefined,
    });
    expect(DEFAULT_UPDATE_REPO.startsWith("https://api.github.com/")).toBe(
      true
    );
  });

  it("uses an explicit override", () => {
    expect(
      resolveUpdateSource({
        LUMIO_UPDATE_REPO_URL: "https://git.example.com/api/v1/repos/me/lumio",
      }).repoBase
    ).toBe("https://git.example.com/api/v1/repos/me/lumio");
  });

  it("never sends a token to the default host", () => {
    // Der eigentliche Punkt. Wer einen Token fuer sein privates Repo
    // hinterlegt, die URL aber nicht setzt, wuerde diesen Token sonst
    // an den Default-Host schicken — und der hat sich mit dem Wechsel
    // Forgejo -> GitHub sogar geaendert.
    const r = resolveUpdateSource({ LUMIO_UPDATE_REPO_TOKEN: "secret" });
    expect(r.repoBase).toBe(DEFAULT_UPDATE_REPO);
    expect(r.repoToken).toBeUndefined();
  });

  it("sends the token once the URL is set too", () => {
    expect(
      resolveUpdateSource({
        LUMIO_UPDATE_REPO_URL: "https://git.example.com/api/v1/repos/me/lumio",
        LUMIO_UPDATE_REPO_TOKEN: "secret",
      })
    ).toEqual({
      repoBase: "https://git.example.com/api/v1/repos/me/lumio",
      repoToken: "secret",
    });
  });

  it("treats whitespace-only values as unset", () => {
    // Leere Strings kommen aus docker-compose, wenn die Variable in der
    // .env fehlt (`${LUMIO_UPDATE_REPO_URL:-}`) — die duerfen weder die
    // Default-URL ueberschreiben noch das Token freischalten.
    const r = resolveUpdateSource({
      LUMIO_UPDATE_REPO_URL: "   ",
      LUMIO_UPDATE_REPO_TOKEN: "secret",
    });
    expect(r.repoBase).toBe(DEFAULT_UPDATE_REPO);
    expect(r.repoToken).toBeUndefined();
  });
});
