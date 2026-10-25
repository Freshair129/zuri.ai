"""Freeze the evidence-aware companion run over the already frozen Paddle OCR text."""
from __future__ import annotations

import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from evidence_schema import EvidenceOutput


ROOT = Path('.local/hyper-relation-audit-20261025/run-2')
OLD_RUN = Path('.local/hyper-extract-20261025/run-3')
REPORT_DIR = Path('reports/oxr-thai-2026-10-25/hyper-relation-audit-v1')
BUNDLE_SOURCE = OLD_RUN / 'source-bundle.json'
OLD_FREEZE_PATH = OLD_RUN / 'freeze.json'
OLD_CANDIDATES_PATH = OLD_RUN / 'candidates.json'
RUNNER_PATH = REPORT_DIR / 'extract-evidence-v2.py'
ADAPTER_PATH = REPORT_DIR / 'evidence-adapter-v2.mjs'
TEST_PATH = REPORT_DIR / 'evidence-adapter-v2.test.mjs'
PROMPT_PATH = REPORT_DIR / 'evidence-prompt-v2.md'
SCHEMA_PATH = REPORT_DIR / 'evidence_schema.py'
VALIDATOR_PATH = REPORT_DIR / 'validate-and-build-native-v2.mjs'
MODEL = 'qwen3.5:9b'
MODEL_DIGEST = 'bb0c43f2ae93339a21a67576441645ad0fd5696a259c250bfe4af7462c528cb2'
CHUNK_SIZE = 2048
CHUNK_OVERLAP = 256
OUTPUT_CAP = 2048
CONTEXT_LENGTH = 4096


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def canonical_bundle_hash(bundle: dict) -> str:
    return sha256_text(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')))


def ollama_json(path: str) -> dict:
    with urllib.request.urlopen(f'http://127.0.0.1:11434{path}', timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    bundle_path = ROOT / 'source-bundle.json'
    chunks_path = ROOT / 'chunks.json'
    freeze_path = ROOT / 'freeze.json'
    for path in (bundle_path, chunks_path, freeze_path):
        if path.exists():
            raise RuntimeError(f'refusing to overwrite existing frozen run file: {path}')

    old_bundle_bytes = BUNDLE_SOURCE.read_bytes()
    bundle = json.loads(old_bundle_bytes.decode('utf-8'))
    old_freeze = json.loads(OLD_FREEZE_PATH.read_text(encoding='utf-8'))
    old_candidates = json.loads(OLD_CANDIDATES_PATH.read_text(encoding='utf-8'))
    if canonical_bundle_hash(bundle) != old_freeze['sourceBundleSha256']:
        raise RuntimeError('run3 source bundle no longer matches its immutable freeze')
    if old_candidates.get('sourceBundleSha256') != old_freeze['sourceBundleSha256']:
        raise RuntimeError('run3 candidate receipt is not bound to the frozen source bundle')

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ', ''],
        add_start_index=True,
    )
    documents = []
    for source in bundle['sourceRanges']:
        reference = next((doc for doc in old_candidates['documents'] if doc['sourceId'] == source['id']), None)
        if reference is None:
            raise RuntimeError(f'run3 receipt is missing source range {source["id"]}')
        chunks = []
        for index, split_doc in enumerate(splitter.split_documents([Document(page_content=source['text'])])):
            start = split_doc.metadata.get('start_index')
            text = split_doc.page_content
            if not isinstance(start, int) or start < 0 or source['text'][start:start + len(text)] != text:
                raise RuntimeError(f'new chunk offset does not map to frozen source: {source["id"]}/{index}')
            old_chunk = reference['chunks'][index] if index < len(reference['chunks']) else None
            absolute_start = source['sourceStart'] + start
            absolute_end = absolute_start + len(text)
            text_hash = sha256_text(text)
            if not old_chunk or old_chunk['sourceStart'] != absolute_start or old_chunk['sourceEnd'] != absolute_end:
                raise RuntimeError(f'chunk boundary differs from run3: {source["id"]}/{index}')
            if old_chunk['textSha256'] != text_hash or old_chunk['inputText'] != text:
                raise RuntimeError(f'chunk text differs from run3: {source["id"]}/{index}')
            chunks.append({
                'chunkIndex': index,
                'sourceStart': absolute_start,
                'sourceEnd': absolute_end,
                'sourceRelativeStart': start,
                'sourceRelativeEnd': start + len(text),
                'textChars': len(text),
                'textSha256': text_hash,
                'inputText': text,
            })
        if len(chunks) != len(reference['chunks']):
            raise RuntimeError(f'chunk count differs from run3: {source["id"]}')
        documents.append({
            'sourceId': source['id'],
            'sourceTextSha256': source['textSha256'],
            'chunks': chunks,
        })

    tags = ollama_json('/api/tags')
    model_tag = next((item for item in tags.get('models', []) if item.get('name') == MODEL), None)
    if not model_tag or model_tag.get('digest') != MODEL_DIGEST:
        raise RuntimeError('installed Ollama model tag/digest differs from the prior frozen run')
    runtime = ollama_json('/api/version')
    structured_schema = EvidenceOutput.model_json_schema()
    participants_schema = structured_schema['$defs']['RelationCandidate']['properties']['participants']
    if participants_schema.get('minItems') != 2:
        raise RuntimeError('generated relation schema does not enforce minItems=2')
    structured_schema_hash = sha256_text(json.dumps(structured_schema, ensure_ascii=False, sort_keys=True, separators=(',', ':')))

    freeze = {
        'schema': 'zuri.hyper-relation-evidence-aware-run-freeze.v2',
        'runId': 'run-2',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'source': {
            'input': 'The two exact source ranges from frozen table-preserving Paddle OCR text; no PDF parsing or OCR occurs in this follow-up.',
            'sourceBundleSha256': old_freeze['sourceBundleSha256'],
            'sourceBundleFileSha256': sha256_bytes(old_bundle_bytes),
            'sourceBundleComparedWithRun3Freeze': True,
            'chunkingComparedWithRun3Receipt': True,
            'priorHyperCandidateOutputsPassedToModel': False,
            'goldOrQuestionsPassedToModel': False,
        },
        'upstreamReference': {
            'distribution': old_freeze['package'],
            'run3FreezeSha256': sha256_bytes(OLD_FREEZE_PATH.read_bytes()),
            'run3CandidatesSha256': sha256_bytes(OLD_CANDIDATES_PATH.read_bytes()),
            'purpose': 'Reference only; this new evidence-aware schema does not modify or claim to be the upstream Hyper_RAG EdgeSchema.',
        },
        'inference': {
            'provider': 'local Ollama OpenAI-compatible chat endpoint',
            'modelTag': MODEL,
            'modelDigest': model_tag['digest'],
            'ollamaVersion': runtime.get('version'),
            'expectedContextLength': CONTEXT_LENGTH,
            'chunkSizeChars': CHUNK_SIZE,
            'chunkOverlapChars': CHUNK_OVERLAP,
            'maxWorkers': 1,
            'temperature': 0,
            'maxOutputTokens': OUTPUT_CAP,
            'requestMaxTokensField': OUTPUT_CAP,
            'structuredOutputMethod': 'json_schema',
            'reasoningEffortRequest': 'none',
            'perCallTimeoutSeconds': 120,
            'maxRetries': 0,
            'modelWillBeLoadedByNoCorpusProbeIfAbsent': True,
        },
        'outputContract': {
            'facts': 'Separate fact candidates. Prose needs a verbatim quote containing subject, value, and predicate cue. Table facts require exact row/header/value and packet column binding; unary table facts stay facts.',
            'relations': 'At least two distinct participants and a verbatim prose quote containing all participants and an explicit relation cue.',
            'candidateDescription': 'Paraphrase only; never used as evidence or projected into native TEXT.',
            'semanticStatus': 'NOT_ASSESSED even when exact lexical evidence is bound.',
            'nativeBoundary': 'Candidate graph stays a sidecar; only verified original source zone text may be projected into the native TEXT lane.',
        },
        'chunkManifest': [
            {
                'sourceId': document['sourceId'],
                'sourceTextSha256': document['sourceTextSha256'],
                'chunks': [
                    {key: chunk[key] for key in ('chunkIndex', 'sourceStart', 'sourceEnd', 'textChars', 'textSha256')}
                    for chunk in document['chunks']
                ],
            }
            for document in documents
        ],
        'hashes': {
            'runnerSha256': sha256_bytes(RUNNER_PATH.read_bytes()),
            'adapterSha256': sha256_bytes(ADAPTER_PATH.read_bytes()),
            'testsSha256': sha256_bytes(TEST_PATH.read_bytes()),
            'promptSha256': sha256_bytes(PROMPT_PATH.read_bytes()),
            'schemaSourceSha256': sha256_bytes(SCHEMA_PATH.read_bytes()),
            'validationRunnerSha256': sha256_bytes(VALIDATOR_PATH.read_bytes()),
        },
        'candidateSchemaSha256': structured_schema_hash,
    }
    chunks_value = {'schema': 'zuri.hyper-relation-evidence-chunks.v1', 'documents': documents}
    chunks_bytes = (json.dumps(chunks_value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    freeze['chunkFileSha256'] = sha256_bytes(chunks_bytes)
    bundle_path.write_bytes(old_bundle_bytes)
    chunks_path.write_bytes(chunks_bytes)
    freeze_bytes = (json.dumps(freeze, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    freeze_path.write_bytes(freeze_bytes)
    print(json.dumps({
        'runDir': str(ROOT),
        'sourceBundleSha256': freeze['source']['sourceBundleSha256'],
        'chunkFileSha256': freeze['chunkFileSha256'],
        'freezeSha256': sha256_bytes(freeze_bytes),
        'chunkCount': sum(len(doc['chunks']) for doc in documents),
        'sourceCharacters': bundle['sourceChars'],
        'modelTag': MODEL,
        'modelDigest': model_tag['digest'],
        'ollamaVersion': runtime.get('version'),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
