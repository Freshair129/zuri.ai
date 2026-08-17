# UI/UX & Design Standards (Glassmorphism)

GoVibe follows a high-fidelity **Glassmorphism / Cyberpunk** aesthetic.

## 🎨 Color Palette & Tokens

| Token | Variable | Value (Dark) |
|-------|----------|--------------|
| Body Background | `--bg-body` | `#0f1115` |
| Glass Background | `--glass-bg` | `rgba(30, 30, 35, 0.65)` |
| Neon Green | `--neon-green` | `#00ff88` |
| Neon Blue | `--neon-blue` | `#00e1ff` |
| Neon Purple | `--neon-purple` | `#b700ff` |
| Glass Border | `--glass-border` | `rgba(255, 255, 255, 0.08)` |

## 📐 Layout Principles

- **Grid System**: Use 24px/8px increments for spacing.
- **Glass Effects**:
  - `backdrop-filter: blur(20px)`
  - `border: 1px solid var(--glass-border)`
  - `box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15)`
- **Typography**:
  - **Sans**: `Prompt` (Thai support)
  - **Mono**: `JetBrains Mono`
  - **Title Accent**: `Orbitron` (for codenames and headers)

## ✨ Interactions

- **3D Tilt**: Interactive cards should have a subtle 3D perspective tilt on mouse move.
- **Shimmer**: Use animated gradients for titles and high-importance badges.
- **Transitions**: Use `cubic-bezier(0.25, 0.8, 0.25, 1)` for sidebar and panel animations.

## 🏷️ Badges & Status

- **Genesis DB Badge**: Red border/text with a pulsing dot.
- **Stable Run**: Green pulse icon for active telemetry.
