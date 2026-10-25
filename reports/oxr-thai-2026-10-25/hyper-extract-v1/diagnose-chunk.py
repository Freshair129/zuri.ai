"""One-chunk, non-benchmark Hyper-RAG output-cap diagnostic."""
from __future__ import annotations

import hashlib
import httpx
import json
import logging
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from hyperextract.methods.rag import Hyper_RAG
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI

RUN = Path('.local/hyper-extract-20261025/run-2')
MODEL = 'qwen3.5:9b'
BASE_URL = 'http://127.0.0.1:11434/v1'
CHUNK_INDEX = 9
CAP = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
OUT = RUN / f'diagnostic-chunk9-legacy-cap{CAP}.json'


def api_json(path: str) -> dict:
    with urllib.request.urlopen(BASE_URL.removesuffix('/v1') + path, timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


def sha(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class NoEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError('unexpected embedding call')

    def embed_query(self, text: str) -> list[float]:
        raise RuntimeError('unexpected embedding call')


class Observer(BaseCallbackHandler):
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def on_llm_end(self, response, **kwargs) -> None:
        for generation in response.generations[0]:
            message = generation.message
            usage = response.llm_output or {}
            self.calls.append({
                'finishReason': (getattr(message, 'response_metadata', {}) or {}).get('finish_reason'),
                'tokenUsage': usage.get('token_usage'),
                'toolCallCount': len(getattr(message, 'tool_calls', []) or []),
            })


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    if OUT.exists():
        raise RuntimeError(f'refusing to overwrite diagnostic: {OUT}')
    receipt = json.loads((RUN / 'candidates.json').read_text(encoding='utf-8'))
    document = next(item for item in receipt['documents'] if item['sourceId'] == 'economy')
    chunk = document['chunks'][CHUNK_INDEX]
    source_text = json.loads((RUN / 'source-bundle.json').read_text(encoding='utf-8'))['sourceRanges'][0]['text']
    if source_text[chunk['sourceRelativeStart']:chunk['sourceRelativeEnd']] != chunk['inputText']:
        raise RuntimeError('diagnostic chunk does not match its frozen source span')
    runtime_before = api_json('/api/ps')
    unrelated = [item.get('name') for item in runtime_before.get('models', []) if item.get('name') != MODEL]
    if unrelated:
        raise RuntimeError(f'refusing to run beside unrelated model(s): {unrelated}')
    requests: list[dict] = []

    def observe_request(request: httpx.Request) -> None:
        try:
            body = json.loads(request.content.decode('utf-8'))
        except Exception:
            body = {}
        requests.append({
            'path': request.url.path,
            'model': body.get('model'),
            'maxTokens': body.get('max_tokens'),
            'maxCompletionTokens': body.get('max_completion_tokens'),
            'reasoningEffort': body.get('reasoning_effort'),
            'extraBodyKeys': sorted(key for key in body if key not in {'model', 'messages', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'temperature', 'stream', 'tools', 'tool_choice', 'response_format', 'stop'}),
            'messageCount': len(body.get('messages', [])),
            'messageChars': sum(len(message.get('content') or '') for message in body.get('messages', []) if isinstance(message.get('content'), str)),
        })

    observer = Observer()
    client = httpx.Client(event_hooks={'request': [observe_request]})
    llm = ChatOpenAI(
        model=MODEL,
        base_url=BASE_URL,
        api_key='ollama',
        temperature=0,
        max_tokens=CAP,
        timeout=120,
        max_retries=0,
        reasoning_effort='none',
        extra_body={'max_tokens': CAP},
        callbacks=[observer],
        http_client=client,
    )
    graph = Hyper_RAG(llm_client=llm, embedder=NoEmbeddings(), chunk_size=2048, chunk_overlap=256, max_workers=1, verbose=False)
    started = time.perf_counter()
    graph.feed_text(chunk['inputText'], source_id=f'diagnostic:economy:{CHUNK_INDEX}', content_hash=chunk['textSha256'])
    elapsed = round((time.perf_counter() - started) * 1000, 3)
    runtime_after = api_json('/api/ps')
    failures = graph.extraction_failures
    status = 'PASS' if graph.nodes and graph.edges and not failures and len(observer.calls) == len(requests) and len(requests) >= 2 else 'FAIL'
    output = {
        'schema': 'zuri.hyper-extract-one-chunk-diagnostic.v1',
        'status': status,
        'observedAt': datetime.now(timezone.utc).isoformat(),
        'purpose': 'diagnostic only; excluded from full extraction benchmark and native comparison',
        'input': {
            'sourceId': 'economy',
            'chunkIndex': CHUNK_INDEX,
            'sourceRelativeStart': chunk['sourceRelativeStart'],
            'sourceRelativeEnd': chunk['sourceRelativeEnd'],
            'sourceStart': chunk['sourceStart'],
            'sourceEnd': chunk['sourceEnd'],
            'chars': len(chunk['inputText']),
            'sha256': sha(chunk['inputText']),
            'text': chunk['inputText'],
        },
        'model': {
            'tag': receipt['model']['tag'],
            'digest': receipt['model']['digest'],
            'ollamaVersion': receipt['model']['ollamaVersion'],
            'contextLengthBefore': next((m.get('context_length') for m in runtime_before.get('models', []) if m.get('name') == MODEL), None),
            'contextLengthAfter': next((m.get('context_length') for m in runtime_after.get('models', []) if m.get('name') == MODEL), None),
        },
        'settings': {'maxTokensRequested': CAP, 'timeoutSeconds': 120, 'maxRetries': 0, 'temperature': 0, 'reasoningEffort': 'none'},
        'requestBodies': requests,
        'responses': observer.calls,
        'elapsedMs': elapsed,
        'extractionFailures': failures,
        'nodes': [node.model_dump(mode='json') for node in graph.nodes],
        'edges': [edge.model_dump(mode='json') for edge in graph.edges],
        'embeddingCalls': 0,
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'status': status,
        'capRequested': CAP,
        'requestBodies': requests,
        'responses': observer.calls,
        'nodes': len(graph.nodes),
        'edges': len(graph.edges),
        'failures': failures,
        'elapsedMs': elapsed,
        'output': str(OUT),
    }, ensure_ascii=False), flush=True)
    client.close()
    if status != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
