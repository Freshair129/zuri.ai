"""Run one frozen evidence-aware pass through Ollama's native /api/chat API."""
from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from evidence_schema_budgeted import (
    MAX_FACT_CANDIDATES_PER_CHUNK,
    MAX_RELATION_CANDIDATES_PER_CHUNK,
    EvidenceOutput,
)


RUN_ROOT = Path('.local/hyper-relation-audit-20261025/run-5')
REPORT_DIR = Path('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1')
BUNDLE_PATH = RUN_ROOT / 'source-bundle.json'
CHUNKS_PATH = RUN_ROOT / 'chunks.json'
FREEZE_PATH = RUN_ROOT / 'freeze.json'
OUTPUT_PATH = RUN_ROOT / 'evidence-candidates.json'
PROMPT_PATH = REPORT_DIR / 'evidence-prompt-budgeted.md'
SCHEMA_PATH = REPORT_DIR / 'evidence_schema_budgeted.py'
API_ROOT = 'http://127.0.0.1:11434'


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def canonical_json_hash(value: object) -> str:
    return sha256_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')))


def api_json(path: str, payload: dict | None = None) -> dict:
    if payload is None:
        with urllib.request.urlopen(API_ROOT + path, timeout=5) as response:
            return json.loads(response.read().decode('utf-8'))
    request = urllib.request.Request(
        API_ROOT + path,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode('utf-8'))


def context_of(state: dict, model: str) -> int | None:
    return next((item.get('context_length') for item in state.get('models', []) if item.get('name') == model), None)


def progress_summary(documents: list[dict]) -> dict:
    chunks = [chunk for document in documents for chunk in document.get('chunks', [])]
    responses = [chunk.get('callResponse') for chunk in chunks if chunk.get('callResponse') is not None]
    return {
        'responseCount': len(responses),
        'structuredChunkCount': sum(chunk.get('structuredResponse') is not None for chunk in chunks),
        'thinkingObserved': any(bool((chunk.get('callResponse') or {}).get('thinkingPresent')) for chunk in chunks),
    }


def response_is_complete(response: dict | None) -> bool:
    return response is not None and response.get('done') is True and response.get('done_reason') == 'stop'


