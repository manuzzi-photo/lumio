**English** · [Deutsch](BRAND.de.md)

# Lumio — Brand

## The symbol

Four equally sized tiles on a strict 2×2 grid, cut across by a single
straight line at 45°. A contact sheet with a selection stroke: the orange
tile sits free, two are clipped, one is untouched.

A straight line can clip at most two tiles in this grid — so the split
isn't arbitrary, it's the only arrangement in which the orange tile stays
whole.

## Colours

| Role   | Hex       | Use                                            |
|--------|-----------|------------------------------------------------|
| Ink    | `#12121A` | tiles, wordmark, dark surfaces                 |
| Accent | `#FF4D2E` | exactly one tile, the i-tittle, the descriptor |
| Paper  | `#FAF8F5` | light background, tiles on dark surfaces       |

No blue, no violet, no blue-to-purple gradient — that is the uniform of
the other self-hosted photo apps, and the reason the first draft was
thrown out.

## Type

- **Wordmark: Quicksand SemiBold**, converted to outlines. The logo files
  therefore load no webfont. Quicksand is used *only* for the wordmark,
  never for body copy.
- **UI and text: Inter.** Unchanged, already in use across all repos.

## Files

`apps/frontend/public/`

| File                   | Purpose                                          |
|------------------------|--------------------------------------------------|
| `favicon.svg`          | symbol, fixed colours                            |
| `favicon-16/32.png`    | fallback for older browsers                      |
| `apple-touch-icon.png` | 180×180, opaque background (iOS dislikes alpha)  |
| `icon-512.png`         | web manifest, PWA                                |
| `mark.svg`             | symbol alone                                     |
| `logo.svg`             | symbol + wordmark, horizontal                    |
| `logo-inverse.svg`     | the same for dark surfaces                       |
| `wordmark.svg`         | wordmark alone                                   |

`brand/` — sources, not served

| File                   | Purpose                                     |
|------------------------|---------------------------------------------|
| `logo-cloud.svg`       | stacked lockup with `CLOUD`                 |
| `logo-selfhosted.svg`  | stacked lockup with `SELF-HOSTED`           |
| `mark-mono.svg`        | single colour, for stamps and fax-grade use |
| `mark-inverse.svg`     | light tiles                                 |

## In code

`Logo` from `@/components/ui`, variants `mark` and `full`:

```tsx
<Logo variant="full" className="h-6 w-auto" />
```

The ink follows `currentColor` while the accent stays fixed. On a dark
surface, just set a light text colour — no second file needed.

## Rules

- Exactly **one** tile carries the accent. Never two, never all four.
- The cut stays one continuous straight line. Don't bend it, don't mirror
  it, don't centre it.
- The inside of the tiles stays empty. No symbol, no letter in there.
- Minimum size 16 px. Don't use it below that.
- Leave at least one tile's width of clear space around the logo.
- On a busy background (a photo), place the symbol on an opaque chip,
  otherwise the cut fills up with imagery.
