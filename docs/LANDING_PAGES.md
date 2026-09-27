**English** · [Deutsch](LANDING_PAGES.de.md) · [Italiano](LANDING_PAGES.it.md)

# Landing pages

A **page** is a curated, ordered list of galleries under a link of its own. Use one for a public portfolio, or for a single client who should find all of their galleries in one place. A gallery can be on any number of pages.

Pages are managed under **Pages** in the studio navigation. Owners and admins only.

## In short

- **You** choose which galleries are on a page and in which order. Nothing gets on a page by itself: not by tag, not by filter.
- A page **lists** galleries, it does not open them. A card leads to the gallery, and the gallery applies its own rules (password, expiry, share links). Unlocking a password page does not unlock the galleries on it.
- A new page is **link only**. It becomes public only when you make it public.
- One public page can be your studio's **start page**: it is shown on `/` instead of the redirect to the login.

## Creating a page

1. **Pages → New page**, enter a title. The page is reachable only through its link, and search engines are told not to index it.
2. **Add gallery** puts galleries on it. Drag the handle (or use the keyboard on it) to change the order. New galleries are added at the end.
3. Under **Who can open this page**, choose the access mode (below) and, if you like, make it your start page.
4. Copy the link under **Page URL** and send it.

From a gallery, **Share → Pages → Add to page** does the same in one step, and *New page* there creates a link-only page and puts the gallery on it straight away.

## Who can open a page

| Access | Who can open it | Search engines | Can be the start page |
|---|---|---|---|
| **Public** | Anyone | May index it | Yes |
| **Link only** (default) | Anyone who has the link | Told not to (`noindex`) | No |
| **Password** | Anyone who has the link and the password | Told not to (`noindex`) | No |

A password page shows only its title until it is unlocked; its introduction and galleries are not sent to the browser. The password is separate from the passwords of the galleries on it.

## What visitors see

A card shows the cover (in its original proportions, in a justified grid), the title, the creation date, the number of files, the description and, for a password gallery, a lock.

**Which galleries are listed.** A gallery appears on a page only while it is **active**, **not expired** and can be **opened without a share link** (public access on). Otherwise it is skipped, and in the editor it is marked with the reason ("Not shown: draft / archived / expired / needs a share link"). Its place on the page is kept, so it comes back where it was.

**Password galleries** are listed, with a lock. By default they show only their **title and date**: no cover, no description, no photo count. Switch on **Show preview publicly** for a gallery on a page to reveal those three for it. Galleries **without** a password always show cover, description and photo count, because their content is open anyway.

This is decided when the page is loaded, not when you add the gallery: a gallery that gets a password later loses its cover on the page by itself.

> **Before you publish:** the description of a gallery becomes public on a page. If you keep internal notes there, leave it empty or use *Title on this page* for the name.

### Covers stay private in storage

Cover images are not linked to storage directly. They load through `/api/v1/p/<page>/covers/<gallery>`, which checks the rules above on every request and then redirects to a link that works for five minutes. Switching a preview off therefore takes effect within minutes, and the storage bucket stays private as described in [STORAGE.md](STORAGE.md). The first cover also serves as the preview image when the page link is shared.

## The start page (`/`)

Make a **public** page your start page (*Who can open this page → Use as my start page*) and it is shown on your studio's root address instead of redirecting to the login.

- Your login stays at **`/login`**, and the start page's footer has a small *Studio login* link. Bookmarks to `/login` keep working.
- The start page's own `/p/<slug>` address redirects to `/`.
- A studio has at most one start page. Making another page the start page replaces it.
- If you delete the start page, make it non-public, or give the flag up, `/` goes back to redirecting to the login. So does a studio that never set one: nothing changes until you do. If the API cannot be reached, `/` also falls back to the login.
- Studios that share one installation each get their own: the root of `studio-a.example.com` shows studio A's start page and nothing of studio B's. On the apex domain of a multi-tenant installation `/` stays the studio picker. See [MULTI_TENANT.md](MULTI_TENANT.md).

## Page URL

A page's slug is random by default (`/p/k3m9x4tqzr7a`) and can be changed under **Page URL**. The rules are those of gallery slugs: 3 to 60 characters, lowercase letters, digits and hyphens, no reserved words. It is unique per studio (across the whole installation on a single-studio one). After a change the previous link stops working, including links you already sent.

## Design

By default a page uses your studio's default design (logo, colours, font). Pick another profile under **Details → Design** if a page should look different. The introduction supports Markdown.

## Archiving and deleting galleries

- **Archiving** a gallery that is on pages asks first and names them. It is hidden there and returns to its place when you reactivate it. A gallery on no page is archived at once, as before.
- **Deleting** a gallery names the pages it will disappear from.
- **Deleting a page** leaves its galleries untouched.

## Limits and what is not there

- At most **200 galleries per page**, no pagination.
- No expiry date or schedule for a page, and no sitemap.
- Pages are for owners and admins; a member does not see them, and an admin can only add galleries they can access themselves.

## For operators

The feature sits behind the flag `landing_pages`, **on by default**. On a multi-tenant instance the operator can switch it off per studio in the super admin UI, as for the other feature flags (see [SELFHOSTING.md](SELFHOSTING.md)); a studio with the flag off has no *Pages* entry, and its `/` and `/p/*` behave as if pages did not exist. On a self-hosted single-studio instance nothing happens until a page is created.

Every change is recorded in the audit log: `page.create`, `page.update` (which fields, and the access mode; never a password), `page.delete`, `page.set_default`, `page.unset_default`, `page.gallery_add`, `page.gallery_remove`, `page.gallery_update` (the preview opt-in), `page.unlock` and `page.unlock.failed`. The password unlock is rate limited like a gallery's.

### API

Studio (logged in as owner or admin):

| | |
|---|---|
| `GET/POST /pages` | list, create (`{title, galleryId?}`) |
| `GET/PATCH/DELETE /pages/:id` | page and its galleries; title, intro, slug, access, password, branding, start page |
| `POST /pages/:id/galleries` | put a gallery on a page (`{galleryId}`) |
| `PATCH/DELETE /pages/:id/galleries/:galleryId` | title on this page, preview opt-in; remove |
| `POST /pages/:id/galleries/reorder` | `{order: [galleryId, …]}` |
| `GET /galleries/:id/pages` | every page and whether it holds this gallery |

Public (no login; the studio comes from the request host, as for `/g/:slug`): `GET /p` (start page), `GET /p/:slug`, `POST /p/:slug/unlock`, `GET /p/:slug/covers/:gallerySlug`.
