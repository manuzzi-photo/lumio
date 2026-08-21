**English** · [Deutsch](CONTRIBUTING.de.md) · [Italiano](CONTRIBUTING.it.md)

# Contributing to Lumio

Thanks for wanting to contribute!

## Quick start

1. Read an issue or open a new one before working on larger changes.
2. Fork the repo, new branch (`feat/your-feature` or `fix/your-fix`).
3. `cp .env.example .env`, `docker compose up -d` — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
4. Write code, add tests where it makes sense.
5. Pull request with a clear description.

## What we like to see

- **Bug fixes** with a reproducible test case
- **Performance improvements** with before/after measurements
- **Translations** — see [Adding a translation](#adding-a-translation)
- **Documentation** — even small typo fixes
- **RAW format tests** — if you have an unusual camera, sample files are worth gold

## Code conventions

- **TypeScript**: strict mode, no `any` without justification
- **Python**: PEP 8, type hints, ruff for linting
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **PR titles**: same convention as commits

## License note

Lumio is under the **Functional Source License 1.1 (FSL-1.1-ALv2)** — a *source-available* license (not OSI open source). By contributing, you agree that your code is published under this license.

If a commercial dual license for proprietary forks is to be offered, we reserve the right to a DCO or CLA for significant contributions — to be discussed once it becomes practically relevant.

## Language policy

**English is the project's primary language. German is a translation.**

This applies to:

- **Frontend UI** — `en.ts` is the reference dictionary. New keys are added to
  `en.ts` first, then to `de.ts` and any other locale. English is the default
  locale and the fallback for missing keys.
- **Code comments and identifiers** — new comments in English. Existing German
  comments are rewritten opportunistically when a file is touched anyway; no
  separate mass-rename commits.
- **Commit messages and PR descriptions** — English.
- **Documentation** — English is the canonical `.md`, German lives in `*.de.md`.
- **Locale-sensitive formatting** — dates, numbers, currencies and sorting
  follow the *active* interface locale. Never hardcode a locale identifier
  such as `"de-DE"` in `Intl.*`, `toLocaleDateString`, `toLocaleString` or
  `localeCompare`.

### Deliberate exceptions

These stay German-first, on purpose:

- **Transactional emails sent by the API.** Recipients are the *end customers*
  of a studio, not the studio operator, so their language follows the studio
  rather than our default. That is now implemented: `mail-i18n.ts` resolves
  `Tenant.locale` for customer mail and `User.locale` for team mail, and every
  template carries a `de`/`en`/`it` set. What stays deliberate is that
  `DEFAULT_MAIL_LOCALE` defaults to `de`, so an instance that sets nothing
  keeps writing German.

  Adding a locale to mail is all-or-nothing by design: `Phrase` is
  `Record<MailLocale, string>`, so the compiler rejects the new locale until
  every template is translated. A half-translated mail is worse than one that
  honestly arrives in the default language.
- **The data processing agreement** (`apps/api/src/services/dpa.ts`). It is a
  contract under Art. 28 GDPR between two German legal entities; the German
  version is the legally binding one. An English version can be *added* later,
  but it would be a non-binding translation and needs a data protection
  officer's review.
- **The German marketing sites** (`lumio-app.de`, `lumio-cloud.de`). They
  address the German market and are separate repositories. Only
  `lumio-cloud.com` is English-first.
- **`CHANGELOG.md`** entries are bilingual, German text first, then an
  `**🇬🇧 English**` divider. This is a release-tooling constraint, not a
  statement about language priority.

## Adding a translation

The frontend UI strings live as TypeScript dictionaries in
`apps/frontend/src/lib/i18n/` — no external localization service, just plain files.

To add a new language (example: Czech, `cs`):

1. **Copy `en.ts` to `cs.ts`** in `apps/frontend/src/lib/i18n/` and translate the
   values. Keep every key and the nesting structure exactly as in `en.ts` —
   the `Dict` type only allows string values, and missing keys fall back to English.
2. **Register the locale in `dict.ts`**: add the import, extend the
   `Locale` type (`"en" | "de" | "cs"`) and add the entry to `dictionaries`.
3. **Add the locale to `SUPPORTED`** in `apps/frontend/src/lib/i18n.tsx` so
   cookie/`navigator.language` detection picks it up.
4. **Update the language pickers.** A few components carry the locale union
   and human-readable labels directly. Find them with:
   ```bash
   grep -rn '"en" | "de"' apps/frontend/src
   ```
   (currently `components/gallery/GalleryShell.tsx` and
   `app/studio/settings/page.tsx`) and add your language there.
5. **Verify**: `npx tsc --noEmit` in `apps/frontend` must pass. Locale files
   are typed as `LocaleDict`, derived from `en.ts`, so the compiler names any
   missing or misspelled key. Also run `npm run check:i18n`, which additionally
   checks `t()` calls with no key behind them, hardcoded locale identifiers,
   and catalogue text the API supplies.

A partial translation therefore does not type-check, which is deliberate: a
locale file that silently covers half the interface is hard to spot from the
outside. If you want to contribute a language in stages, say so in the issue
and we will find a way that does not leave a half-filled file in the tree.

The docs (`docs/*.md`) follow a separate convention: English is the canonical
`.md`, German lives in `*.de.md`. Additional doc languages are welcome but
please open an issue first so we can agree on the naming scheme.

## Code of conduct

Be kind. Be specific. Be patient. We're building this in our spare time or on the side — mutual respect makes it much more pleasant.

Personal attacks, discrimination or spam lead to exclusion.

## Questions?

Open an issue or post under Discussions on the GitHub repo.

### Changelog and release notes

**Both are English only.** The changelog used to be German with an English
half per entry, which does not scale: with three supported interface
languages it would need three, with four it would need four, and half of them
would drift out of date. English is the project language (see above), so the
changelog follows it.

History is left as written. 93 older sections are bilingual and 30 (v0.43.2
to v0.55.1) are German only. They describe releases nobody installs any more;
translating them now would be work without a reader, and machine translation
would be worse than leaving them.

`node scripts/release-notes.mjs <version>` extracts the English half of a
changelog section. It refuses rather than falling back to German if the
English part is missing.

For an English-only section the script passes it through unchanged. For the
older bilingual sections it extracts the English half; where those put one
combined English block under several German sections, it drops the headings
rather than guess — labelling a security fix as "Fixed" would be worse than
labelling it not at all. A German-only section makes it exit non-zero.
