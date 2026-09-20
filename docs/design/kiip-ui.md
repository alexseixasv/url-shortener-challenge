# Kiip UI — URL Shortener Challenge

Documentação do design system **real** usado em `apps/web` (identidade Kiip).

## Purpose

Aplicação funcional single-page para:

- criar links curtos;
- listar os 50 mais recentes;
- ver estatísticas;
- desativar links.

Prioridade: funcionalidade → clareza → acessibilidade → responsividade → consistência visual.

## Logo

- Arquivo local: `apps/web/public/kiip-logo.svg`
- Sem hotlink externo em runtime
- Header: logo à esquerda (`alt="Kiip"`)

## Colors

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-background` | `#ffffff` | canvas, cards |
| `--color-text` | `#242b33` | headings, body, labels |
| `--color-text-muted` | `rgba(36, 43, 51, 0.65)` | captions, metadados |
| `--color-primary` | `#5a52e8` | CTA, focus, barras de stats, links de ação |
| `--color-primary-pressed` | `#4a43c9` | pressed do primary |
| `--color-on-primary` | `#ffffff` | texto no CTA |
| `--color-surface-soft` | `#efeefd` | success, stats, empty, badges |
| `--color-border` | `rgba(36, 43, 51, 0.12)` | hairlines |

Única cor de ação: `#5a52e8`. Status **não** usa verde/vermelho/amarelo.

## Typography

Stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`  
(Sem Inter via CDN/dependência.)

- Intro: `clamp(2rem, 4vw, 2.75rem)`, peso 600
- Títulos de seção: ~1.125rem / 600
- Body: 1rem / 400
- Small: 0.875rem
- Metric (`totalClicks`): `clamp(2rem, 3vw, 2.5rem)` / 600

## Spacing

Base 4px: 4 / 8 / 12 / 16 / 24 / 32 / 48. Gaps de seção ~48px.

## Radius

- Input: `12px`
- Card: `24px`
- Pill (botões/badges): `999px`

## Buttons

- Primary: bg primary, texto on-primary, altura ≥44px, pill
- Secondary: surface-soft (Copy)
- Ghost: borda hairline (Disable, Close)
- Text: primary textual (View stats / Hide stats)

## Inputs

Altura 48px, radius 12px, borda `--color-border`, focus ring primary.  
Helper discreto no custom slug: “Letters and numbers only”.

## Cards / surfaces

Cards brancos com hairline **ou** `card--soft` (`#efeefd`) para resultado de create, stats e empty states.

## Badges

Pill em surface-soft + texto do status (`Active` / `Inactive` / `Expired` / `Maxed`). Diferenciação por rótulo + opacity/borda — não por arco-íris.

## List rows

Lista semântica; short URL + clicks + badge; destination com `overflow-wrap: anywhere`; ações View stats / Hide stats / Disable.

## Stats

Painel soft: metric totalClicks; barras CSS (fill primary, track branca); largura com `max = Math.max(...clicks, 1)` no cálculo da barra; recent accesses com fallbacks **Direct / No referrer** e **Unknown**.

## Responsive

- `<640px`: form 1 coluna, CTA full width, rows empilhados
- `≥640px`: opcionais em 3 colunas
- Container `max-width: 1180px`

## Accessibility

HTML semântico; labels; botões reais; focus visível; `aria-live` para create success / loading; erros com `role="alert"`; touch targets ≥44px.

## Non-goals

Sem Tailwind/MUI/Chakra/shadcn/Bootstrap; sem chart/toast/icon libraries; sem Redux/Zustand/React Query/Axios; sem router; sem dark mode; sem auth/search/pagination/edit/re-enable.
