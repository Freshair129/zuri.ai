"""Experimental Hyper-Extract/Ollama compatibility smoke; no Zuri app writes.

@spec ADR-073, docs/plans/GENESISRAG17-CONTRACT.md
@tested reports/oxr-thai-2026-10-25/hyper-extract-v1/smoke.py
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.request
from datetime import datetime, timezone

from hyperextract.methods.rag import Hyper_RAG
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI


class UnusedEmbeddings(Embeddings):
    """Fail if parse-only extraction unexpectedly starts vector indexing."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("parse-only Hyper-RAG smoke unexpectedly requested embeddings")

    def embed_query(self, text: str) -> list[float]:
        raise RuntimeError("parse-only Hyper-RAG smoke unexpectedly requested embeddings")


class CallObserver(BaseCallbackHandler):
    """Record call counts and server usage without retaining prompt text."""

    def __init__(self) -> None:
        self.starts = 0
        self.ends: list[dict] = []
        self.errors: list[str] = []

    def on_chat_model_start(self, serialized, messages, **kwargs) -> None:
        self.starts += 1

    def on_llm_end(self, response, **kwargs) -> None:
        for generation in response.generations[0]:
            message = generation.message
            metadata = getattr(message, "response_metadata", {}) or {}
            additional = getattr(message, "additional_kwargs", {}) or {}
            usage = response.llm_output or {}
            self.ends.append(
                {
                    "finishReason": metadata.get("finish_reason"),
                    "promptEvalCount": metadata.get("prompt_eval_count"),
                    "evalCount": metadata.get("eval_count"),
                    "tokenUsage": usage.get("token_usage"),
                    "toolCallCount": len(getattr(message, "tool_calls", []) or []),
                    "reasoningPresent": bool(
                        metadata.get("reasoning")
                        or additional.get("reasoning")
                        or additional.get("reasoning_content")
                    ),
                }
            )

    def on_llm_error(self, error, **kwargs) -> None:
        self.errors.append(type(error).__name__)


def ollama_snapshot(base_url: str, endpoint: str) -> dict | None:
    url = base_url.removesuffix("/v1").rstrip("/") + endpoint
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:
        return {"observationError": type(error).__name__}


def main() -> None:
    model = os.environ.get("HYPER_MODEL", "qwen3.5:9b")
    base_url = os.environ.get("HYPER_OPENAI_BASE_URL", "http://127.0.0.1:11434/v1")
    timeout_seconds = int(os.environ.get("HYPER_TIMEOUT_SECONDS", "120"))
    max_output_tokens = int(os.environ.get("HYPER_MAX_OUTPUT_TOKENS", "512"))
    sample = "สมชายเป็นผู้ก่อตั้งบริษัทตัวอย่าง โดยบริษัทตัวอย่างมีสำนักงานใหญ่ในกรุงเทพมหานคร"
    observer = CallObserver()
    before_ps = ollama_snapshot(base_url, "/api/ps")
    before_tags = ollama_snapshot(base_url, "/api/tags")

    llm = ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key="ollama",
        temperature=0,
        max_tokens=max_output_tokens,
        timeout=timeout_seconds,
        max_retries=0,
        reasoning_effort="none",
        callbacks=[observer],
    )
    graph = Hyper_RAG(
        llm_client=llm,
        embedder=UnusedEmbeddings(),
        chunk_size=2048,
        chunk_overlap=256,
        max_workers=1,
        verbose=False,
    )

    started = time.perf_counter()
    graph.feed_text(
        sample,
        source_id="hyper-extract-smoke",
        content_hash=hashlib.sha256(sample.encode("utf-8")).hexdigest(),
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    after_ps = ollama_snapshot(base_url, "/api/ps")
    after_tags = ollama_snapshot(base_url, "/api/tags")
    matching_tag = next(
        (item for item in (after_tags or {}).get("models", []) if item.get("name") == model),
        None,
    )
    failures = graph.extraction_failures
    status = (
        "PASS"
        if graph.nodes and graph.edges and not failures and not observer.errors
        else "FAIL"
    )
    result = {
        "status": status,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "hyperExtractVersion": "0.10.5",
        "model": model,
        "modelDigest": matching_tag.get("digest") if matching_tag else None,
        "ollamaVersion": ollama_snapshot(base_url, "/api/version"),
        "baseUrl": base_url,
        "reasoningEffortRequest": "none",
        "reasoningPresentObserved": any(item["reasoningPresent"] for item in observer.ends),
        "maxOutputTokens": max_output_tokens,
        "timeoutSeconds": timeout_seconds,
        "maxRetries": 0,
        "chunkSize": 2048,
        "chunkOverlap": 256,
        "maxWorkers": 1,
        "sourceChars": len(sample),
        "sourceSha256": hashlib.sha256(sample.encode("utf-8")).hexdigest(),
        "elapsedMs": elapsed_ms,
        "llmCallStarts": observer.starts,
        "llmCallResponses": observer.ends,
        "llmCallErrors": observer.errors,
        "extractionFailures": failures,
        "nodes": [item.model_dump(mode="json") for item in graph.nodes],
        "edges": [item.model_dump(mode="json") for item in graph.edges],
        "embeddingCalls": 0,
        "ollamaPsBefore": before_ps,
        "ollamaPsAfter": after_ps,
        "note": "A PASS requires non-empty Hyper-Extract nodes and edges with no swallowed extraction failures. Requesting reasoning_effort=none is recorded separately from observed reasoning metadata; the OpenAI-compatible API does not set context size. This smoke qualifies schema/tool-call compatibility only, not extraction accuracy or GKS graph admission.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if status != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
