---
version: "0.1.0b"
created_at: "2026-09-04T09:40:00+07:00,Claude"
last_update: "2026-09-04T09:40:00+07:00,Claude"
status: "beta"
superseded_by: null
attributes:
  domain: "edge-extraction"
  scope: "Device-side runtime for edge-executed asset evidence extraction: the worker loop, the local extractor, the CLI, and what this device can and cannot actually read"
---

# Edge-executed evidence extraction — the device side

This is the runtime that pulls asset-evidence extraction jobs from Zuri Cloud, reads each
document with the model running on this machine, and posts a candidate back. It implements
the device half of a contract the cloud owns — **FR-143** (the extraction job lane) and
**FR-144** (the edge device credential) in the zuri-ai repository, decided in its ADR-059.

The cloud never calls this device. Every call is outbound, which is what lets a device sit
behind a home or warehouse NAT with no inbound rule (ADR-041 D3).

---

## Read this first: what this device can actually read today

**Out of the box, nothing.** This runtime's local model ladder is `qwen3.5:9b` with
`pathumma-thaillm-8b` behind it (`docs/LOCAL-MODEL-SELECTION.md`), and **neither can see an
image**. They are text models. On a device configured exactly as that document describes,
the worker still runs, still claims jobs, and fails every one of them with a reason the
console shows in Thai.

That is the intended behaviour, not an unfinished corner. A candidate is reviewed by a
Human in the cloud console who reads it as *what a machine saw in the document*. A text
model handed no picture will still produce a plausible receipt — vendor, date, total — and
that fabrication is worse than a failed job in the way that matters: a failed job is
obviously unfinished and gets fixed, a fabricated one gets approved.

| Evidence | Today |
|---|---|
| `image/jpeg`, `image/png`, `image/webp` | Read, **once a vision model is installed and named** (below). Otherwise failed with a reason. |
| `application/pdf` | Always failed. A local chat daemon accepts images, not PDFs, and this repository has no rasteriser. Adding one is a deliberate piece of work, not a silent conversion. |
| Anything else | Failed. The cloud declares only the four types above. |

To make images actually readable, install a vision model in the local daemon and name it:

```bash
ollama pull qwen3-vl:8b            # or any vision model your hardware fits
export ZURI_LLM_BASE_URL="http://localhost:11434/v1"
export ZURI_EXTRACTION_VISION_MODEL="qwen3-vl:8b"
```

The round trip has been run end to end against Ollama with
`hf.co/mradermacher/olmOCR-7B-thai-v3-GGUF:Q4_K_M`, which read a Thai/English receipt and
returned all nine printed fields. Any vision model the daemon serves over its
OpenAI-compatible endpoint works the same way; that one is named here because it is the one
the claim rests on, not because it is required.

`ZURI_EXTRACTION_VISION_MODEL` is deliberately a *separate* setting from `ZURI_LLM_MODEL`.
Sharing one would mean that switching on the conversational model quietly enrolled a blind
text model into reading documents a Human then approves.

### What the model is allowed to answer, and what happens when it doesn't

The prompt asks for `fields` as an array of `{field, value, page, anchor}`. Document-OCR
models very often answer with a map from the printed label to what was printed beside it
instead:

```json
{"documentType": "RECEIPT", "fields": {"เลขที่ / Receipt No.": "RC-2026-00418"}}
```

That is the same reading, correctly done, in a different container, so it is accepted. The
key is kept verbatim as both the field name and the `anchor`, because it *is* the printed
label the value was read next to. No English name is invented for it — turning
`ผู้ขาย / Vendor` into `vendorName` would be this runtime guessing at meaning, which every
other rule here forbids.

**A candidate with zero fields fails the job.** It is not a reading of a document; it is
the model having answered in a shape the contract cannot see. Completing it anyway would
set the evidence to `EXTRACTED` and show a reviewer an empty result, which reads as *the
machine found nothing printed here* — a claim nothing has established. The same argument
that rules out a text model's fabrication rules out a confident blank.

This was found by running the round trip for real, not by review: `olmOCR-7B-thai` read
every line of a Thai/English receipt and the job completed with **zero** fields, because
the map shape was silently discarded.

### Confidence

The cloud's schema requires a `confidence` between 0 and 1 on every field. Local vision
models return no per-field probability worth believing, so this runtime writes a fixed
**0.3** on every field and documents why (`UNVERIFIED_FIELD_CONFIDENCE` in
`src/evidence/extraction-contract.ts`):

- anything at or above 0.5 tells a reviewer "more likely right than wrong", which nothing
  here supports;
- anything near zero says "the model found nothing", which is also untrue;
- it is identical on every field on purpose — a varying invented number would let a
  reviewer read differences that carry no information at all.

`bounds` (a bounding box) is never sent. A chat model can say which label it read a value
next to, but it cannot measure a rectangle, and a fabricated one points the reviewer's
highlight at the wrong part of the page. The `anchor` — the printed label — is kept,
because that is something the model genuinely read.

---

## Operator procedure

### 1. Get a device credential from the cloud

In the Zuri console, sign in as a Business OWNER and open **/platform/integrations → Edge**.
Mint a credential for this device's id (e.g. `edge-bkk-warehouse-01`). The raw key
(`edgk_…`) is shown **exactly once**. Copy it straight into this device's environment; it
cannot be retrieved again, and minting a replacement is the only recovery.

Never paste the key into a terminal transcript, an issue, a PR, a log, or a chat message.
If it may have been seen, revoke it in the console and mint a new one.

### 2. Install it on this device

```bash
export ZURI_CLOUD_BASE_URL="https://<your-cloud-host>"   # the ngrok/VPS origin, not localhost
export ZURI_EDGE_DEVICE_KEY="edgk_..."                   # the raw key, once
```

