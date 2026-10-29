# ADR-115: reproducible disposable TEST provider, never a production selection.
# @tested tests/node/compact-workflow.test.mjs, tests/storage/compact-provider-transport.test.js
FROM golang@sha256:98d673f18a1aac43da744209873cb79323e11706f909251bcfb131828b95559d AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOBIN=/out
RUN go install github.com/minio/minio@7aac2a2c5b7c882e68c1ce017d8256be2feea27f \
 && go install github.com/minio/mc@7394ce0dd2a80935aded936b09fa12cbb3cb8096 \
 && mkdir /notices \
 && cp /go/pkg/mod/github.com/minio/minio@*/LICENSE /notices/MINIO-LICENSE \
 && cp /go/pkg/mod/github.com/minio/mc@*/LICENSE /notices/MC-LICENSE
FROM debian@sha256:a3bba7dc7dbcc1f37c2856c51fc9a7fac96608f50cb87b1b4e4d8b8c85ae988e
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="7aac2a2c5b7c882e68c1ce017d8256be2feea27f" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      com.zuri-ai.compact.scope="DISPOSABLE_TEST_ONLY" \
      com.zuri-ai.compact.mc-source="https://github.com/minio/mc/commit/7394ce0dd2a80935aded936b09fa12cbb3cb8096"
COPY --from=build /out/ /usr/local/bin/
COPY --from=build /notices/ /usr/share/licenses/compact-minio-test/
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/minio"]
