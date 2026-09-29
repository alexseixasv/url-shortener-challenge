# UI — URL Shortener

Design system actually used in `apps/web`.

## Purpose

Single-page app to:

- create short links;
- list the 50 most recent links;
- view statistics;
- disable links.

Priority: functionality → clarity → accessibility → responsiveness → visual consistency.

## Logo

- Local file: `apps/web/public/logo.svg`
- No external hotlink at runtime
- Header: logo on the left (`alt="URL Shortener"`)

## Colors

| Token | Value | Use |
| --- | --- | --- |
| `--color-background` | `#ffffff` | canvas, cards |
| `--color-text` | `#242b33` | headings, body, labels |
| `--color-text-muted` | `rgba(36, 43, 51, 0.65)` | captions, metadata |
| `--color-primary` | `#5a52e8` | CTA, focus, stats bars, action links |
| `--color-primary-pressed` | `#4a43c9` | pressed primary |
| `--color-on-primary` | `#ffffff` | text on the CTA |
| `--color-surface-soft` | `#efeefd` | success, stats, empty, badges |
| `--color-border` | `rgba(36, 43, 51, 0.12)` | hairlines |

Single action color: `#5a52e8`. Status does not use green/red/yellow.

## Typography

Stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`  
(No Inter via CDN or dependency.)

- Intro: `clamp(2rem, 4vw, 2.75rem)`, weight 600
- Section titles: ~1.125rem / 600
- Body: 1rem / 400
- Small: 0.875rem
- Metric (`totalClicks`): `clamp(2rem, 3vw, 2.5rem)` / 600

## Spacing

4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48. Section gaps ~48px.

## Radius

- Input: `12px`
- Card: `24px`
- Pill (buttons/badges): `999px`

## Buttons

- Primary: primary background, on-primary text, height ≥44px, pill
- Secondary: surface-soft (Copy)
- Ghost: hairline border (Disable, Close)
- Text: primary text (View stats / Hide stats)

## Inputs

Height 48px, radius 12px, `--color-border`, primary focus ring.  
Discrete helper on the custom slug: “Letters and numbers only”.

## Cards / surfaces

White cards with a hairline **or** `card--soft` (`#efeefd`) for the create result, stats, and empty states.

## Badges

Pill on surface-soft plus the status label (`Active` / `Inactive` / `Expired` / `Maxed`). Differentiation by label plus opacity/border — not by a rainbow of colors.

## List rows

Semantic list; short URL + clicks + badge; destination with `overflow-wrap: anywhere`; actions View stats / Hide stats / Disable.

## Stats

Soft panel: totalClicks metric; CSS bars (primary fill, white track); width uses `max = Math.max(...clicks, 1)` in the bar calculation; recent accesses fall back to **Direct / No referrer** and **Unknown**.

## Responsive

- `<640px`: form in one column, full-width CTA, stacked rows
- `≥640px`: optional fields in 3 columns
- Container `max-width: 1180px`

## Accessibility

Semantic HTML; labels; real buttons; visible focus; `aria-live` for create success / loading; errors with `role="alert"`; touch targets ≥44px.

## Non-goals

No Tailwind/MUI/Chakra/shadcn/Bootstrap; no chart/toast/icon libraries; no Redux/Zustand/React Query/Axios; no router; no dark mode; no auth/search/pagination/edit/re-enable.
