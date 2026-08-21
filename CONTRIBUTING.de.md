[English](CONTRIBUTING.md) · **Deutsch** · [Italiano](CONTRIBUTING.it.md)

# Contributing to Lumio

Danke, dass du beitragen möchtest!

## Schnellstart

1. Issue lesen oder neues Issue eröffnen, bevor du an größeren Änderungen arbeitest.
2. Fork des Repos, neuer Branch (`feat/dein-feature` oder `fix/dein-fix`).
3. `cp .env.example .env`, `docker compose up -d` — siehe [docs/DEVELOPMENT.md](docs/DEVELOPMENT.de.md).
4. Code schreiben, Tests dazu wenn sinnvoll.
5. Pull Request mit klarer Beschreibung.

## Was wir gerne sehen

- **Bug-Fixes** mit reproduzierbarem Testfall
- **Performance-Verbesserungen** mit Vorher/Nachher-Messung
- **Übersetzungen** — siehe [Eine Übersetzung hinzufügen](#eine-übersetzung-hinzufügen)
- **Dokumentation** — auch kleine Tippfehler-Fixes
- **RAW-Format-Tests** — wenn du eine ungewöhnliche Kamera hast, sind Beispieldateien Gold wert

## Code-Konventionen

- **TypeScript**: strict mode, kein `any` ohne Begründung
- **Python**: PEP 8, type hints, ruff für Linting
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **PR-Titel**: gleiche Konvention wie Commits

## Lizenz-Hinweis

Lumio steht unter der **Functional Source License 1.1 (FSL-1.1-ALv2)** — einer *source-available* Lizenz (nicht OSI-Open-Source). Mit deinem Beitrag stimmst du zu, dass dein Code unter dieser Lizenz veröffentlicht wird.

Falls eine kommerzielle Dual-Lizenz für proprietäre Forks angeboten werden soll, behalten wir uns ein DCO oder CLA für signifikante Beiträge vor — wird diskutiert, sobald das praxisrelevant wird.

## Sprachrichtlinie

**Englisch ist die primäre Projektsprache. Deutsch ist eine Übersetzung.**

Das gilt für:

- **Frontend-UI** — `en.ts` ist das Referenz-Dictionary. Neue Keys kommen zuerst
  nach `en.ts`, dann nach `de.ts` und in weitere Sprachen. Englisch ist das
  Default-Locale und der Fallback für fehlende Keys.
- **Code-Kommentare und Bezeichner** — neue Kommentare auf Englisch. Bestehende
  deutsche Kommentare werden mitgezogen, wenn eine Datei ohnehin angefasst wird;
  keine separaten Massen-Umschreibungs-Commits.
- **Commit-Messages und PR-Beschreibungen** — Englisch.
- **Dokumentation** — Englisch ist die kanonische `.md`, Deutsch liegt in
  `*.de.md`.
- **Locale-abhängige Formatierung** — Datum, Zahlen, Währungen und Sortierung
  folgen dem *aktiven* Interface-Locale. Niemals einen Locale-Identifier wie
  `"de-DE"` in `Intl.*`, `toLocaleDateString`, `toLocaleString` oder
  `localeCompare` hartkodieren.

### Bewusste Ausnahmen

Diese bleiben absichtlich deutsch-first:

- **Transaktions-E-Mails der API.** Empfänger sind die *Endkunden* eines Studios,
  nicht der Studio-Betreiber; deren Sprache folgt daher dem Studio und nicht
  unserem Default. Das ist inzwischen umgesetzt: `mail-i18n.ts` löst
  `Tenant.locale` für Kunden-Mails und `User.locale` für Team-Mails auf, und
  jedes Template hat ein `de`/`en`-Paar. Absicht bleibt, dass
  `DEFAULT_MAIL_LOCALE` auf `de` steht — eine Instanz, die nichts einstellt,
  schreibt weiter deutsch.

  Eine Sprache für die Mails zu ergänzen ist bewusst alles-oder-nichts:
  `Phrase` ist `Record<MailLocale, string>`, der Compiler lehnt die neue
  Sprache also ab, bis jedes Template übersetzt ist. Eine halb übersetzte Mail
  ist schlechter als eine, die ehrlich in der Default-Sprache kommt.
- **Der Auftragsverarbeitungsvertrag** (`apps/api/src/services/dpa.ts`). Er ist
  ein Vertrag nach Art. 28 DSGVO zwischen zwei deutschen Rechtspersonen; die
  deutsche Fassung ist die verbindliche. Eine englische Version kann später
  *ergänzt* werden, wäre dann aber eine unverbindliche Übersetzung und braucht
  eine Prüfung durch den Datenschutzbeauftragten.
- **Die deutschen Marketing-Sites** (`lumio-app.de`, `lumio-cloud.de`). Sie
  adressieren den deutschen Markt und liegen in eigenen Repositories. Nur
  `lumio-cloud.com` ist englisch-first.
- **`CHANGELOG.md`**-Einträge sind zweisprachig, deutscher Text zuerst, dann ein
  `**🇬🇧 English**`-Trenner. Das ist eine Vorgabe des Release-Tooling, keine
  Aussage über Sprachpriorität.

## Eine Übersetzung hinzufügen

Die UI-Texte des Frontends liegen als TypeScript-Dictionaries in
`apps/frontend/src/lib/i18n/` — kein externer Lokalisierungsdienst, nur einfache Dateien.

Neue Sprache hinzufügen (Beispiel: Tschechisch, `cs`):

1. **`en.ts` nach `cs.ts` kopieren** (in `apps/frontend/src/lib/i18n/`) und die
   Werte übersetzen. Alle Keys und die Verschachtelung exakt wie in `en.ts`
   lassen — der `Dict`-Typ erlaubt nur String-Werte, fehlende Keys fallen auf
   Englisch zurück.
2. **Locale in `dict.ts` registrieren**: Import ergänzen, den `Locale`-Typ
   erweitern (`"en" | "de" | "cs"`) und den Eintrag zu `dictionaries` hinzufügen.
3. **Locale in `SUPPORTED` aufnehmen** (in `apps/frontend/src/lib/i18n.tsx`),
   damit Cookie-/`navigator.language`-Erkennung greift.
4. **Sprach-Umschalter aktualisieren.** Einige Komponenten tragen die
   Locale-Union und die Anzeigenamen direkt. Fundstellen:
   ```bash
   grep -rn '"en" | "de"' apps/frontend/src
   ```
   (aktuell `components/gallery/GalleryShell.tsx` und
   `app/studio/settings/page.tsx`) — dort die neue Sprache ergänzen.
5. **Prüfen**: `npx tsc --noEmit` in `apps/frontend` muss durchlaufen. Die
   Sprachdateien sind als `LocaleDict` typisiert, abgeleitet aus `en.ts` — der
   Compiler benennt jeden fehlenden oder falsch geschriebenen Key. Zusätzlich
   `npm run check:i18n` laufen lassen: das prüft außerdem `t()`-Aufrufe ohne
   Key dahinter, hartkodierte Locale-Bezeichner und Katalogtexte aus der API.

Eine Teilübersetzung läuft damit nicht durch die Typprüfung, und das ist
Absicht: eine Sprachdatei, die stillschweigend nur die Hälfte der Oberfläche
abdeckt, ist von außen schwer zu erkennen. Wer eine Sprache in Etappen
beitragen möchte, schreibt das ins Issue — dann finden wir einen Weg, der
keine halb gefüllte Datei im Repo zurücklässt.

Die Doku (`docs/*.md`) folgt einer eigenen Konvention: Englisch ist die
kanonische `.md`, Deutsch liegt in `*.de.md`. Weitere Doku-Sprachen sind
willkommen — bitte vorher ein Issue eröffnen, damit wir das Namensschema abstimmen.

## Code of Conduct

Sei freundlich. Sei konkret. Sei geduldig. Wir bauen das hier in unserer Freizeit oder zwischendurch — gegenseitiger Respekt macht das viel angenehmer.

Persönliche Angriffe, Diskriminierung oder Spam führen zum Ausschluss.

## Fragen?

Issue eröffnen oder im Forgejo-Repo unter Discussions schreiben.

### Changelog und Release-Notes

**Beide sind ausschließlich englisch.** Der Changelog war früher deutsch mit
einer englischen Hälfte je Eintrag. Das skaliert nicht: bei drei
unterstützten Oberflächen-Sprachen bräuchte es drei, bei vier vier — und die
Hälfte davon veraltet. Englisch ist die Projektsprache (siehe oben), der
Changelog folgt ihr.

Die Historie bleibt, wie sie geschrieben wurde. 93 ältere Abschnitte sind
zweisprachig, 30 (v0.43.2 bis v0.55.1) rein deutsch. Sie beschreiben
Versionen, die niemand mehr installiert; sie jetzt zu übersetzen wäre Arbeit
ohne Leser, und maschinell übersetzt wäre schlechter als so.

`node scripts/release-notes.mjs <version>` zieht den englischen Teil eines
Changelog-Abschnitts heraus. Fehlt der englische Teil, bricht der Script ab,
statt auf Deutsch zurückzufallen.

Einen einsprachig englischen Abschnitt reicht der Script unverändert durch.
Bei den älteren zweisprachigen zieht er die englische Hälfte heraus; wo dort
ein gemeinsamer englischer Block unter mehreren deutschen Rubriken steht,
lässt er die Überschriften weg statt zu raten — einen Sicherheitsfix als
„Fixed" zu beschriften wäre schlechter, als ihn gar nicht zu beschriften.
Ein rein deutscher Abschnitt führt zum Abbruch.
