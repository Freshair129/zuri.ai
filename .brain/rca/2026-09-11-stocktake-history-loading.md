# Stocktake history loading

Version: 1.0.0b; Date: 2026-09-11; Status: beta.

## Symptom

Returning to a blank Stocktake URL while a saved preview is loading can leave the
editor disabled. Invalid saved response data can leave its bad preview id in the URL.

## Evidence and root cause

`loadSaved` increments the operation generation, then its no-id branch returns
without clearing busy. The older request's guarded finally cannot clear it because
that request is now stale. Validation errors also cleared the rendered preview
without clearing the linked id, unlike 403/404 responses.

## Why the issue escaped detection

The initial browser scenarios covered a full Business switch (which unmounts the
desk) and successful reload; they did not cover same-desk history changes.

## Proposed prevention

Within the approved Stocktake UI, reset busy/draft on the no-id path and clear a
structurally invalid saved link. Keep a valid link on transient network failure.
Add a browser regression that delays a real persisted preview response and returns
to the blank desk. Risk LOW; no persistence or authority changes.

Version diff: new history/loading regression and surgical UI state correction.
