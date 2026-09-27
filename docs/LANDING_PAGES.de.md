[English](LANDING_PAGES.md) · **Deutsch** · [Italiano](LANDING_PAGES.it.md)

# Landing Pages

Eine **Seite** ist eine kuratierte, geordnete Liste von Galerien unter einem eigenen Link. Nutze sie für ein öffentliches Portfolio oder für einen einzelnen Kunden, der alle seine Galerien an einem Ort finden soll. Eine Galerie kann auf beliebig vielen Seiten stehen.

Seiten verwaltest du unter **Seiten** in der Studio-Navigation. Nur Owner und Admins.

## Kurz gesagt

- **Du** bestimmst, welche Galerien auf einer Seite stehen und in welcher Reihenfolge. Nichts landet von selbst auf einer Seite: nicht per Tag, nicht per Filter.
- Eine Seite **listet** Galerien auf, sie öffnet sie nicht. Eine Karte führt zur Galerie, und die Galerie wendet ihre eigenen Regeln an (Passwort, Ablauf, Freigabe-Links). Wer eine Passwort-Seite entsperrt, hat damit keine der Galerien darauf entsperrt.
- Eine neue Seite ist **nur mit Link** erreichbar. Öffentlich wird sie erst, wenn du sie öffentlich machst.
- Eine öffentliche Seite kann die **Startseite** deines Studios sein: Sie wird unter `/` gezeigt statt der Weiterleitung zur Anmeldung.

## Eine Seite anlegen

1. **Seiten → Neue Seite**, Titel eingeben. Die Seite ist nur über ihren Link erreichbar, und Suchmaschinen wird gesagt, sie nicht zu indexieren.
2. Mit **Galerie hinzufügen** legst du Galerien darauf ab. Zum Sortieren den Griff ziehen (oder per Tastatur bedienen). Neue Galerien kommen ans Ende.
3. Unter **Wer diese Seite öffnen darf** wählst du den Zugang (unten) und machst sie auf Wunsch zu deiner Startseite.
4. Den Link unter **Seiten-URL** kopieren und verschicken.

Aus einer Galerie heraus geht dasselbe in einem Schritt: **Teilen → Seiten → Zu Seite hinzufügen**. *Neue Seite* legt dort eine Seite nur mit Link an und legt die Galerie sofort darauf.

## Wer eine Seite öffnen darf

| Zugang | Wer sie öffnen kann | Suchmaschinen | Kann Startseite sein |
|---|---|---|---|
| **Öffentlich** | Jeder | Dürfen indexieren | Ja |
| **Nur mit Link** (Standard) | Wer den Link hat | Sollen nicht (`noindex`) | Nein |
| **Passwort** | Wer den Link und das Passwort hat | Sollen nicht (`noindex`) | Nein |

Eine Passwort-Seite zeigt bis zum Entsperren nur ihren Titel; Einleitung und Galerien werden nicht an den Browser geschickt. Das Passwort ist unabhängig von den Passwörtern der Galerien darauf.

## Was Besucher sehen

Eine Karte zeigt das Cover (in Originalproportionen, in einem Justified-Raster), den Titel, das Erstellungsdatum, die Anzahl der Dateien, die Beschreibung und bei einer Galerie mit Passwort ein Schloss.

**Welche Galerien gelistet werden.** Eine Galerie erscheint auf einer Seite nur, solange sie **aktiv** und **nicht abgelaufen** ist und **ohne Freigabe-Link geöffnet** werden kann (öffentlicher Zugang an). Sonst wird sie übersprungen, und im Editor steht der Grund dabei („Nicht sichtbar: Entwurf / archiviert / abgelaufen / braucht Freigabe-Link“). Ihr Platz auf der Seite bleibt erhalten, sie kommt also an dieselbe Stelle zurück.

**Galerien mit Passwort** werden gelistet, mit Schloss. Standardmäßig zeigen sie nur **Titel und Datum**: kein Cover, keine Beschreibung, keine Foto-Anzahl. Mit **Vorschau öffentlich zeigen** schaltest du diese drei für die jeweilige Galerie auf der Seite frei. Galerien **ohne** Passwort zeigen immer Cover, Beschreibung und Foto-Anzahl, weil ihr Inhalt ohnehin offen ist.

Das wird beim Laden der Seite entschieden, nicht beim Hinzufügen: Bekommt eine Galerie später ein Passwort, verliert sie ihr Cover auf der Seite von selbst.

> **Vor dem Veröffentlichen:** Die Beschreibung einer Galerie wird auf einer Seite öffentlich. Wenn du dort interne Notizen führst, lass sie leer oder nutze *Titel auf dieser Seite* für den Namen.

### Covers bleiben im Speicher privat

Cover-Bilder sind nicht direkt auf den Speicher verlinkt. Sie laden über `/api/v1/p/<Seite>/covers/<Galerie>`, das die obigen Regeln bei jeder Anfrage prüft und dann auf einen Link weiterleitet, der fünf Minuten gilt. Schaltest du eine Vorschau ab, wirkt das deshalb binnen Minuten, und der Speicher-Bucket bleibt privat, wie in [STORAGE.de.md](STORAGE.de.md) beschrieben. Das erste Cover dient auch als Vorschaubild, wenn der Seiten-Link geteilt wird.

