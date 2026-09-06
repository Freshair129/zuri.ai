---
id: "RCA-ZURI-DM-POC-DOCKER-BIND"
status: "confirmed"
created_at: "2026-08-11T06:48:00+07:00, ATHER"
---

# Docker webhook listener cannot receive forwarded requests

## Symptom

The canary listener reported `listening`, but a POST to host port 8788 returned an empty reply.

## Evidence

- Container log reported `endpoint: http://127.0.0.1:8787/webhook/line`.
- Docker published `127.0.0.1:8788` to container port 8787.
- `curl` to host port 8788 returned code `000` / `Empty reply from server`.

## Root cause

The CLI hard-coded the Node listener to `127.0.0.1`. Inside a Linux container that loopback is not
the container network interface targeted by Docker port forwarding.

## Why it escaped detection

The original listener was exercised as a host process only. No Docker canary with a host-published
port was part of the webhook archive tests.

## Proposed prevention

Add a validated bind-host setting that defaults to `127.0.0.1`. For Docker only, bind to `0.0.0.0`
inside the container while Docker publishes the port only on host loopback. Add a socket-level
canary check before replacing the live listener.
