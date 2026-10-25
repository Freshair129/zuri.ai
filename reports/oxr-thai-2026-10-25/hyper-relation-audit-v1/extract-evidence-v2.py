"""Run a fixed evidence-aware companion extraction over run3's exact OCR chunks."""
from __future__ import annotations

import hashlib
import httpx
import json
import logging
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from evidence_schema import EvidenceOutput


RUN_ROOT = Path('.local/hyper-relation-audit-20261025/run-2')
REPORT_DIR = Path('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1')
BUNDLE_PATH = RUN_ROOT / 'source-bundle.json'
CHUNKS_PATH = RUN_ROOT / 'chunks.json'
FREEZE_PATH = RUN_ROOT / 'freeze.json'
OUTPUT_PATH = RUN_ROOT / 'evidence-candidates.json'
PROMPT_PATH = REPORT_DIR / 'evidence-prompt-v2.md'
SCHEMA_PATH = REPORT_DIR / 'evidence_schema.py'
BASE_URL = 'http://127.0.0.1:11434/v1'
MODEL = 'qwen3.5:9b'
TIMEOUT_SECONDS = 120


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def api_json(path: str) -> dict:
    url = BASE_URL.removesuffix('/v1').rstrip('/') + path
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


def cold_load_probe() -> dict:
    """Load the frozen model at the selected context without corpus text."""
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
        elapsed_ms = None
        if run_id is not None:
            started = self.started_at.pop(str(run_id), None)
            if started is not None:
                elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        generation_groups = getattr(response, 'generations', []) or []
        generation = generation_groups[0][0] if generation_groups and generation_groups[0] else None
        message = getattr(generation, 'message', None)
        metadata = getattr(message, 'response_metadata', {}) or {}
        self.responses.append({
            'finishReason': metadata.get('finish_reason'),
            'elapsedMs': elapsed_ms,
            'promptEvalCount': metadata.get('prompt_eval_count'),
            'evalCount': metadata.get('eval_count'),
            'tokenUsage': (getattr(response, 'llm_output', {}) or {}).get('token_usage'),
            'reasoningPresent': bool(metadata.get('reasoning')),
        })

    def on_llm_error(self, error, **kwargs) -> None:
        self.errors.append(type(error).__name__)


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    if OUTPUT_PATH.exists():
        raise RuntimeError(f'refusing to overwrite existing run receipt: {OUTPUT_PATH}')

    freeze_bytes = FREEZE_PATH.read_bytes()
    freeze_sha256 = sha256_bytes(freeze_bytes)
    freeze = json.loads(freeze_bytes.decode('utf-8'))
    bundle_bytes = BUNDLE_PATH.read_bytes()
    chunks_bytes = CHUNKS_PATH.read_bytes()
    bundle = json.loads(bundle_bytes.decode('utf-8'))
    chunks_file = json.loads(chunks_bytes.decode('utf-8'))
    if sha256_bytes(chunks_bytes) != freeze['chunkFileSha256']:
        raise RuntimeError('chunk input file hash differs from frozen protocol')
    if sha256_bytes(bundle_bytes) != freeze['source']['sourceBundleFileSha256']:
        raise RuntimeError('source bundle bytes differ from frozen protocol')
    canonical_bundle_hash = hashlib.sha256(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    if canonical_bundle_hash != freeze['source']['sourceBundleSha256']:
        raise RuntimeError('source bundle canonical hash differs from frozen protocol')
    structured_schema = EvidenceOutput.model_json_schema()
    participants_schema = structured_schema['$defs']['RelationCandidate']['properties']['participants']
    if participants_schema.get('minItems') != 2:
        raise RuntimeError('generated relation schema does not enforce minItems=2')
    schema_hash = sha256_text(json.dumps(structured_schema, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    if schema_hash != freeze['candidateSchemaSha256']:
        raise RuntimeError('generated candidate schema differs from frozen protocol')
    expected_hashes = freeze['hashes']
    for key, path in (
        ('runnerSha256', Path(__file__)),
        ('adapterSha256', REPORT_DIR / 'evidence-adapter-v2.mjs'),
        ('testsSha256', REPORT_DIR / 'evidence-adapter-v2.test.mjs'),
        ('promptSha256', PROMPT_PATH),
        ('schemaSourceSha256', SCHEMA_PATH),
        ('validationRunnerSha256', REPORT_DIR / 'validate-and-build-native-v2.mjs'),
    ):
        if sha256_bytes(path.read_bytes()) != expected_hashes[key]:
            raise RuntimeError(f'frozen run source changed: {path}')

    before_ps = api_json('/api/ps')
    occupied = [item.get('name') for item in before_ps.get('models', []) if item.get('name')]
    unrelated = [name for name in occupied if name != MODEL]
    if unrelated:
        raise RuntimeError(f'refusing to run beside unrelated resident Ollama model(s): {unrelated}')
    tags = api_json('/api/tags')
    tag = next((item for item in tags.get('models', []) if item.get('name') == MODEL), None)
    if not tag or tag.get('digest') != freeze['inference']['modelDigest']:
        raise RuntimeError('Ollama model tag/digest differs from frozen run')
    runtime = api_json('/api/version')
    probe = cold_load_probe() if not occupied else None
    runtime_before = api_json('/api/ps')
    context = next((item.get('context_length') for item in runtime_before.get('models', []) if item.get('name') == MODEL), None)
    if context != freeze['inference']['expectedContextLength']:
        raise RuntimeError(f'Ollama context length {context} differs from frozen {freeze["inference"]["expectedContextLength"]}')

    prompt = PROMPT_PATH.read_text(encoding='utf-8').split('\n', 2)[-1].strip()
    observer = CallObserver()
    request_bodies: list[dict] = []

    def observe_request(request: httpx.Request) -> None:
        try:
            body = json.loads(request.content.decode('utf-8'))
        except Exception:
            body = {}
        response_format = body.get('response_format') or {}
        messages = body.get('messages') if isinstance(body.get('messages'), list) else []
        request_bodies.append({
            'path': request.url.path,
            'model': body.get('model'),
            'maxTokens': body.get('max_tokens'),
            'maxCompletionTokens': body.get('max_completion_tokens'),
            'temperature': body.get('temperature'),
            'reasoningEffort': body.get('reasoning_effort'),
            'responseFormatType': response_format.get('type') if isinstance(response_format, dict) else None,
            'responseFormatName': (response_format.get('json_schema') or {}).get('name') if isinstance(response_format, dict) else None,
            'messageCount': len(messages),
            'messageChars': sum(len(message.get('content') or '') for message in messages if isinstance(message, dict) and isinstance(message.get('content'), str)),
        })

    http_client = httpx.Client(event_hooks={'request': [observe_request]})
    inference = freeze['inference']
    llm = ChatOpenAI(
        model=MODEL,
        base_url=BASE_URL,
        api_key='ollama',
        temperature=0,
        max_tokens=inference['maxOutputTokens'],
        timeout=inference['perCallTimeoutSeconds'],
        max_retries=0,
        reasoning_effort='none',
        extra_body={'max_tokens': inference['requestMaxTokensField']},
        callbacks=[observer],
        http_client=http_client,
    )
    structured_llm = llm.with_structured_output(EvidenceOutput, method='json_schema')

    results = {
        'schema': 'zuri.hyper-relation-evidence-aware-candidates.v2',
        'runId': freeze['runId'],
        'status': 'RUNNING',
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'sourceBundleSha256': freeze['source']['sourceBundleSha256'],
        'chunksFileSha256': freeze['chunkFileSha256'],
        'candidateSchemaSha256': freeze['candidateSchemaSha256'],
        'freezeSha256': freeze_sha256,
        'model': {
            'tag': MODEL,
            'digest': tag['digest'],
            'ollamaVersion': runtime.get('version'),
            'runtimeBeforeProbe': before_ps,
            'coldLoadProbe': probe,
            'runtimeBeforeExtraction': runtime_before,
            'contextLengthObserved': context,
            'requestedReasoningEffort': 'none',
            'reasoningObserved': False,
            'runtimeAfter': None,
        },
        'settings': {
            'structuredOutputMethod': 'json_schema',
            'chunkSizeChars': inference['chunkSizeChars'],
            'chunkOverlapChars': inference['chunkOverlapChars'],
            'maxWorkers': 1,
            'temperature': 0,
            'maxOutputTokens': inference['maxOutputTokens'],
            'requestMaxTokensField': inference['requestMaxTokensField'],
            'maxRetries': 0,
            'perCallTimeoutSeconds': inference['perCallTimeoutSeconds'],
            'plannedChunks': sum(len(doc['chunks']) for doc in chunks_file['documents']),
            'actualStructuredCallStarts': 0,
            'actualStructuredCallResponses': 0,
            'actualStructuredCallErrors': 0,
        },
        'timing': {'extractionWallMs': None, 'perChunk': []},
        'requestBodies': request_bodies,
        'documents': [],
        'error': None,
    }
    for doc in chunks_file['documents']:
        results['documents'].append({
            'sourceId': doc['sourceId'],
            'sourceTextSha256': doc['sourceTextSha256'],
            'chunks': [{
                key: chunk[key] for key in (
                    'chunkIndex', 'sourceStart', 'sourceEnd', 'sourceRelativeStart',
                    'sourceRelativeEnd', 'textChars', 'textSha256', 'inputText',
                )
            } | {'facts': [], 'relations': [], 'structuredResponse': None, 'callError': None} for chunk in doc['chunks']],
        })
    OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    start_run = time.perf_counter()
    completed_chunks = 0
    try:
        for source_doc, result_doc in zip(chunks_file['documents'], results['documents'], strict=True):
            if source_doc['sourceId'] != result_doc['sourceId']:
                raise RuntimeError('run chunk documents changed order')
            for source_chunk, result_chunk in zip(source_doc['chunks'], result_doc['chunks'], strict=True):
                request_start = len(request_bodies)
                response_start = len(observer.responses)
                call_start = observer.starts
                started = time.perf_counter()
                try:
                    parsed = structured_llm.invoke([
                        SystemMessage(content=prompt),
                        HumanMessage(content=source_chunk['inputText']),
                    ])
                    response = parsed.model_dump(mode='json')
                    result_chunk['facts'] = response.get('factCandidates', [])
                    result_chunk['relations'] = response.get('relationCandidates', [])
                    result_chunk['structuredResponse'] = response
                except Exception as error:
                    result_chunk['callError'] = {'type': type(error).__name__, 'message': str(error)[:1200]}
                    raise
                finally:
                    result_chunk['elapsedMs'] = round((time.perf_counter() - started) * 1000, 3)
                    result_chunk['requestBodies'] = request_bodies[request_start:]
                    result_chunk['callResponses'] = observer.responses[response_start:]
                    result_chunk['callStarts'] = observer.starts - call_start
                    completed_chunks += int(result_chunk['structuredResponse'] is not None)
                    results['settings']['actualStructuredCallStarts'] = observer.starts
                    results['settings']['actualStructuredCallResponses'] = len(observer.responses)
                    results['settings']['actualStructuredCallErrors'] = len(observer.errors)
                    results['model']['reasoningObserved'] = any(response.get('reasoningPresent') for response in observer.responses)
                    results['timing']['perChunk'].append({
                        'sourceId': source_doc['sourceId'],
                        'chunkIndex': source_chunk['chunkIndex'],
                        'elapsedMs': result_chunk['elapsedMs'],
                        'factCount': len(result_chunk['facts']),
                        'relationCount': len(result_chunk['relations']),
                        'callStarts': result_chunk['callStarts'],
                        'error': bool(result_chunk['callError']),
                    })
                    OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                actual_requests = result_chunk.get('requestBodies', [])
                if len(actual_requests) != 1 or any(
                    request.get('model') != MODEL
                    or request.get('maxTokens') != inference['requestMaxTokensField']
                    or request.get('maxCompletionTokens') != inference['requestMaxTokensField']
                    or request.get('responseFormatType') != 'json_schema'
                    for request in actual_requests
                ):
                    raise RuntimeError(f'actual request configuration differs from freeze at {source_doc["sourceId"]}/{source_chunk["chunkIndex"]}')
                print(json.dumps({
                    'event': 'chunk_complete',
                    'completed': completed_chunks,
                    'planned': results['settings']['plannedChunks'],
                    'sourceId': source_doc['sourceId'],
                    'chunkIndex': source_chunk['chunkIndex'],
                    'factCount': len(result_chunk['facts']),
                    'relationCount': len(result_chunk['relations']),
                    'elapsedMs': result_chunk['elapsedMs'],
                }, ensure_ascii=False), flush=True)
        if observer.errors:
            raise RuntimeError(f'{len(observer.errors)} structured model call(s) failed')
    except Exception as error:
        results['status'] = 'FAILED'
        results['error'] = {'type': type(error).__name__, 'message': str(error)[:1600]}
        raise
    finally:
        results['timing']['extractionWallMs'] = round((time.perf_counter() - start_run) * 1000, 3)
        results['model']['runtimeAfter'] = api_json('/api/ps')
        results['model']['contextLengthAfterExtraction'] = next((
            item.get('context_length') for item in results['model']['runtimeAfter'].get('models', []) if item.get('name') == MODEL
        ), None)
        results['settings']['actualStructuredCallStarts'] = observer.starts
        results['settings']['actualStructuredCallResponses'] = len(observer.responses)
        results['settings']['actualStructuredCallErrors'] = len(observer.errors)
        results['model']['callResponses'] = observer.responses
        results['model']['callErrors'] = observer.errors
        results['settings']['requestConfigurationsMatchFreeze'] = all(
            request.get('model') == MODEL
            and request.get('maxTokens') == inference['requestMaxTokensField']
            and request.get('maxCompletionTokens') == inference['requestMaxTokensField']
            and request.get('responseFormatType') == 'json_schema'
            for request in request_bodies
        )
        if results['status'] != 'FAILED' and results['model']['contextLengthAfterExtraction'] != inference['expectedContextLength']:
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'Ollama context changed during extraction'}
        if results['status'] != 'FAILED' and (
            observer.starts != results['settings']['plannedChunks']
            or len(observer.responses) != observer.starts
            or len(request_bodies) != observer.starts
            or not results['settings']['requestConfigurationsMatchFreeze']
        ):
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'structured call count/request settings differ from frozen run'}
        if results['status'] != 'FAILED':
            results['finishedAt'] = datetime.now(timezone.utc).isoformat()
            results['status'] = 'COMPLETED'
        OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        http_client.close()

    print(json.dumps({
        'event': 'extraction_complete',
        'status': results['status'],
        'chunks': results['settings']['plannedChunks'],
        'calls': observer.starts,
        'responses': len(observer.responses),
        'facts': sum(len(chunk['facts']) for doc in results['documents'] for chunk in doc['chunks']),
        'relations': sum(len(chunk['relations']) for doc in results['documents'] for chunk in doc['chunks']),
        'elapsedMs': results['timing']['extractionWallMs'],
        'output': str(OUTPUT_PATH),
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
