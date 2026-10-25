# GenesisRAG17 E5 fixed-batch resource experiment

Status: completed isolated experiment. This changes only the embedding batch loop through a read-only test override; it does not change the application, native input, model, or production runtime.

## Finding

The pinned worker embeds all passage chunks in one request. Its original embedder tokenizes and pads the entire list to the longest item before one ONNX Runtime call. On the frozen 302-chunk input, fixed sequential batches of 32 reduced the measured container peak and elapsed time while preserving every captured embedding and the native retrieval results.

| Measure | Global batch | Sequential batch 32 | Change |
|---|---:|---:|---:|
| GenesisRAG17 stages / scored result rows | 17 / 48 | 17 / 48 | same |
| Chunks embedded | 302 | 302 | same |
| Stage 15 elapsed | 96,269 ms | 56,203 ms | −41.62% |
| Total elapsed | 144,411.328 ms | 113,925.867 ms | −21.11% |
| Cgroup peak | 4,509,458,432 bytes | 2,152,587,264 bytes | −52.27% |
| OOM / process exit | no / 0 | no / 0 | same |

These are one fresh, serial pair, not repeated-run averages. Stage 15 includes model verification, worker/tokenizer/session startup and embedding; the receipt does not split those costs. Cgroup peak is the whole isolated test container, not an embedder-only allocation.

## Equivalence and retrieval

The fixed-32 helper preserves passage and query order, tokenization, prefixes, masks, truncation behavior, pooling, dtype, model and vectors. The parity capture contains 60 outer sidecar requests across both process sessions per arm: one passage request with 302 vectors and 59 query requests/vectors. The scorer separately returns 48 rows from 16 QA items with three repetitions. It is not accurate to call the 60 sidecar requests “48 embedding calls.”

All 302 passage vectors and 59 query vectors are bit-identical between modes: maximum absolute difference 0 and minimum cosine approximately 1 within the frozen thresholds. The 48 native result rows have identical ordered top-five chunk ordinals, source IDs, documents, zones, verified ranges, returned-text hashes and scores after removing run-local artifact IDs. Thus fixed batching preserved ranked retrieval; answer quality was not measured.

## Why the resource change is plausible

The pinned tokenizer reports 81,238 padded token slots for one global batch. Ordered batches of at most 32 use 61,942 slots (−23.8%). The shape proxy `Σ(B×L²)` falls from 21.85 M to 13.09 M (−40.1%). These are tokenizer-derived shape calculations, not an ONNX profiler trace or direct allocation measurements. In this helper, fixed32 makes 10 inner ONNX runs for the passage request, plus one single-vector run for each of 59 query requests; global mode uses one passage run plus those 59 query runs. The inner call count is derived from the implementation, not separately instrumented.

## Frozen scope and runtime

- Native input: 302 chunks, content SHA-256 `a6259e7e4f0f84d2e54f8fddf952eeb214a31f20502b6c7b8515d1dfdf1246d9`; input file SHA-256 `b71bdc93b5175bf760cfb5d669dc2f8cc06e4c4a72c65ecb7c43368eaaf9f06c`.
- GenesisRAG17 image: `sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`.
- Model: `intfloat/multilingual-e5-small`, revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, CPU execution provider, read-only model volume.
- Resource profile: 2 CPU, 6 GiB memory with a 6 GiB combined memory-plus-swap cap (no additional swap), network disabled, fresh disposable state for each arm.
- Base image embedder SHA-256: `dd7e9e51f61faf5a3d6d0bbe894c8c75b235f589c0906ca952c790afeb555e35`.
- Experimental read-only helper override SHA-256: `ef9935362c9a03184b6465c3c7c5c731c23a8030e48ea852069a08700aae68da`. Both runs used the same override; only `KI17_EMBED_BATCH_SIZE` changed from `0` to `32`.

The pinned image and original worker remain unchanged; the read-only helper override is experimental code and is not an upstream or application-source change. QA and gold were not used to choose the batch size. The captured vectors contain no raw input text; each request is bound with role, ordinal and an unambiguous ordered-input hash. A pre-fix empty-trace comparator attempt is preserved as invalid diagnostic data and excluded from the parity result and evidence seal.

## Verification

- `test_embedder_batching.py`: 9/9 pass in the pinned image, without loading a model.
- `test_compare_captures.py`: 3/3 pass in the pinned image, including rejection of empty captures.
- `test_pair_contracts.mjs`: 4/4 pass; covers resource-key order, pinned image/model revision, top-k identity/order, and missing stable source identity.
- `evaluate_pair.mjs`: PASS on the two completed native receipts and valid vector capture.
- Native runs: both completed all 17 stages and 48 scored result rows, exited 0, and were not OOM-killed.

From the repository root, the contract and native commands were:

```powershell
node --test reports/oxr-thai-2026-10-25/e5-microbatch-v1/test_pair_contracts.mjs
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=32m --memory 512m --memory-swap 512m --mount "type=bind,src=$((Get-Location).Path)\reports\oxr-thai-2026-10-25\e5-microbatch-v1\test_embedder_batching.py,dst=/tmp/test_embedder_batching.py,readonly" --mount "type=bind,src=$((Get-Location).Path)\reports\oxr-thai-2026-10-25\e5-microbatch-v1\embedder_batch32.py,dst=/tmp/embedder_batch32.py,readonly" --entrypoint /opt/ki17/venv/bin/python sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39 /tmp/test_embedder_batching.py /tmp/embedder_batch32.py
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=32m --memory 512m --memory-swap 512m --mount "type=bind,src=$((Get-Location).Path)\reports\oxr-thai-2026-10-25\e5-microbatch-v1\test_compare_captures.py,dst=/tmp/test_compare_captures.py,readonly" --mount "type=bind,src=$((Get-Location).Path)\reports\oxr-thai-2026-10-25\e5-microbatch-v1\compare_captures.py,dst=/tmp/compare_captures.py,readonly" --entrypoint /opt/ki17/venv/bin/python sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39 /tmp/test_compare_captures.py /tmp/compare_captures.py
& 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/run-native-paired.ps1' -Mode global -PreflightOnly
& 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/run-native-paired.ps1' -Mode batch32 -PreflightOnly
& 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/run-native-paired.ps1' -Mode global
& 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/run-native-paired.ps1' -Mode batch32
node reports/oxr-thai-2026-10-25/e5-microbatch-v1/evaluate_pair.mjs .local/e5-microbatch-20261025/native-global-attempt-1 .local/e5-microbatch-20261025/native-batch32-attempt-1 .local/e5-microbatch-20261025/captured-vector-parity.json .local/e5-microbatch-20261025/native-pair-summary-<new-output>.json
```

The capture comparator is invoked with explicit input and output paths, not unittest discovery: `python compare_captures.py <global-capture-dir> <batch32-capture-dir> <frozen-chunks.json> <new-parity.json>`. The native runner's attempt paths are single-use; preserve each completed attempt and choose fresh output/container names for a rerun.

The resource diagnosis and machine-readable paired result are [resource-diagnosis.md](resource-diagnosis.md) and [measurement-summary.json](measurement-summary.json). The hashes and byte lengths for the report, source, freeze, profiles, native receipts, logs and vector captures are in [evidence-manifest.json](evidence-manifest.json). No application behavior, retrieval result, stage contract, graph authority or production configuration changed.
