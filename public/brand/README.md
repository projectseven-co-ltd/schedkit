# SchedKit Brand Assets

All assets live in `/public/brand/`. SVG format — scale to any size.

Colors align with the **SignalForge** projectseven palette (amber phosphor on CRT black). Shared tactical display modes: see `signalforge.org/DISPLAY-MODES.md`.

---

## Logo Files

| File | Use |
|------|-----|
| `logo-icon.svg` | Square icon (512×512) — app icons, avatars, social profiles |
| `logo-horizontal-dark.svg` | Horizontal lockup on dark backgrounds (800×200) |
| `logo-horizontal-light.svg` | Horizontal lockup on light backgrounds (800×200) |
| `logo-mark-accent.svg` | Bare mark, transparent bg, amber bars — overlay on dark |
| `logo-mark-white.svg` | Bare mark, transparent bg, white bars — overlay on photos |
| `favicon.svg` | 32×32 favicon |

---

## Colors

Canonical tokens live in [`/public/theme.css`](../theme.css).

| Token | Hex | Use |
|-------|-----|-----|
| `--accent` | `#ffc700` | Primary accent, logo bars (SignalForge amber) |
| `--bg` | `#0a0a0a` | Page background |
| `--surface` | `#111111` | Card / elevated surfaces |
| `--border` | `#1f1f1f` | Borders, dividers |
| `--text` | `#c9c9c9` | Primary text |
| `--muted` | `#555555` | Secondary text, "kit" wordmark |

Light mode: `--accent` → `#997700`, `--bg` → `#f5f4ef`, `--text` → `#141410`

---

## Typography

- **Primary:** Space Grotesk (Google Fonts) — headings, UI, wordmark "sched"
- **Monospace:** Fira Code (Google Fonts) — wordmark "kit", code, labels

---

## Logo Rules

- Accent bars use `#ffc700` on dark backgrounds (or `#ffffff` on photo/accent fields)
- Don't stretch or distort the icon — it's always square
- Minimum size: 16px / favicon use
- Clear space: at least half the icon width on all sides

---

## Social / OG Image

Recommended OG image: 1200×630, dark background (`#0a0a0a`), centered horizontal lockup + tagline below.
