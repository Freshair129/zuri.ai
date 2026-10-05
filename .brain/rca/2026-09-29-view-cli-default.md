# Generated view CLI default invocation

## Symptom

Running the view generator without arguments exited successfully without updating
files; the immediately following `--check` reported a stale verification page.

## Evidence

The CLI entry condition in `tools/generate-document-views.mjs` required at least
one argument. The contract and package command support default root/graph paths.

## Root cause

An unnecessary argument-count guard suppressed the actual main entrypoint.

## Why the issue escaped detection

Lane validation invoked the command with an explicit `--graph` argument. Pure
render/write tests did not exercise the default CLI call.

## Proposed prevention

Use the module main-entry comparison alone. Test an actual no-argument process
against a tiny temporary repository and assert generated files and CLI output.

## Composed preflight follow-up

The first composed preflight reported new warnings for generated pages lacking
the standard `version` field and for existing paths containing URI-encoded route
parentheses/brackets. The generator provided only `generator_version`, and the
relative-link checker passed encoded URLs directly to filesystem lookup. Add the
standard control field; decode local URL paths before checking existence and keep
malformed/missing paths as findings. Test encoded existing and missing targets.
