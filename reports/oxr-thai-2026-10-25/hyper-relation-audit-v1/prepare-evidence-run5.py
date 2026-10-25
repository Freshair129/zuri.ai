"""Freeze one budgeted native-Ollama evidence pass from run4's exact corpus."""
from __future__ import annotations

import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from evidence_schema_budgeted import (
    MAX_FACT_CANDIDATES_PER_CHUNK,
    MAX_RELATION_CANDIDATES_PER_CHUNK,
    EvidenceOutput,
)


ROOT = Path('.local/hyper-relation-audit-20261025/run-5')
PRIOR_RUN = Path('.local/hyper-relation-audit-20261025/run-4')
DIAGNOSTIC = Path('.local/hyper-relation-audit-20261025/population-chunk2-budget/receipt.json')
REPORT_DIR = Path('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1')
MODEL = 'qwen3.5:9b'
MODEL_DIGEST = 'bb0c43f2ae93339a21a67576441645ad0fd5696a259c250bfe4af7462c528cb2'
CONTEXT_LENGTH = 8192
OUTPUT_CAP = 4096


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def api_json(path: str) -> dict:
    with urllib.request.urlopen(f'http://127.0.0.1:11434{path}', timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    bundle_path = ROOT / 'source-bundle.json'
    chunks_path = ROOT / 'chunks.json'
    freeze_path = ROOT / 'freeze.json'
    for path in (bundle_path, chunks_path, freeze_path):
        if path.exists():
            raise RuntimeError(f'refusing to overwrite frozen run file: {path}')

    prior_freeze_bytes = (PRIOR_RUN / 'freeze.json').read_bytes()
    prior_freeze = json.loads(prior_freeze_bytes.decode('utf-8'))
    prior_bundle_bytes = (PRIOR_RUN / 'source-bundle.json').read_bytes()
    prior_chunks_bytes = (PRIOR_RUN / 'chunks.json').read_bytes()
    prior_receipt_bytes = (PRIOR_RUN / 'evidence-candidates.json').read_bytes()
    prior_receipt = json.loads(prior_receipt_bytes.decode('utf-8'))
    diagnostic_bytes = DIAGNOSTIC.read_bytes()
    diagnostic = json.loads(diagnostic_bytes.decode('utf-8'))
    if prior_receipt.get('status') != 'FAILED' or diagnostic.get('status') != 'COMPLETED_DIAGNOSTIC_ONLY':
        raise RuntimeError('run5 preparation requires preserved run4 failure and successful budget diagnostic')
    if prior_receipt.get('error', {}).get('message', '').find('done_reason=length') < 0:
        raise RuntimeError('run4 receipt does not document the observed output cap failure')
    if diagnostic.get('model', {}).get('contextAfterRequest') != CONTEXT_LENGTH:
        raise RuntimeError('budget diagnostic did not preserve the 8192 context')
    if diagnostic.get('settings', {}).get('schemaRelationParticipantsMinItems') != 2:
        raise RuntimeError('budget diagnostic schema did not enforce two relation participants')
    if (diagnostic.get('settings', {}).get('schemaFactCandidatesMaxItems') != MAX_FACT_CANDIDATES_PER_CHUNK
        or diagnostic.get('settings', {}).get('schemaRelationCandidatesMaxItems') != MAX_RELATION_CANDIDATES_PER_CHUNK):
        raise RuntimeError('budget diagnostic schema does not match the frozen candidate limits')
    if sha256_bytes(prior_chunks_bytes) != prior_freeze['chunkFileSha256']:
        raise RuntimeError('run4 chunk file changed since its freeze')
    if sha256_bytes(prior_bundle_bytes) != prior_freeze['source']['sourceBundleFileSha256']:
        raise RuntimeError('run4 source bundle file changed since its freeze')
    prior_bundle = json.loads(prior_bundle_bytes.decode('utf-8'))
    prior_chunks = json.loads(prior_chunks_bytes.decode('utf-8'))
    canonical_bundle_hash = sha256_text(json.dumps(prior_bundle, ensure_ascii=False, separators=(',', ':')))
    if canonical_bundle_hash != prior_freeze['source']['sourceBundleSha256']:
        raise RuntimeError('run4 source bundle changed since its freeze')
    failed_chunk = next(
        chunk for document in prior_chunks['documents'] if document['sourceId'] == 'population'
        for chunk in document['chunks'] if chunk['chunkIndex'] == 2
    )
    if (diagnostic.get('source', {}).get('sourceBundleSha256') != prior_freeze['source']['sourceBundleSha256']
        or diagnostic.get('source', {}).get('chunkFileSha256') != prior_freeze['chunkFileSha256']
        or diagnostic.get('source', {}).get('inputTextSha256') != failed_chunk['textSha256']):
        raise RuntimeError('budget diagnostic does not bind the exact failed chunk and frozen source')

    tags = api_json('/api/tags')
    model_tag = next((item for item in tags.get('models', []) if item.get('name') == MODEL), None)
    if not model_tag or model_tag.get('digest') != MODEL_DIGEST:
        raise RuntimeError('installed model tag/digest differs from frozen evidence pass')
    runtime = api_json('/api/version')
    runtime_ps = api_json('/api/ps')
    resident = [item.get('name') for item in runtime_ps.get('models', []) if item.get('name')]
    unrelated = [name for name in resident if name != MODEL]
    if unrelated:
        raise RuntimeError(f'refusing to freeze beside unrelated resident model(s): {unrelated}')
    context = next((item.get('context_length') for item in runtime_ps.get('models', []) if item.get('name') == MODEL), None)
    if context != CONTEXT_LENGTH:
        raise RuntimeError(f'current qwen context is {context}, expected diagnostic context {CONTEXT_LENGTH}')

    schema = EvidenceOutput.model_json_schema()
    participants_schema = schema['$defs']['RelationCandidate']['properties']['participants']
    fact_candidates_schema = schema['properties']['factCandidates']
    relation_candidates_schema = schema['properties']['relationCandidates']
    if (participants_schema.get('minItems') != 2
        or fact_candidates_schema.get('maxItems') != MAX_FACT_CANDIDATES_PER_CHUNK
        or relation_candidates_schema.get('maxItems') != MAX_RELATION_CANDIDATES_PER_CHUNK):
        raise RuntimeError('generated schema does not enforce frozen candidate cardinality/budget limits')
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
    schema_hash = sha256_text(json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(',', ':')))

    freeze = {
        'schema': 'zuri.hyper-relation-evidence-aware-run-freeze.v3',
        'runId': 'run-5',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'source': {
            'input': 'Exact frozen Paddle OCR text ranges/chunks; no PDF parsing or OCR occurs in this companion pass.',
            'sourceBundleSha256': prior_freeze['source']['sourceBundleSha256'],
            'sourceBundleFileSha256': sha256_bytes(prior_bundle_bytes),
            'priorRun4FreezeSha256': sha256_bytes(prior_freeze_bytes),
            'priorRun4ReceiptSha256': sha256_bytes(prior_receipt_bytes),
            'priorRun4Disposition': 'FAILED_AFTER_12_COMPLETED_OF_23_DUE_TO_4096_OUTPUT_LIMIT;_10_NOT_RUN',
            'budgetDiagnosticSha256': sha256_bytes(diagnostic_bytes),
            'budgetDiagnosticRunnerSha256': sha256_bytes(Path('.local/hyper-relation-audit-20261025/population-chunk2-budget/diagnose.py').read_bytes()),
            'sameExactSourceBundleAndChunksAsRun4': True,
            'priorHyperCandidateOutputsPassedToModel': False,
            'goldOrQuestionsPassedToModel': False,
        },
        'inference': {
            'provider': 'local Ollama native /api/chat endpoint',
            'endpoint': '/api/chat',
            'modelTag': MODEL,
            'modelDigest': model_tag['digest'],
            'ollamaVersion': runtime.get('version'),
            'expectedContextLength': CONTEXT_LENGTH,
            'chunkSizeChars': prior_freeze['inference']['chunkSizeChars'],
            'chunkOverlapChars': prior_freeze['inference']['chunkOverlapChars'],
            'maxWorkers': 1,
            'temperature': prior_freeze['inference']['temperature'],
            'maxOutputTokens': OUTPUT_CAP,
            'numPredict': OUTPUT_CAP,
            'numCtx': CONTEXT_LENGTH,
            'structuredOutputMethod': 'native JSON Schema format',
            'thinkingRequest': False,
            'perCallTimeoutSeconds': prior_freeze['inference']['perCallTimeoutSeconds'],
            'maxRetries': 0,
            'modelObservedContextAtFreeze': context,
            'candidateLimits': candidate_limits,
        },
        'outputContract': {
            **prior_freeze['outputContract'],
            'boundedCandidateBudget': 'At most eight fact and four relation candidates per chunk in source order; this is non-exhaustive and does not establish candidate recall.',
        },
        'chunkManifest': prior_freeze['chunkManifest'],
        'hashes': {
            'runnerSha256': sha256_bytes((REPORT_DIR / 'extract-evidence-native-v5.py').read_bytes()),
            'adapterSha256': sha256_bytes((REPORT_DIR / 'evidence-adapter-v2.mjs').read_bytes()),
            'testsSha256': sha256_bytes((REPORT_DIR / 'evidence-adapter-v2.test.mjs').read_bytes()),
            'runnerTestSha256': sha256_bytes((REPORT_DIR / 'test-evidence-runner-v5.py').read_bytes()),
            'promptSha256': sha256_bytes((REPORT_DIR / 'evidence-prompt-budgeted.md').read_bytes()),
            'schemaSourceSha256': sha256_bytes((REPORT_DIR / 'evidence_schema_budgeted.py').read_bytes()),
            'validationRunnerSha256': sha256_bytes((REPORT_DIR / 'validate-and-build-native-v5.mjs').read_bytes()),
            'preparationRunnerSha256': sha256_bytes(Path(__file__).read_bytes()),
        },
        'candidateSchemaSha256': schema_hash,
        'chunkFileSha256': sha256_bytes(prior_chunks_bytes),
    }
    bundle_path.write_bytes(prior_bundle_bytes)
    chunks_path.write_bytes(prior_chunks_bytes)
    freeze_bytes = (json.dumps(freeze, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    freeze_path.write_bytes(freeze_bytes)
    print(json.dumps({
        'runDir': str(ROOT),
        'runId': freeze['runId'],
        'freezeSha256': sha256_bytes(freeze_bytes),
        'sourceBundleSha256': freeze['source']['sourceBundleSha256'],
        'chunkFileSha256': freeze['chunkFileSha256'],
        'chunks': sum(len(doc['chunks']) for doc in prior_chunks['documents']),
        'context': CONTEXT_LENGTH,
        'outputTokens': OUTPUT_CAP,
        'modelTag': MODEL,
        'modelDigest': model_tag['digest'],
        'ollamaVersion': runtime.get('version'),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