def main() -> None:
    if OUTPUT_PATH.exists():
        raise RuntimeError(f'refusing to overwrite existing evidence receipt: {OUTPUT_PATH}')

    freeze_bytes = FREEZE_PATH.read_bytes()
    freeze_sha256 = sha256_bytes(freeze_bytes)
    freeze = json.loads(freeze_bytes.decode('utf-8'))
    inference = freeze['inference']
    model = inference['modelTag']
    bundle_bytes = BUNDLE_PATH.read_bytes()
    chunk_bytes = CHUNKS_PATH.read_bytes()
    bundle = json.loads(bundle_bytes.decode('utf-8'))
    chunks_file = json.loads(chunk_bytes.decode('utf-8'))
    if sha256_bytes(chunk_bytes) != freeze['chunkFileSha256']:
        raise RuntimeError('chunk input file differs from frozen protocol')
    if sha256_bytes(bundle_bytes) != freeze['source']['sourceBundleFileSha256']:
        raise RuntimeError('source bundle bytes differ from frozen protocol')
    if sha256_text(json.dumps(bundle, ensure_ascii=False, separators=(',', ':'))) != freeze['source']['sourceBundleSha256']:
        raise RuntimeError('source bundle object differs from frozen protocol')

    schema = EvidenceOutput.model_json_schema()
    participants_schema = schema['$defs']['RelationCandidate']['properties']['participants']
    fact_candidates_schema = schema['properties']['factCandidates']
    relation_candidates_schema = schema['properties']['relationCandidates']
    if (participants_schema.get('minItems') != 2
        or fact_candidates_schema.get('maxItems') != MAX_FACT_CANDIDATES_PER_CHUNK
        or relation_candidates_schema.get('maxItems') != MAX_RELATION_CANDIDATES_PER_CHUNK):
        raise RuntimeError('generated JSON Schema lacks the frozen cardinality/output budget')
    schema_hash = canonical_json_hash(schema)
    if schema_hash != freeze['candidateSchemaSha256']:
        raise RuntimeError('generated JSON Schema differs from frozen protocol')
    fact_fields = schema['$defs']['FactCandidate']['properties']
    relation_fields = schema['$defs']['RelationCandidate']['properties']
    candidate_limits = {
        'factCandidatesPerChunk': fact_candidates_schema['maxItems'],
        'relationCandidatesPerChunk': relation_candidates_schema['maxItems'],
        'predicateChars': fact_fields['predicate']['maxLength'],
        'descriptionChars': fact_fields['description']['maxLength'],
        'evidenceQuoteChars': fact_fields['evidenceQuote']['maxLength'],
        'predicateCueChars': fact_fields['predicateCue']['maxLength'],
        'rowQuoteChars': fact_fields['rowQuote']['maxLength'],
        'headerQuoteChars': fact_fields['headerQuote']['maxLength'],
        'relationPredicateChars': relation_fields['predicate']['maxLength'],
        'relationDescriptionChars': relation_fields['description']['maxLength'],
        'relationEvidenceQuoteChars': relation_fields['evidenceQuote']['maxLength'],
        'relationCueChars': relation_fields['relationCue']['maxLength'],
    }
    if candidate_limits != inference['candidateLimits']:
        raise RuntimeError('generated candidate schema limits differ from frozen protocol')

    source_paths = (
        ('runnerSha256', Path(__file__)),
        ('adapterSha256', REPORT_DIR / 'evidence-adapter-v2.mjs'),
        ('testsSha256', REPORT_DIR / 'evidence-adapter-v2.test.mjs'),
        ('runnerTestSha256', REPORT_DIR / 'test-evidence-runner-v5.py'),
        ('promptSha256', PROMPT_PATH),
        ('schemaSourceSha256', SCHEMA_PATH),
        ('validationRunnerSha256', REPORT_DIR / 'validate-and-build-native-v5.mjs'),
        ('preparationRunnerSha256', REPORT_DIR / 'prepare-evidence-run5.py'),
    )
    for key, path in source_paths:
        if sha256_bytes(path.read_bytes()) != freeze['hashes'][key]:
            raise RuntimeError(f'frozen run source changed: {path}')

    before_ps = api_json('/api/ps')
    occupied = [item.get('name') for item in before_ps.get('models', []) if item.get('name')]
    unrelated = [name for name in occupied if name != model]
    if unrelated:
        raise RuntimeError(f'refusing to run beside unrelated resident Ollama model(s): {unrelated}')
    tags = api_json('/api/tags')
    tag = next((item for item in tags.get('models', []) if item.get('name') == model), None)
    if not tag or tag.get('digest') != inference['modelDigest']:
        raise RuntimeError('Ollama model tag/digest differs from frozen run')
    runtime = api_json('/api/version')

    load_probe = None
    context_before = context_of(before_ps, model)
    if context_before != inference['expectedContextLength']:
        probe_started = time.perf_counter()
        probe = api_json('/api/chat', {
            'model': model,
            'messages': [{'role': 'user', 'content': 'Reply with OK.'}],
            'stream': False,
            'think': False,
            'options': {'num_ctx': inference['numCtx'], 'num_predict': 1, 'temperature': inference['temperature']},
        })
        load_probe = {
            'endpoint': '/api/chat',
            'think': False,
            'options': {'num_ctx': inference['numCtx'], 'num_predict': 1, 'temperature': inference['temperature']},
            'elapsedMs': round((time.perf_counter() - probe_started) * 1000, 3),
            'loadDurationNs': probe.get('load_duration'),
        }
    runtime_before_extraction = api_json('/api/ps')
    context_observed = context_of(runtime_before_extraction, model)
    if context_observed != inference['expectedContextLength']:
        raise RuntimeError(f'actual Ollama context {context_observed} differs from frozen context')
    if '--preflight' in sys.argv:
        print(json.dumps({
            'status': 'PREFLIGHT_PASS_NO_INFERENCE',
            'runId': freeze['runId'],
            'freezeSha256': freeze_sha256,
            'sourceBundleSha256': freeze['source']['sourceBundleSha256'],
            'chunkFileSha256': freeze['chunkFileSha256'],
            'plannedChunks': sum(len(doc['chunks']) for doc in chunks_file['documents']),
            'candidateSchemaSha256': schema_hash,
            'relationParticipantsMinItems': participants_schema['minItems'],
            'modelTag': model,
            'modelDigest': tag['digest'],
            'contextLengthObserved': context_observed,
            'endpoint': inference['endpoint'],
        }, ensure_ascii=False), flush=True)
        return

    prompt = PROMPT_PATH.read_text(encoding='utf-8').split('\n', 2)[-1].strip()
    documents = []
    for document in chunks_file['documents']:
        documents.append({
            'sourceId': document['sourceId'],
            'sourceTextSha256': document['sourceTextSha256'],
            'chunks': [{
                key: chunk[key] for key in (
                    'chunkIndex', 'sourceStart', 'sourceEnd', 'sourceRelativeStart',
                    'sourceRelativeEnd', 'textChars', 'textSha256', 'inputText',
                )
            } | {
                'facts': [], 'relations': [], 'structuredResponse': None,
                'callError': None, 'callResponse': None, 'request': None,
            } for chunk in document['chunks']],
        })
    planned_calls = sum(len(document['chunks']) for document in chunks_file['documents'])
    request_bodies: list[dict] = []
    call_starts = call_responses = call_errors = completed_chunks = 0
    started_run = time.perf_counter()
    results = {
        'schema': 'zuri.hyper-relation-evidence-aware-candidates.v3',
        'runId': freeze['runId'],
        'status': 'RUNNING',
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'sourceBundleSha256': freeze['source']['sourceBundleSha256'],
        'chunksFileSha256': freeze['chunkFileSha256'],
        'candidateSchemaSha256': schema_hash,
        'freezeSha256': freeze_sha256,
        'model': {
            'tag': model,
            'digest': tag['digest'],
            'ollamaVersion': runtime.get('version'),
            'runtimeBeforeRun': before_ps,
            'loadProbe': load_probe,
            'runtimeBeforeExtraction': runtime_before_extraction,
            'contextLengthObserved': context_observed,
            'contextLengthAfterExtraction': None,
            'thinkingRequested': inference['thinkingRequest'],
            'thinkingObserved': None,
        },
        'settings': {
            'endpoint': inference['endpoint'],
            'structuredOutputMethod': inference['structuredOutputMethod'],
            'chunkSizeChars': inference['chunkSizeChars'],
            'chunkOverlapChars': inference['chunkOverlapChars'],
            'maxWorkers': inference['maxWorkers'],
            'temperature': inference['temperature'],
            'maxOutputTokens': inference['maxOutputTokens'],
            'numPredict': inference['numPredict'],
            'numCtx': inference['numCtx'],
            'maxRetries': inference['maxRetries'],
            'perCallTimeoutSeconds': inference['perCallTimeoutSeconds'],
            'plannedChunks': planned_calls,
            'actualStructuredCallStarts': 0,
            'actualStructuredCallResponses': 0,
            'actualStructuredCallErrors': 0,
            'requestConfigurationsMatchFreeze': False,
            'outgoingRequestSchemaSha256': schema_hash,
            'outgoingRelationParticipantsMinItems': participants_schema['minItems'],
            'outgoingFactCandidatesMaxItems': fact_candidates_schema['maxItems'],
            'outgoingRelationCandidatesMaxItems': relation_candidates_schema['maxItems'],
            'candidateLimits': candidate_limits,
            'outgoingRequestSchemaStableAcrossCalls': True,
        },
        'timing': {'extractionWallMs': None, 'perChunk': []},
        'requestBodies': request_bodies,
        'documents': documents,
        'error': None,
    }
    OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    try:
        for source_doc, result_doc in zip(chunks_file['documents'], documents, strict=True):
            if source_doc['sourceId'] != result_doc['sourceId']:
                raise RuntimeError('source chunk document order differs from frozen input')
            for source_chunk, result_chunk in zip(source_doc['chunks'], result_doc['chunks'], strict=True):
                call_starts += 1
                started = time.perf_counter()
                payload = {
                    'model': model,
                    'messages': [
                        {'role': 'system', 'content': prompt},
                        {'role': 'user', 'content': source_chunk['inputText']},
                    ],
                    'format': schema,
                    'stream': False,
                    'think': inference['thinkingRequest'],
                    'options': {
                        'num_ctx': inference['numCtx'],
                        'num_predict': inference['numPredict'],
                        'temperature': inference['temperature'],
                    },
                }
                request = {
                    'endpoint': '/api/chat',
                    'model': model,
                    'format': 'json_schema',
                    'requestSchemaSha256': canonical_json_hash(schema),
                    'relationParticipantsMinItems': participants_schema['minItems'],
                    'factCandidatesMaxItems': fact_candidates_schema['maxItems'],
                    'relationCandidatesMaxItems': relation_candidates_schema['maxItems'],
                    'candidateLimits': candidate_limits,
                    'numCtx': inference['numCtx'],
                    'numPredict': inference['numPredict'],
                    'temperature': inference['temperature'],
                    'think': inference['thinkingRequest'],
                    'stream': False,
                    'messageCount': len(payload['messages']),
                    'messageChars': sum(len(message['content']) for message in payload['messages']),
                }
                request['requestBodySha256'] = sha256_bytes(
                    json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
                )
                request_bodies.append(request)
                result_chunk['request'] = request
                try:
                    response = api_json('/api/chat', payload)
                    call_responses += 1
                    response_summary = {
                        key: response.get(key) for key in (
                            'done', 'done_reason', 'total_duration', 'load_duration',
                            'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration',
                        )
                    } | {'thinkingPresent': bool(response.get('message', {}).get('thinking'))}
                    result_chunk['callResponse'] = response_summary
                    if not response_is_complete(response):
                        raise RuntimeError(
                            'Ollama returned an incomplete structured response '
                            f'(done={response.get("done")}, done_reason={response.get("done_reason")}, '
                            f'eval_count={response.get("eval_count")})'
                        )
                    content = response.get('message', {}).get('content')
                    parsed = EvidenceOutput.model_validate_json(content)
                    structured = parsed.model_dump(mode='json')
                    result_chunk['structuredResponse'] = structured
                    result_chunk['facts'] = structured.get('factCandidates', [])
                    result_chunk['relations'] = structured.get('relationCandidates', [])
                    completed_chunks += 1
                    observed = api_json('/api/ps')
                    context_after_call = context_of(observed, model)
                    if context_after_call != inference['expectedContextLength']:
                        raise RuntimeError(f'Ollama context changed during call to {context_after_call}')
                except Exception as error:
                    call_errors += 1
                    result_chunk['callError'] = {'type': type(error).__name__, 'message': str(error)[:1600]}
                finally:
                    elapsed = round((time.perf_counter() - started) * 1000, 3)
                    result_chunk['elapsedMs'] = elapsed
                    results['settings']['actualStructuredCallStarts'] = call_starts
                    results['settings']['actualStructuredCallResponses'] = call_responses
                    results['settings']['actualStructuredCallErrors'] = call_errors
                    results['model']['thinkingObserved'] = progress_summary(documents)['thinkingObserved']
                    results['timing']['perChunk'].append({
                        'sourceId': source_doc['sourceId'],
                        'chunkIndex': source_chunk['chunkIndex'],
                        'elapsedMs': elapsed,
                        'factCount': len(result_chunk['facts']),
                        'relationCount': len(result_chunk['relations']),
                        'requestStarts': 1,
                        'responseReceived': result_chunk['callResponse'] is not None,
                        'error': bool(result_chunk['callError']),
                    })
                    OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                print(json.dumps({
                    'event': 'chunk_complete',
                    'completed': completed_chunks,
                    'planned': planned_calls,
                    'sourceId': source_doc['sourceId'],
                    'chunkIndex': source_chunk['chunkIndex'],
                    'factCount': len(result_chunk['facts']),
                    'relationCount': len(result_chunk['relations']),
                    'error': bool(result_chunk['callError']),
                    'elapsedMs': result_chunk['elapsedMs'],
                }, ensure_ascii=False), flush=True)
        results['settings']['requestConfigurationsMatchFreeze'] = all(
            request.get('endpoint') == inference['endpoint']
            and request.get('model') == model
            and request.get('requestSchemaSha256') == freeze['candidateSchemaSha256']
            and request.get('relationParticipantsMinItems') == 2
            and request.get('factCandidatesMaxItems') == inference['candidateLimits']['factCandidatesPerChunk']
            and request.get('relationCandidatesMaxItems') == inference['candidateLimits']['relationCandidatesPerChunk']
            and request.get('candidateLimits') == inference['candidateLimits']
            and request.get('numCtx') == inference['numCtx']
            and request.get('numPredict') == inference['numPredict']
            and request.get('temperature') == inference['temperature']
            and request.get('think') is inference['thinkingRequest']
            and request.get('stream') is False
            for request in request_bodies
        )
        if len(request_bodies) != planned_calls or not results['settings']['requestConfigurationsMatchFreeze']:
            raise RuntimeError('actual request configuration/call count differs from frozen protocol')
    except Exception as error:
        results['status'] = 'FAILED'
        results['error'] = {'type': type(error).__name__, 'message': str(error)[:2000]}
    finally:
        results['timing']['extractionWallMs'] = round((time.perf_counter() - started_run) * 1000, 3)
        results['model']['runtimeAfter'] = api_json('/api/ps')
        results['model']['contextLengthAfterExtraction'] = context_of(results['model']['runtimeAfter'], model)
        if results['status'] != 'FAILED' and results['model']['contextLengthAfterExtraction'] != inference['expectedContextLength']:
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'final Ollama context differs from frozen protocol'}
        if results['status'] != 'FAILED' and (
            call_starts != planned_calls or len(request_bodies) != planned_calls
            or not results['settings']['requestConfigurationsMatchFreeze']
        ):
            results['status'] = 'FAILED'
            results['error'] = {'type': 'RuntimeError', 'message': 'request count/settings differ from frozen protocol'}
        if results['status'] != 'FAILED':
            results['finishedAt'] = datetime.now(timezone.utc).isoformat()
            results['status'] = (
                'COMPLETED_WITH_ERRORS'
                if call_errors != 0 or call_responses != planned_calls or completed_chunks != planned_calls
                else 'COMPLETED'
            )
        OUTPUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    print(json.dumps({
        'event': 'extraction_complete',
        'status': results['status'],
        'chunks': results['settings']['plannedChunks'],
        'calls': call_starts,
        'responses': call_responses,
        'errors': call_errors,
        'facts': sum(len(chunk['facts']) for doc in documents for chunk in doc['chunks']),
        'relations': sum(len(chunk['relations']) for doc in documents for chunk in doc['chunks']),
        'elapsedMs': results['timing']['extractionWallMs'],
        'output': str(OUTPUT_PATH),
    }, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