## Die Startseite (`/`)

Mache eine **öffentliche** Seite zu deiner Startseite (*Wer diese Seite öffnen darf → Als meine Startseite verwenden*), und sie wird unter der Hauptadresse deines Studios gezeigt statt der Weiterleitung zur Anmeldung.

- Deine Anmeldung bleibt unter **`/login`**, und die Startseite hat im Footer einen kleinen Link *Studio-Login*. Lesezeichen auf `/login` funktionieren weiter.
- Die eigene `/p/<slug>`-Adresse der Startseite leitet auf `/` weiter.
- Ein Studio hat höchstens eine Startseite. Machst du eine andere zur Startseite, ersetzt sie die bisherige.
- Löschst du die Startseite, machst sie nicht mehr öffentlich oder gibst das Flag auf, leitet `/` wieder zur Anmeldung weiter. Ebenso bei einem Studio, das nie eine gesetzt hat: Es ändert sich nichts, bis du es tust. Ist die API nicht erreichbar, fällt `/` ebenfalls auf die Anmeldung zurück.
- Studios, die sich eine Installation teilen, haben jeweils ihre eigene: Die Wurzel von `studio-a.example.com` zeigt die Startseite von Studio A und nichts von Studio B. Auf der Apex-Domain einer Multi-Tenant-Installation bleibt `/` die Studio-Auswahl. Siehe [MULTI_TENANT.de.md](MULTI_TENANT.de.md).

## Seiten-URL

Der Slug einer Seite ist standardmäßig zufällig (`/p/k3m9x4tqzr7a`) und unter **Seiten-URL** änderbar. Es gelten die Regeln der Galerie-Slugs: 3 bis 60 Zeichen, Kleinbuchstaben, Ziffern und Bindestriche, keine reservierten Wörter. Er ist pro Studio eindeutig (bei einer Ein-Studio-Installation über die ganze Installation). Nach einer Änderung funktioniert der bisherige Link nicht mehr, auch nicht in bereits verschickten Links.

## Gestaltung

Standardmäßig nutzt eine Seite die Standard-Gestaltung deines Studios (Logo, Farben, Schrift). Wähle unter **Details → Gestaltung** ein anderes Profil, wenn eine Seite anders aussehen soll. Die Einleitung unterstützt Markdown.

## Galerien archivieren und löschen

- Beim **Archivieren** einer Galerie, die auf Seiten steht, wird zuerst gefragt und die Seiten werden genannt. Sie wird dort ausgeblendet und kommt beim Reaktivieren an ihren Platz zurück. Eine Galerie auf keiner Seite wird wie bisher sofort archiviert.
- Beim **Löschen** einer Galerie werden die Seiten genannt, von denen sie verschwindet.
- Das **Löschen einer Seite** lässt ihre Galerien unberührt.

## Grenzen und was es nicht gibt

- Höchstens **200 Galerien pro Seite**, keine Seitenumbrüche.
- Kein Ablaufdatum und keine Zeitplanung für Seiten, keine Sitemap.
- Seiten sind für Owner und Admins; ein Member sieht sie nicht, und ein Admin kann nur Galerien hinzufügen, auf die er selbst Zugriff hat.

## Für Betreiber

Das Feature liegt hinter dem Flag `landing_pages`, **standardmäßig an**. Auf einer Multi-Tenant-Instanz kann der Betreiber es pro Studio in der Super-Admin-Oberfläche abschalten, wie die anderen Feature-Flags (siehe [SELFHOSTING.de.md](SELFHOSTING.de.md)); ein Studio mit ausgeschaltetem Flag hat keinen Eintrag *Seiten*, und sein `/` und `/p/*` verhalten sich, als gäbe es keine Seiten. Auf einer selbst gehosteten Ein-Studio-Instanz passiert nichts, bis eine Seite angelegt wird.

Jede Änderung steht im Audit-Log: `page.create`, `page.update` (welche Felder und der Zugang; nie ein Passwort), `page.delete`, `page.set_default`, `page.unset_default`, `page.gallery_add`, `page.gallery_remove`, `page.gallery_update` (die Vorschau-Freigabe), `page.unlock` und `page.unlock.failed`. Das Entsperren mit Passwort ist wie bei einer Galerie ratenbegrenzt.

### API

Studio (angemeldet als Owner oder Admin):

| | |
|---|---|
| `GET/POST /pages` | auflisten, anlegen (`{title, galleryId?}`) |
| `GET/PATCH/DELETE /pages/:id` | Seite und ihre Galerien; Titel, Einleitung, Slug, Zugang, Passwort, Branding, Startseite |
| `POST /pages/:id/galleries` | Galerie auf eine Seite legen (`{galleryId}`) |
| `PATCH/DELETE /pages/:id/galleries/:galleryId` | Titel auf dieser Seite, Vorschau-Freigabe; entfernen |
| `POST /pages/:id/galleries/reorder` | `{order: [galleryId, …]}` |
| `GET /galleries/:id/pages` | alle Seiten und ob sie diese Galerie enthalten |

Öffentlich (ohne Anmeldung; das Studio kommt aus dem Host der Anfrage, wie bei `/g/:slug`): `GET /p` (Startseite), `GET /p/:slug`, `POST /p/:slug/unlock`, `GET /p/:slug/covers/:gallerySlug`.
