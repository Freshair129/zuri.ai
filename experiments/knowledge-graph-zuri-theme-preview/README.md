# Zuri Knowledge Graph preview overlay

This isolated experiment produces a local, Zuri-themed preview of the AI Coding Dictionary graph. It transforms a supplied HTML capture or fetches the current source page at build time. The repository contains only the independently authored builder, CSS overlay, branding script, tests, and these instructions; it does not contain a captured page, source bundle, or graph data.

The default source is [The AI Coding Dictionary](https://www.aicodingdictionary.com/?q=Agent&term=agent), published by AIHero.dev. Its source-credit text and link remain intact in the generated page, and other source links continue pointing to the original publisher. The branding script changes product presentation labels to `Zuri Knowledge Graph`, `IN CONTEXT`, `USAGE NOTE`, `RELATED KNOWLEDGE`, `N NODES`, and `Zuri.ai`; it does not rewrite graph data or link targets. The overlay leaves the original graph renderer, camera, controls, and interactions in place.

The official source repository's license is reported as unset in an open issue. This package does not redistribute its HTML, website bundle, or data. Keep generated pages local and verify the publisher's current terms before redistributing any source content.

## Build a preview

No dependency installation is needed. The builder uses Node.js built-ins and the built-in `fetch` API.

Fetch the default source page:

```powershell
node experiments/knowledge-graph-zuri-theme-preview/build-preview.mjs
```

Use a supplied local capture instead:

```powershell
node experiments/knowledge-graph-zuri-theme-preview/build-preview.mjs `
  --input "C:\path\to\capture.html" `
  --base-url "https://www.aicodingdictionary.com/?q=Agent&term=agent"
```

The default artifact is written under the operating system temporary directory. `--output <file>` may select a different new path only when it resolves under that same temporary directory; paths in the repository, primary checkout, or any linked worktree are rejected. Existing files are never overwritten. Remote source URLs must use HTTPS and the `www.aicodingdictionary.com` host; redirects to other hosts are rejected. The response body is limited to 20 MiB and the request timeout covers both headers and body consumption. A supplied capture uses the default source URL as its base unless `--base-url` is supplied, so relative links and assets continue to resolve against the publisher.

## Checks

```powershell
node --test experiments/knowledge-graph-zuri-theme-preview/test/build-preview.test.mjs
node --check experiments/knowledge-graph-zuri-theme-preview/build-preview.mjs
node --check experiments/knowledge-graph-zuri-theme-preview/branding.js
```

Preview output is local and disposable. Nothing in this experiment edits the Zuri application or the supplied source capture.
