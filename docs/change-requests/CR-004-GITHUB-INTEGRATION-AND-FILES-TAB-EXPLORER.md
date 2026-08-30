---
doc_type: change-request
id: CR-004
status: proposed
version: "1.0.0"
created_at: "2026-08-30T07:30:00+07:00"
updated_at: "2026-08-30T07:30:00+07:00"
owner: "SmartGift Data Architecture Team"
impacted_domains:
  - integration
  - workspace
  - business
  - ui
  - developer-tools
proposed_domains:
  - git-explorer
---

# CR-004 — GitHub Repository Integration & Interactive "Files" Tab File Tree Explorer

## 1. Change Summary

Provide first-class **GitHub Repository Binding & Interactive File Tree Explorer** inside `zuri-ai` under the **"Files"** tab (`/platform/workspaces/[id]/files` or `/platform/businesses/[id]/files`), allowing users and operators to inspect codebases, markdown documentation, data pipelines, and audit logs with live file previews.

---

## 2. Target Repositories & Action Items

### A. `D:\zuri-ai` (Prisma Model Extension: `prisma/schema.prisma`)
```prisma
model Business {
  // ... existing fields ...
  githubRepoUrl    String?   // e.g. "https://github.com/Freshair129/TN001B01-SmartGift.git"
  githubBranch     String?   @default("main")
  githubSyncStatus String?   // "SYNCED" | "BEHIND" | "FAILED"
  lastCommitSha    String?   // Latest commit SHA
  lastGithubSyncAt DateTime?
}
```

---

### B. `D:\zuri-ai` (UI Component: `/platform/workspaces/[id]/files`)

1. **GitHub Integration & Webhook Sync:**
   * Bind business units to dedicated GitHub repos (e.g. `https://github.com/Freshair129/TN001B01-SmartGift.git`).
   * Webhook endpoint (`/api/webhooks/github`) to auto-refresh repository trees upon push.
   * **"Sync GitHub"** button pulling tree via Octokit/GitHub API (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`).

2. **Interactive File Tree View (Left Pane):**
   * Collapsible recursive folder tree (`config/`, `data-pipeline/`, `docs/`, `pipeline/`, `src/`, `vaults/`, `tests/`).
   * Purpose badges: `[Raw Data]`, `[Prepared Catalog]`, `[Review Report]`, `[Vault DB]`.

3. **In-App File Content Previewer (Right Pane):**
   * **Markdown (`.md`)**: Formatted rendering with Mermaid diagram support.
   * **Code (`.py`, `.ts`, `.tsx`, `.sql`, `.json`, `.yaml`)**: Syntax highlighting with line numbers.
   * **Audit Logs (`.jsonl`)**: Interactive table showing event IDs, timestamps, and actions.
   * **PDF & Images (`.pdf`, `.png`, `.jpg`)**: Inline preview viewer.
   * File Metadata: Size, latest commit SHA, commit message, and author.

---

## 3. Non-Negotiable Invariants

1. **Read-Only Code Explorer:** The in-app file tree explorer is strictly read-only for governance and inspection. Edits must be performed via Git pull requests or authorized agent commits.