Both are read through this repository's normal config loader, so the Docker-secrets `_FILE`
convention works and is preferred on a shared machine:

```bash
export ZURI_EDGE_DEVICE_KEY_FILE="/run/secrets/zuri_edge_device_key"
```

Check what the device thinks it has, without printing anything secret:

```bash
node dist/cli/index.js config check     # the edgeExtraction block reports booleans, never values
```

### 3. Prove one round trip

```bash
node dist/cli/index.js extraction once
```

`once` claims **at most one** job and exits. It is the smoke test to run straight after
pasting a credential, because a running loop looks identical whether it is polling
correctly or silently failing to authenticate.

- `{"outcome":"idle"}` — the cloud has nothing queued for this Business (a 204). Trigger an
  extraction in the console and run it again.
- `{"outcome":"completed"}` — the full round trip works.
- `{"outcome":"failed","reason":"…"}` — the job was claimed and reported failed. The reason
  is what the console will show; if it names the vision model, see the section above.

### 4. Run the worker

```bash
node dist/cli/index.js extraction serve
```

It claims one job at a time, reads it, reports the result, and polls every 5 seconds while
the queue is empty (`ZURI_EDGE_POLL_MS`). Stop it with `Ctrl+C`: the stop flag is only read
between jobs, so a document already being read is finished and reported before the process
exits, rather than left holding a lease the cloud must wait ten minutes to reclaim.

---

## Settings

| Variable | Default | What it does |
|---|---|---|
| `ZURI_CLOUD_BASE_URL` | — | The cloud origin. Required. |
| `ZURI_EDGE_DEVICE_KEY` | — | The raw `edgk_…` credential. Required. `_FILE` form supported. |
| `ZURI_EXTRACTION_VISION_MODEL` | *(unset)* | The vision model to read with. Unset means every job is failed with a readable reason. |
| `ZURI_LLM_BASE_URL` | *(unset)* | The local OpenAI-compatible daemon, e.g. `http://localhost:11434/v1`. Shared with the conversational layer — one daemon, one HTTP client. |
| `ZURI_EDGE_POLL_MS` | `5000` | Delay between claims while the queue is empty. |
| `ZURI_EXTRACTION_TIMEOUT_MS` | `120000` | Ceiling on reading one document. Generous, because nothing is waiting on it. |

Concurrency is fixed at **1** and is not configurable. This device holds one local model
that serialises anyway, and a job claimed while another is still queued behind the daemon
can outlive its ten-minute lease — the cloud would requeue it and the work would be done
twice. One at a time keeps "claimed" and "being worked on" the same statement.

Only an `openai-compatible` provider is used for extraction, never the hosted Anthropic
path. A business's evidence bytes staying on its own hardware is the entire reason this
lane exists, so a hosted provider is not a fallback here — it is the thing being avoided.

---

## Failure modes, and what each one looks like

| What you see | What happened | What to do |
|---|---|---|
| `EXTRACTION_NOT_CONFIGURED` | One of the two required variables is missing. The error reports *whether* each is set, never its value. | Set both. They must be set together — one without the other looks activated but claims nothing. |
| `EXTRACTION_CREDENTIAL_REJECTED` (and `serve` exits) | The cloud answered 401. Missing, malformed, unknown and revoked keys are one indistinguishable status by design. | Do not retry. Mint a new credential in the console and reinstall it. |
| Console shows `ล้มเหลว: …vision-capable local model…` | The device claimed the job and honestly reported that it cannot see. | Install a vision model and set `ZURI_EXTRACTION_VISION_MODEL`. |
| Console shows `ล้มเหลว: …no usable fields…` | The model replied with JSON the candidate contract could not read a single field out of. | Check the model actually accepts images (a text model answers confidently and blindly). Nothing is recorded — this is deliberately not an empty candidate. |
| Console shows `ล้มเหลว: …PDF…` | A PDF was queued. | Re-upload the evidence as an image, or accept that PDFs are out of scope until a rasteriser is added deliberately. |
| `extraction backing off 4000ms…` in the log | A 5xx or a network failure. Backoff doubles from 1s to a 30s ceiling and resets on the first success. | Nothing, unless it persists — then check `ZURI_CLOUD_BASE_URL` and the tunnel. |
| `extraction could not report the verdict for job …` | The result was computed but neither `complete` nor `fail` could be delivered. | Nothing. The lease expires and the cloud requeues the job. The message exists because that recovery is silent on the cloud side. |
| A `edgk_` string anywhere in a log | Should be impossible; `tests/unit/edge-extraction-secrecy.test.ts` exists to keep it so. | Treat the key as exposed: revoke it and mint a replacement. |

Below three attempts a failed job is requeued by the cloud and this device will claim it
again. At the ceiling it stays FAILED, and a Human sees the last reason in the console.

---

## Where the code is

| File | What it holds |
|---|---|
| `src/evidence/extraction-contract.ts` | The wire shapes, the payload builders, backoff, candidate normalisation, the secret scrubber. No I/O. |
| `src/evidence/extraction-client.ts` | The four HTTP calls, and the only line in the runtime that reads the credential. |
| `src/evidence/extraction-extractor.ts` | The local read, and every refusal it makes rather than inventing a field. |
| `src/evidence/extraction-worker.ts` | The loop, the lease promise, and the 401 stop. |
| `src/cli/extraction.ts` | `extraction serve` / `extraction once`. Wiring only. |
| `tests/fixtures/edge-extraction-job.schema.json` | A committed copy of the cloud's schema, taken 2026-09-04. |

The schema is copied rather than read across repositories at runtime: a test that reached
into another checkout would pass or fail on whether that checkout happened to be present
and on which branch it sat. The cost is that a cloud change lands here as a deliberate
re-copy, which is the right kind of work to be visible.
