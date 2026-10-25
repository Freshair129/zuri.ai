"""Run Hyper_RAG on chunks from the frozen Paddle OCR text projection.

This is an experimental candidate sidecar. It never calls a Zuri write API.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import json
import logging
import httpx
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from hyperextract.methods.rag import Hyper_RAG
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter


ROOT = Path('.local/hyper-extract-20261025/run-3')
BUNDLE_PATH = ROOT / 'source-bundle.json'
FREEZE_PATH = ROOT / 'freeze.json'
OUTPUT_PATH = ROOT / 'candidates.json'
MODEL = 'qwen3.5:9b'
BASE_URL = 'http://127.0.0.1:11434/v1'
CHUNK_SIZE = 2048
CHUNK_OVERLAP = 256
MAX_OUTPUT_TOKENS = 2048
TIMEOUT_SECONDS = 120


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def source_tree_sha256(root: Path) -> str:
    entries = []
    files = (item for item in root.rglob('*') if item.is_file() and '__pycache__' not in item.parts and item.suffix != '.pyc')
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        entries.append(f'{relative}\0{digest}\n')
    return hashlib.sha256(''.join(entries).encode('utf-8')).hexdigest()


def api_json(path: str) -> dict:
    url = BASE_URL.removesuffix('/v1').rstrip('/') + path
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


def cold_load_probe() -> dict:
    """Measure Ollama's reported load duration without using corpus text."""
    url = BASE_URL.removesuffix('/v1').rstrip('/') + '/api/chat'
    payload = {
        'model': MODEL,
        'messages': [{'role': 'user', 'content': 'Reply with OK.'}],
        'stream': False,
        'think': False,
        'options': {'num_ctx': 4096, 'num_predict': 1},
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        result = json.loads(response.read().decode('utf-8'))
    return {
        'request': {'endpoint': '/api/chat', 'think': False, 'numCtx': 4096, 'numPredict': 1, 'usedCorpusText': False},
        'wallMs': round((time.perf_counter() - started) * 1000, 3),
        'loadDurationNs': result.get('load_duration'),
        'totalDurationNs': result.get('total_duration'),
        'promptEvalCount': result.get('prompt_eval_count'),
        'evalCount': result.get('eval_count'),
        'thinkingPresentObserved': bool(result.get('message', {}).get('thinking')),
        'contextAfter': next((item.get('context_length') for item in api_json('/api/ps').get('models', []) if item.get('name') == MODEL), None),
    }


class UnusedEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError('Hyper_RAG unexpectedly requested vector embeddings during extraction-only trial')

    def embed_query(self, text: str) -> list[float]:
        raise RuntimeError('Hyper_RAG unexpectedly requested query embeddings during extraction-only trial')


class JsonSchemaChatOpenAI(ChatOpenAI):
    """Use Ollama's schema-constrained response path for upstream structured calls."""

    def with_structured_output(self, schema=None, *, method=None, **kwargs):
        return super().with_structured_output(schema, method='json_schema', **kwargs)


class CallObserver(BaseCallbackHandler):
    def __init__(self) -> None:
        self.starts = 0
        self.started_at: dict[str, float] = {}
        self.responses: list[dict] = []
        self.errors: list[str] = []

    def on_chat_model_start(self, serialized, messages, *, run_id=None, **kwargs) -> None:
        self.starts += 1
        if run_id is not None:
            self.started_at[str(run_id)] = time.perf_counter()

    def on_llm_end(self, response, *, run_id=None, **kwargs) -> None:
        ended_at = time.perf_counter()
        elapsed_ms = None
        if run_id is not None:
            started_at = self.started_at.pop(str(run_id), None)
            if started_at is not None:
                elapsed_ms = round((ended_at - started_at) * 1000, 3)
        for generation in response.generations[0]:
            message = generation.message
            metadata = getattr(message, 'response_metadata', {}) or {}
            additional = getattr(message, 'additional_kwargs', {}) or {}
            usage = response.llm_output or {}
            self.responses.append({
                'finishReason': metadata.get('finish_reason'),
                'elapsedMs': elapsed_ms,
                'promptEvalCount': metadata.get('prompt_eval_count'),
                'evalCount': metadata.get('eval_count'),
                'tokenUsage': usage.get('token_usage'),
                'toolCallCount': len(getattr(message, 'tool_calls', []) or []),
                'reasoningPresent': bool(
                    metadata.get('reasoning')
                    or additional.get('reasoning')
                    or additional.get('reasoning_content')
                ),
            })

    def on_llm_error(self, error, **kwargs) -> None:
        self.errors.append(type(error).__name__)


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger('hyperextract').setLevel(logging.WARNING)
    bundle = json.loads(BUNDLE_PATH.read_text(encoding='utf-8'))
    freeze = json.loads(FREEZE_PATH.read_text(encoding='utf-8'))
    runner_sha256 = hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest()
    if runner_sha256 != freeze['executionAdapter']['runnerSha256']:
        raise RuntimeError('extraction runner source hash does not match freeze')
    hyper_version = importlib.metadata.version('hyperextract')
    if hyper_version != freeze['package']['version']:
        raise RuntimeError(f'installed Hyper-Extract {hyper_version} != frozen {freeze["package"]["version"]}')
    package_spec = importlib.util.find_spec('hyperextract')
    if not package_spec or not package_spec.origin:
        raise RuntimeError('could not locate installed Hyper-Extract source')
    package_source = Path(package_spec.origin).resolve().parent
    installed_tree_sha256 = source_tree_sha256(package_source)
    expected_installation = freeze['package']['installation']
    if installed_tree_sha256 != expected_installation['sourceTreeSha256']:
        raise RuntimeError(f'installed Hyper-Extract source tree hash mismatch: {installed_tree_sha256}')
    distribution = importlib.metadata.distribution('hyperextract')
    direct_url_text = distribution.read_text('direct_url.json') or '{}'
    direct_url = json.loads(direct_url_text)
    installed_root = Path(direct_url['url'].removeprefix('file:///')).resolve() if direct_url.get('url', '').startswith('file:///') else Path('')
    if not direct_url.get('dir_info', {}).get('editable') or installed_root != package_source.parent:
        raise RuntimeError('installed Hyper-Extract is not the frozen editable source checkout')
    source_commit = subprocess.run(['git', '-C', str(installed_root), 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
    if source_commit != expected_installation['sourceCommit']:
        raise RuntimeError(f'Hyper-Extract source commit mismatch: {source_commit}')
    canonical_bundle_hash = hashlib.sha256(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    frozen_hash = freeze['sourceBundleSha256']
    # The prepare script hashes insertion-ordered JSON.stringify output. Python's
    # compact encoder preserves that key order, so the hashes must match exactly.
    if canonical_bundle_hash != frozen_hash:
        raise RuntimeError(f'source bundle hash mismatch: {canonical_bundle_hash} != {frozen_hash}')

    before_ps = api_json('/api/ps')
    runtime_before_probe = before_ps
    occupied = [entry.get('name') for entry in before_ps.get('models', [])]
    unexpected_models = [name for name in occupied if name and name != MODEL]
    if unexpected_models:
        raise RuntimeError(f'refusing to start alongside unrelated resident Ollama model(s): {unexpected_models}')
    before_tags = api_json('/api/tags')
    tag = next((item for item in before_tags.get('models', []) if item.get('name') == MODEL), None)
    if not tag or tag.get('digest') != freeze['inference']['modelDigest']:
        raise RuntimeError('installed inference model tag/digest does not match the frozen protocol')
    runtime = api_json('/api/version')

    load_probe = None
    if not occupied:
        load_probe = cold_load_probe()
        before_ps = api_json('/api/ps')
    runtime_before_extraction = before_ps
    expected_context = freeze['inference']['expectedContextLength']
    observed_context = next((item.get('context_length') for item in runtime_before_extraction.get('models', []) if item.get('name') == MODEL), None)
    if observed_context != expected_context:
        raise RuntimeError(f'Ollama context length {observed_context} != frozen {expected_context}; refusing to modify resident model state')

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ', ''],
        add_start_index=True,
    )
    document_chunks: list[dict] = []
    for source in bundle['sourceRanges']:
        split_docs = splitter.split_documents([Document(page_content=source['text'])])
        chunks = []
        for chunk_index, split_doc in enumerate(split_docs):
            start = split_doc.metadata.get('start_index')
            text = split_doc.page_content
            if not isinstance(start, int) or start < 0 or source['text'][start:start + len(text)] != text:
                raise RuntimeError(f'chunk-to-source offset mismatch: {source["id"]}/{chunk_index}')
            chunks.append({
                'chunkIndex': chunk_index,
                'sourceStart': source['sourceStart'] + start,
                'sourceEnd': source['sourceStart'] + start + len(text),
                'sourceRelativeStart': start,
                'sourceRelativeEnd': start + len(text),
                'textChars': len(text),
                'textSha256': sha256(text),
                'text': text,
            })
        document_chunks.append({
            'sourceId': source['id'],
            'sourceTextSha256': source['textSha256'],
            'chunks': chunks,
        })
    planned_chunks = sum(len(document['chunks']) for document in document_chunks)
    planned_base_calls = planned_chunks * 2
    if OUTPUT_PATH.exists():
        raise RuntimeError(f'refusing to overwrite existing extraction receipt: {OUTPUT_PATH}')

    observer = CallObserver()
    request_bodies: list[dict] = []

    def observe_request(request: httpx.Request) -> None:
        try:
            body = json.loads(request.content.decode('utf-8'))
        except Exception:
            body = {}
        response_format = body.get('response_format') or {}
        request_bodies.append({
            'path': request.url.path,
            'model': body.get('model'),
            'maxTokens': body.get('max_tokens'),
            'maxCompletionTokens': body.get('max_completion_tokens'),
            'reasoningEffort': body.get('reasoning_effort'),
            'responseFormatType': response_format.get('type') if isinstance(response_format, dict) else None,
            'responseFormatName': (response_format.get('json_schema') or {}).get('name') if isinstance(response_format, dict) else None,
            'messageCount': len(body.get('messages', [])),
            'messageChars': sum(len(message.get('content') or '') for message in body.get('messages', []) if isinstance(message.get('content'), str)),
        })

    http_client = httpx.Client(event_hooks={'request': [observe_request]})
    llm = JsonSchemaChatOpenAI(
        model=MODEL,
        base_url=BASE_URL,
        api_key='ollama',
        temperature=0,
        max_tokens=MAX_OUTPUT_TOKENS,
        timeout=TIMEOUT_SECONDS,
        max_retries=0,
        reasoning_effort='none',
        extra_body={'max_tokens': MAX_OUTPUT_TOKENS},
        callbacks=[observer],
        http_client=http_client,
    )
    results = {
        'schema': 'zuri.hyper-extract-candidate-graph.v1',
        'status': 'RUNNING',
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'sourceBundleSha256': frozen_hash,
        'freezeSha256': hashlib.sha256(FREEZE_PATH.read_bytes()).hexdigest(),
        'hyperExtractVersion': hyper_version,
        'hyperExtractInstallation': {
            'editable': direct_url.get('dir_info', {}).get('editable') is True,
            'sourceCommit': source_commit,
            'sourceTreeSha256': installed_tree_sha256,
            'sourceRootRelative': '.local/hyper-extract-20261025/upstream/hyperextract',
        },
        'pythonPackages': {
            name: importlib.metadata.version(name)
            for name in ['hyperextract', 'langchain', 'langchain-community', 'langchain-openai', 'langchain-text-splitters', 'ontomem', 'ontosight', 'faiss-cpu']
        },
        'model': {
            'tag': MODEL,
            'digest': tag['digest'],
            'ollamaVersion': runtime.get('version'),
            'runtimeBeforeProbe': runtime_before_probe,
            'runtimeBeforeExtraction': runtime_before_extraction,
        'runtimeAfter': None,
            'coldLoadProbe': load_probe,
            'requestedReasoningEffort': 'none',
            'reasoningFieldObserved': False,
            'contextLengthObserved': next((item.get('context_length') for item in runtime_before_extraction.get('models', []) if item.get('name') == MODEL), None),
            'coldLoadMs': (load_probe.get('loadDurationNs') / 1_000_000) if load_probe and load_probe.get('loadDurationNs') is not None else None,
            'coldLoadNotMeasured': None if load_probe else 'model was already resident; it was not unloaded to avoid disturbing runtime state',
        },
        'settings': {
            'chunkSizeChars': CHUNK_SIZE,
            'chunkOverlapChars': CHUNK_OVERLAP,
            'maxWorkers': 1,
            'temperature': 0,
            'maxOutputTokens': MAX_OUTPUT_TOKENS,
            'structuredOutputMethod': 'json_schema',
            'legacyMaxTokensFieldSent': MAX_OUTPUT_TOKENS,
            'expectedContextLength': expected_context,
            'perCallTimeoutSeconds': TIMEOUT_SECONDS,
            'maxRetries': 0,
            'plannedChunks': planned_chunks,
            'plannedBaseStructuredCalls': planned_base_calls,
            'actualStructuredCallStarts': 0,
            'actualStructuredCallResponses': 0,
            'actualStructuredCallErrors': 0,
            'embeddingCalls': 0,
        },
        'timing': {'extractionWallMs': None, 'perChunk': []},
        'requestBodies': request_bodies,
        'documents': document_chunks,
        'error': None,
    }
    OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    run_started = time.perf_counter()
    try:
        completed = 0
        for document in results['documents']:
            for chunk in document['chunks']:
                graph = Hyper_RAG(
                    llm_client=llm,
                    embedder=UnusedEmbeddings(),
                    chunk_size=CHUNK_SIZE,
                    chunk_overlap=CHUNK_OVERLAP,
                    max_workers=1,
                    verbose=False,
                )
                call_start = observer.starts
                response_start = len(observer.responses)
                request_start = len(request_bodies)
                chunk_started = time.perf_counter()
                feed_error = None
                try:
                    graph.feed_text(
                        chunk['text'],
                        source_id=f"{document['sourceId']}:chunk:{chunk['chunkIndex']:02d}",
                        content_hash=chunk['textSha256'],
                    )
                except Exception as error:  # Keep the measured failure and stop after a broken chunk.
                    feed_error = {'type': type(error).__name__, 'message': str(error)}
                chunk_record = {
                    'chunkIndex': chunk['chunkIndex'],
                    'sourceStart': chunk['sourceStart'],
                    'sourceEnd': chunk['sourceEnd'],
                    'sourceRelativeStart': chunk['sourceRelativeStart'],
                    'sourceRelativeEnd': chunk['sourceRelativeEnd'],
                    'textChars': chunk['textChars'],
                    'textSha256': chunk['textSha256'],
                    'inputText': chunk['text'],
                    'elapsedMs': round((time.perf_counter() - chunk_started) * 1000, 3),
                    'llmCallStarts': observer.starts - call_start,
                    'llmResponses': observer.responses[response_start:],
                    'nodes': [node.model_dump(mode='json') for node in graph.nodes],
                    'edges': [edge.model_dump(mode='json') for edge in graph.edges],
                    'extractionFailures': graph.extraction_failures,
                    'feedError': feed_error,
                }
                document['chunks'][chunk['chunkIndex']] = chunk_record
                completed += 1
                results['settings']['actualStructuredCallStarts'] = observer.starts
                results['settings']['actualStructuredCallResponses'] = len(observer.responses)
                results['settings']['actualStructuredCallErrors'] = len(observer.errors)
                results['model']['reasoningFieldObserved'] = any(item['reasoningPresent'] for item in observer.responses)
                results['timing']['perChunk'].append({
                    'sourceId': document['sourceId'],
                    'chunkIndex': chunk['chunkIndex'],
                    'elapsedMs': chunk_record['elapsedMs'],
                    'callStarts': chunk_record['llmCallStarts'],
                    'nodeCount': len(chunk_record['nodes']),
                    'edgeCount': len(chunk_record['edges']),
                    'failureCount': len(chunk_record['extractionFailures']) + int(bool(feed_error)),
                })
                results['status'] = 'RUNNING'
                OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                print(json.dumps({
                    'event': 'chunk_complete',
                    'completed': completed,
                    'planned': planned_chunks,
                    'sourceId': document['sourceId'],
                    'chunkIndex': chunk['chunkIndex'],
                    'chars': chunk['textChars'],
                    'calls': chunk_record['llmCallStarts'],
                    'nodes': len(chunk_record['nodes']),
                    'edges': len(chunk_record['edges']),
                    'failures': len(chunk_record['extractionFailures']) + int(bool(feed_error)),
                    'elapsedMs': chunk_record['elapsedMs'],
                }, ensure_ascii=False), flush=True)
                if feed_error or chunk_record['extractionFailures']:
                    raise RuntimeError(f"Hyper extraction failed for {document['sourceId']}/chunk-{chunk['chunkIndex']}")
                chunk_requests = request_bodies[request_start:]
                if len(chunk_requests) != chunk_record['llmCallStarts'] or any(
                    item.get('model') != MODEL
                    or item.get('maxTokens') != MAX_OUTPUT_TOKENS
                    or item.get('maxCompletionTokens') != MAX_OUTPUT_TOKENS
                    or item.get('responseFormatType') != 'json_schema'
                    for item in chunk_requests
                ):
                    raise RuntimeError(f'outbound request configuration did not match freeze for {document["sourceId"]}/chunk-{chunk["chunkIndex"]}')
    except Exception as error:
        results['status'] = 'FAILED'
        results['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        results['timing']['extractionWallMs'] = round((time.perf_counter() - run_started) * 1000, 3)
        results['model']['runtimeAfter'] = api_json('/api/ps')
        results['model']['contextLengthAfterExtraction'] = next((
            item.get('context_length') for item in results['model']['runtimeAfter'].get('models', []) if item.get('name') == MODEL
        ), None)
        results['settings']['actualStructuredCallStarts'] = observer.starts
        results['settings']['actualStructuredCallResponses'] = len(observer.responses)
        results['settings']['actualStructuredCallErrors'] = len(observer.errors)
        results['model']['reasoningFieldObserved'] = any(item['reasoningPresent'] for item in observer.responses)
        results['model']['callResponseMetadata'] = observer.responses
        results['model']['callErrors'] = observer.errors
        results['settings']['actualStructuredCallRequestBodies'] = len(request_bodies)
        results['settings']['requestConfigurationsMatchFreeze'] = all(
            item.get('model') == MODEL
            and item.get('maxTokens') == MAX_OUTPUT_TOKENS
            and item.get('maxCompletionTokens') == MAX_OUTPUT_TOKENS
            and item.get('responseFormatType') == 'json_schema'
            for item in request_bodies
        )
        if results['status'] != 'FAILED' and (len(request_bodies) != observer.starts or not results['settings']['requestConfigurationsMatchFreeze']):
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'actual request bodies did not match frozen JSON Schema/cap/model configuration'}
        if results['status'] != 'FAILED' and results['model']['contextLengthAfterExtraction'] != expected_context:
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'Ollama context length changed during extraction'}
        if results['status'] != 'FAILED':
            results['finishedAt'] = datetime.now(timezone.utc).isoformat()
            results['status'] = 'COMPLETED'
        OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        http_client.close()

    print(json.dumps({
        'event': 'extraction_complete',
        'status': results['status'],
        'chunks': planned_chunks,
        'calls': observer.starts,
        'responses': len(observer.responses),
        'elapsedMs': results['timing']['extractionWallMs'],
        'output': str(OUTPUT_PATH),
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
