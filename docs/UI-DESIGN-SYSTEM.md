# UI Design System — Zuri Heritage

## Tokens

```css
:root {
  --brand: #E8820C;
  --brand-hover: #F09420;
  --brand-dark: #B86A08;
  --brand-glow: rgba(232, 130, 12, 0.35);
  --brand-tint: #FDE8D0;
  --brand-surface: #FFF8F0;

  --surface: #F7F8FA;
  --surface-card: #FFFFFF;
  --surface-mid: #EFF1F3;

  --rest-blue: #D6ECFA;
  --rest-blue-text: #3D7A9E;

  --mustard: #C6A052;
  --mustard-tint: #F5ECD7;

  --nav-glass-bg: rgba(31, 41, 55, 0.98);
  --nav-glass-blur: blur(14px);
}
```

Font:
```text
'IBM Plex Sans Thai', 'Manrope', sans-serif
```

## Layout

Desktop:
```text
Topbar
├─ Portfolio selector
├─ Business selector
├─ Workspace selector
├─ Project selector
├─ Command palette
└─ User/local identity

Sidebar
├─ current module
├─ contextual sub-navigation
└─ settings

Main
└─ responsive route content
```

## Interaction

- active navigation uses Amber Citrus
- cards are light and warm, not cyber-dark
- dark glass is reserved for navigation shell
- Rest Blue is secondary informational state
- Mustard is supporting/gate state
- danger and success may use semantic red/green
- avoid unrelated purple/blue branding
