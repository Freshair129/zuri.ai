import os
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
REVISION = os.environ.get("EMBED_MODEL_REVISION", "614241f622f53c4eeff9890bdc4f31cfecc418b3")
_model = SentenceTransformer(MODEL, revision=REVISION, device="cpu")
_model.max_seq_length = 512
app = FastAPI()


class EmbedIn(BaseModel):
    texts: list[str]
    kind: str = "passage"


@app.get("/health")
def health():
    return {"model": MODEL, "revision": REVISION, "dim": _model.get_sentence_embedding_dimension()}


@app.post("/embed")
def embed(body: EmbedIn):
    if not body.texts:
        raise HTTPException(400, "texts required")
    if body.kind not in ("query", "passage"):
        raise HTTPException(400, "kind must be query|passage")
    texts = [t if t.startswith(f"{body.kind}: ") else f"{body.kind}: {t}" for t in body.texts]
    vecs = _model.encode(texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)
    return {"vectors": vecs.tolist(), "model": MODEL, "revision": REVISION}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBED_PORT", "8891")))
