"""ONNX variant of embed-sidecar.py for machines where torch is unavailable
(e.g. Windows Smart App Control blocks torch's unsigned DLLs).

Same HTTP contract as embed-sidecar.py: GET /health, POST /embed
{texts, kind} -> {vectors, model, revision}. Same model family
(multilingual-e5-small), e5 prefix convention, mean pooling + L2 normalize.
"""
import os

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from huggingface_hub import hf_hub_download
from pydantic import BaseModel
from tokenizers import Tokenizer

MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
REVISION = os.environ.get("EMBED_MODEL_REVISION") or None
MAX_SEQ = 512


def _download(filename, repos):
    last_err = None
    for repo, rev in repos:
        try:
            return hf_hub_download(repo, filename, revision=rev)
        except Exception as err:  # noqa: BLE001 - try next candidate
            last_err = err
    raise last_err


# intfloat repos ship an ONNX export under onnx/; Xenova mirrors are the fallback.
_CANDIDATES = [
    (MODEL, REVISION),
    (MODEL, None),
    (f"Xenova/{MODEL.split('/')[-1]}", None),
]
_onnx_path = None
for _fname in ("onnx/model.onnx", "model.onnx"):
    try:
        _onnx_path = _download(_fname, _CANDIDATES)
        break
    except Exception:
        continue
if _onnx_path is None:
    raise RuntimeError(f"no ONNX export found for {MODEL}")

_tokenizer = Tokenizer.from_file(_download("tokenizer.json", _CANDIDATES))
_tokenizer.enable_truncation(max_length=MAX_SEQ)
_session = ort.InferenceSession(_onnx_path, providers=["CPUExecutionProvider"])
_input_names = {i.name for i in _session.get_inputs()}

app = FastAPI()


class EmbedIn(BaseModel):
    texts: list[str]
    kind: str = "passage"


def _encode(texts):
    _tokenizer.enable_padding()
    enc = _tokenizer.encode_batch(texts)
    input_ids = np.array([e.ids for e in enc], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
    if "token_type_ids" in _input_names:
        feeds["token_type_ids"] = np.zeros_like(input_ids)
    last_hidden = _session.run(None, feeds)[0]
    mask = attention_mask[..., None].astype(np.float32)
    vecs = (last_hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)
    vecs /= np.clip(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-9, None)
    return vecs.astype(np.float32)


_DIM = _encode(["passage: warmup"]).shape[1]


@app.get("/health")
def health():
    return {"model": MODEL, "revision": REVISION or "(default)", "dim": _DIM, "backend": "onnx"}


@app.post("/embed")
def embed(body: EmbedIn):
    if not body.texts:
        raise HTTPException(400, "texts required")
    if body.kind not in ("query", "passage"):
        raise HTTPException(400, "kind must be query|passage")
    texts = [t if t.startswith(f"{body.kind}: ") else f"{body.kind}: {t}" for t in body.texts]
    out = []
    for i in range(0, len(texts), 32):
        out.append(_encode(texts[i : i + 32]))
    vecs = np.vstack(out)
    return {"vectors": vecs.tolist(), "model": MODEL, "revision": REVISION or "(default)"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBED_PORT", "8891")))
