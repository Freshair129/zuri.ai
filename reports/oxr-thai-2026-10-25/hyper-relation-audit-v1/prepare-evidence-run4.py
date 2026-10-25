"""Freeze one full native-Ollama evidence-aware pass from run2's exact corpus."""
from __future__ import annotations

import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from evidence_schema import EvidenceOutput


ROOT = Path('.local/hyper-relation-audit-20261025/run-4')
PRIOR_RUN = Path('.local/hyper-relation-audit-20261025/run-2')
HARNESS_PARTIAL = Path('.local/hyper-relation-audit-20261025/run-3/evidence-candidates.json')
DIAGNOSTIC = Path('.local/hyper-relation-audit-20261025/chunk5-diagnostic/native-api-receipt.json')
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
    harness_partial_bytes = HARNESS_PARTIAL.read_bytes()
    harness_partial = json.loads(harness_partial_bytes.decode('utf-8'))
    diagnostic_bytes = DIAGNOSTIC.read_bytes()
    diagnostic = json.loads(diagnostic_bytes.decode('utf-8'))
    if (prior_receipt.get('status') != 'FAILED' or harness_partial.get('status') != 'FAILED'
        or diagnostic.get('status') != 'COMPLETED_DIAGNOSTIC_ONLY'):
        raise RuntimeError('run4 preparation requires preserved failed runs and successful chunk diagnostic')
    if (harness_partial.get('settings', {}).get('actualStructuredCallStarts') != 1
        or harness_partial.get('settings', {}).get('actualStructuredCallResponses') != 1):
        raise RuntimeError('run3 partial does not document the single successful request before harness failure')
    if diagnostic.get('model', {}).get('contextAfterRequest') != CONTEXT_LENGTH:
        raise RuntimeError('native API chunk diagnostic did not preserve the 8192 context')
    if diagnostic.get('settings', {}).get('schemaRelationParticipantsMinItems') != 2:
        raise RuntimeError('native API diagnostic schema did not enforce two relation participants')
    if sha256_bytes(prior_chunks_bytes) != prior_freeze['chunkFileSha256']:
        raise RuntimeError('run2 chunk file changed since its freeze')
    if sha256_bytes(prior_bundle_bytes) != prior_freeze['source']['sourceBundleFileSha256']:
        raise RuntimeError('run2 source bundle file changed since its freeze')
    prior_bundle = json.loads(prior_bundle_bytes.decode('utf-8'))
    prior_chunks = json.loads(prior_chunks_bytes.decode('utf-8'))
    canonical_bundle_hash = sha256_text(json.dumps(prior_bundle, ensure_ascii=False, separators=(',', ':')))
    if canonical_bundle_hash != prior_freeze['source']['sourceBundleSha256']:
        raise RuntimeError('run2 source bundle changed since its freeze')
    failed_chunk = next(
        chunk for document in prior_chunks['documents'] if document['sourceId'] == 'economy'
        for chunk in document['chunks'] if chunk['chunkIndex'] == 5
    )
    if (diagnostic.get('source', {}).get('sourceBundleSha256') != prior_freeze['source']['sourceBundleSha256']
        or diagnostic.get('source', {}).get('chunkFileSha256') != prior_freeze['chunkFileSha256']
        or diagnostic.get('source', {}).get('inputTextSha256') != failed_chunk['textSha256']):
        raise RuntimeError('native API diagnostic does not bind the exact failed chunk and frozen source')

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
    if participants_schema.get('minItems') != 2:
        raise RuntimeError('generated schema does not enforce RelationCandidate.participants.minItems=2')
    schema_hash = sha256_text(json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(',', ':')))

    freeze = {
        'schema': 'zuri.hyper-relation-evidence-aware-run-freeze.v3',
        'runId': 'run-4',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'source': {
            'input': 'Exact frozen Paddle OCR text ranges/chunks; no PDF parsing or OCR occurs in this companion pass.',
            'sourceBundleSha256': prior_freeze['source']['sourceBundleSha256'],
            'sourceBundleFileSha256': sha256_bytes(prior_bundle_bytes),
            'priorRun2FreezeSha256': sha256_bytes(prior_freeze_bytes),
            'priorRun2ReceiptSha256': sha256_bytes(prior_receipt_bytes),
            'priorRun2Disposition': 'FAILED_AFTER_5_OF_23_CHUNKS_DUE_TO_2048_COMPLETION_LIMIT',
            'priorRun3ReceiptSha256': sha256_bytes(harness_partial_bytes),
            'priorRun3Disposition': 'HARNESS_FAILED_AFTER_ONE_COMPLETE_CALL_BEFORE_PROGRESS_SUMMARY',
            'nativeApiDiagnosticSha256': sha256_bytes(diagnostic_bytes),
            'nativeApiDiagnosticRunnerSha256': sha256_bytes(Path('.local/hyper-relation-audit-20261025/chunk5-diagnostic/diagnose-native-api.py').read_bytes()),
            'sameExactSourceBundleAndChunksAsRun2': True,
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
        },
        'outputContract': prior_freeze['outputContract'],
        'chunkManifest': prior_freeze['chunkManifest'],
        'hashes': {
            'runnerSha256': sha256_bytes((REPORT_DIR / 'extract-evidence-native-v4.py').read_bytes()),
            'adapterSha256': sha256_bytes((REPORT_DIR / 'evidence-adapter-v2.mjs').read_bytes()),
            'testsSha256': sha256_bytes((REPORT_DIR / 'evidence-adapter-v2.test.mjs').read_bytes()),
            'runnerTestSha256': sha256_bytes((REPORT_DIR / 'test-evidence-runner-v4.py').read_bytes()),
            'promptSha256': sha256_bytes((REPORT_DIR / 'evidence-prompt-v2.md').read_bytes()),
            'schemaSourceSha256': sha256_bytes((REPORT_DIR / 'evidence_schema.py').read_bytes()),
            'validationRunnerSha256': sha256_bytes((REPORT_DIR / 'validate-and-build-native-v4.mjs').read_bytes()),
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
