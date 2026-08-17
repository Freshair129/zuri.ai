# Coding Standards

Guidelines for maintaining a clean, performant, and platform-agnostic codebase.

## ⚛️ Frontend (React & TypeScript)

- **Functional Components**: Use functional components with hooks.
- **Strict Typing**: No `any`. Use interfaces/types for props and state.
- **Platform-Agnostic Core**: Logic that can exist without the DOM should live in `src/core/`.
- **Hooks**: Prefer custom hooks (`src/hooks/`) for complex state or side effects.
- **Styling**:
  - Use **Tailwind CSS** for utility-first styling.
  - Follow **Glassmorphism** patterns (see `UI-UX-Design-Standards.md`).
  - Avoid inline styles unless dynamic (e.g., CSS Variables for animations).

## 🦀 Backend (Rust & Tauri)

- **IPC Commands**: Keep Rust commands focused. Logic should be modularized in crates or modules.
- **Error Handling**: Use `Result` and custom error enums. Avoid `unwrap()` or `expect()`.
- **Clippy**: Code must pass `cargo clippy` without warnings.
- **Formatting**: Code must follow `cargo fmt`.

## 🌐 State Management

- **Local State**: Use `useState` for UI-only state.
- **Global State**: Use **Zustand** for shared state across domains.
- **Persistence**: Persist essential state (e.g., roadmap, config) to `localStorage` or via GenesisBlockDB.

## 🧪 Testing

- **Unit Tests**: Mandatory for `src/core/` logic.
- **Component Tests**: Required for complex UI components.
- **End-to-End**: Required for critical paths (e.g., Symbol Linking).
