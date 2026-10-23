# syntax=docker/dockerfile:1.7
# @req FR-187 — update a pinned knowledge runtime on a frozen application image.
# @spec ADR-075
# @tested tests/unit/ki17-msp-only-release.test.js
# BASE and MSP_FROM must be immutable local image digest references. Keep BASE's
# app revision label; CONFIG_REVISION identifies this recipe/manifest separately.
ARG BASE
ARG MSP_FROM
FROM ${MSP_FROM} AS signed_msp
FROM ${BASE}
USER root
ARG PREVIOUS_MSP_COMMIT=68e6169dbb371dac2f0debf0bf731b553f7dc26d
ARG CONFIG_REVISION
COPY deploy/ki17/pins.json deploy/ki17/overlay/check-ki17-from.mjs /tmp/msp-release/
# Validate the original image against the new tuple with ONLY MSP rolled back
# to its explicitly expected previous pin. Other component changes fail closed.
RUN node -e "const fs = require('fs'); if (!/^[0-9a-f]{40}$/.test(process.env.CONFIG_REVISION || '')) throw new Error('CONFIG_REVISION_REQUIRED'); if (!/^[0-9a-f]{40}$/.test(process.env.PREVIOUS_MSP_COMMIT || '')) throw new Error('PREVIOUS_MSP_COMMIT_REQUIRED'); const manifest = JSON.parse(fs.readFileSync('/tmp/msp-release/pins.json')); manifest.repositories.msp.commit = process.env.PREVIOUS_MSP_COMMIT; fs.writeFileSync('/tmp/msp-release/previous-pins.json', JSON.stringify(manifest));" \
 && node /tmp/msp-release/check-ki17-from.mjs /tmp/msp-release/previous-pins.json /opt/ki17/pins/resolved.json
RUN rm -rf /opt/ki17/msp
COPY --from=signed_msp --chown=node:node /opt/ki17/msp /opt/ki17/msp
COPY --from=signed_msp --chown=node:node /opt/ki17/pins /opt/ki17/pins
RUN node /tmp/msp-release/check-ki17-from.mjs /tmp/msp-release/pins.json /opt/ki17/pins/resolved.json \
 && rm -rf /tmp/msp-release
LABEL org.zuri.ki17.configuration-revision=${CONFIG_REVISION}
ARG FINAL_USER=node
USER ${FINAL_USER}
