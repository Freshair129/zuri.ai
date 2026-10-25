# GenesisRAG17 embedding resource diagnosis

This is a read-only diagnosis of the frozen native runs. It does not inspect QA, gold, question payloads, native result payloads, or metrics, and it does not make a production or retrieval-quality claim. The machine-readable evidence, hashes, and detailed tensor-shape calculations are in [resource-diagnosis.json](resource-diagnosis.json).

## Bound native runs

The selected current baseline is `.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1`, because its chunk and native-result hashes match the frozen measurement summary. The older `run-v2/native-table` has the same 156-chunk count but a different chunk hash, so its 28.609-second embedding time is historical context, not the bound baseline.

| Arm | Chunks | Test elapsed | Stage 15 embedding | Stage 16 index | Cgroup peak |
|---|---:|---:|---:|---:|---:|
| Current table baseline | 156 | 82.170 s | 37.246 s | 1.570 s | 2.509 GiB |
| Prior PDF-repair reference | 277 | 106.300 s | 58.568 s | 2.110 s | 3.473 GiB |
| Combined PDF-repair + economy rows | 302 | 148.412 s | 107.847 s | 1.670 s | 4.189 GiB |

These are separate historical arms, not paired repeats. The current-baseline-to-combined change is +93.6% chunks, +80.6% total elapsed, +189.6% Stage 15 time, and +1.804 GB cgroup high-water (+67.0%). Stage 16 stayed near 1.6–2.1 seconds. The harness reads `/sys/fs/cgroup/memory.peak`, so RAM is the whole test-container high-water mark, not an embedding-process or operator-specific allocation.

All three runs used the same pinned GenesisRAG17 acceptance image (`sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`), CPU limit 2, memory limit 6 GiB, network disabled, the same model-volume revision mounted read-only, and fresh isolated native state.

## Why chunk count alone understates the work

The pinned worker sends every decision chunk in one `passage` call. The Python embedder tokenizes the entire list with one `encode_batch`, pads every item to the longest sequence in that call (up to 512 tokens), then calls ONNX Runtime once. There is no microbatch bound. This makes the batch maximum affect every row in the batch:

| Arm | Batch shape | Tokenizer max length | Padded token slots `N×L` | Attention shape units `N×L²` |
|---|---:|---:|---:|---:|
| Current table baseline | 156 × 208 | 208 | 32,448 | 6.75 M |
| Prior PDF-repair reference | 277 × 225 | 225 | 62,325 | 14.02 M |
| Combined | 302 × 269 | 269 | 81,238 | 21.85 M |

From the current baseline to combined, padded slots rise 2.50× and the simple attention-shape measure `N×L²` rises 3.24×, versus 1.94× as many chunks. This is a credible source of superlinear CPU work and activation growth. It does not prove a specific operator caused the observed time or RAM delta.

The combined chunk list preserves all 277 prior chunks with identical text, ordinals, and source offsets, then adds 25. Each arm starts with a fresh worker and store, so the combined run recomputes embeddings for the full 302-item list; the 277-item prefix is not reused from the prior arm. In the single combined batch, the max sequence length grows from 225 to 269, adding 12,188 padding slots across that identical prefix and 6,725 slots for the 25 new chunks.

## Pinned implementation

- GenesisBlock source: commit `5156f412da73905a23d74775a82cc14d1f6d04d0`; `worker.mjs` SHA-256 `353ca60a…9fed9e`, `embedder.py` SHA-256 `dd7e9e51…555e35`.
- Model: `intfloat/multilingual-e5-small`, revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`; 384 hidden units, 12 layers, 12 attention heads, 1,536 intermediate width, 512 maximum positions. Runtime selected `CPUExecutionProvider`.
- GenesisRAG17 text profile: parser 3, chunker 2, maximum 80 whitespace tokens, maximum 480 characters, 60-character overlap. The 80-token cap is the chunker's whitespace count, not the model tokenizer's token count.
- The application chunker source was clean at inspection and bind-mounted read-only. Its SHA is recorded in the JSON; the image runtime provenance hashes the executor but does not separately list that imported chunker module.

Stage 15 includes model artifact verification and worker/tokenizer/ONNX-session startup as well as encoding and inference. Those one-time costs are inside the stage; the receipts do not split them out. The separate query-embedding/index stage is much smaller and stable here, so it does not account for the Stage 15 increase.

## Fixed-32 shape estimate

For the combined 302 texts, sequential batches of at most 32 are predicted to use 61,942 padded slots (23.8% below one global batch) and 13.09 M `B×L²` units (40.1% below one global batch). The largest batch shape is 32×269. These are tokenizer-derived shape calculations only; no ONNX inference or timing was performed for this diagnosis. Tensor-size estimates in the JSON are theoretical shapes, not observed allocations. ONNX graph fusion, arena reuse, startup variation, and host contention were not profiled, so the full 1.68 GiB high-water increase cannot be attributed to a particular tensor or operator from these runs.

The frozen run measurements are bound by `measurement-summary.json` SHA-256 `529ddeac…73916aa` and its evidence manifest SHA-256 `c6ee0a2a…a48a442a`. Per-arm raw hashes and source hashes are enumerated in the JSON companion.
