# Provider tracing reached the browser dependency graph

## Symptom

Production build failed with UnhandledSchemeError for node:crypto after the
FR-171 change added a SHA-256 hash for the exact versioned prompt template.

## Evidence

Webpack reports the chain model-provider.js -> provider-catalog.js ->
platform/integrations/page.jsx. The UI catalog imports the provider allow-list
from the same module that implements server generation. The previous version
had no Node-only import, so this dependency had compiled.

## Root Cause

A browser consumer reached server implementation through a shared constant.
Adding Node crypto to the implementation made the existing boundary visible.

## Why the issue escaped detection

The focused provider tests execute in Node. Production compilation additionally
builds the client dependency graph and found the error before release.

## Proposed prevention

Keep the single allow-list in a browser-safe constants module. The provider
imports and re-exports it for compatibility; the UI imports the constants
directly. Keep catalog consistency tests and production build in verification.
