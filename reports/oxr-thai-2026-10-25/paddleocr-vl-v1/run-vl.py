"""Run two blind, offline PaddleOCR-VL v1 passes over the frozen public PDFs."""
import hashlib
import importlib.metadata
import json
import os
import pathlib
import subprocess
import sys
import time
import traceback

from paddleocr import PaddleOCRVL

INPUT = pathlib.Path('/input')
OUTPUT = pathlib.Path('/out')
DOCS = ['economy', 'population']
EXPECTED_PAGES = {'economy': 1, 'population': 3}
EXPECTED = {
    'economy': os.environ['ECONOMY_SHA256'],
    'population': os.environ['POPULATION_SHA256'],
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def cgroup_memory_peak():
    for file in ['/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory/memory.max_usage_in_bytes']:
        try:
            return {'path': file, 'bytes': int(pathlib.Path(file).read_text().strip())}
        except (FileNotFoundError, ValueError, PermissionError):
            continue
    return None


def write_once(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


for name in DOCS:
    pdf = INPUT / f'{name}.pdf'
    if not pdf.is_file() or sha256(pdf) != EXPECTED[name]:
        raise RuntimeError(f'frozen PDF missing or hash mismatch: {name}')
if any((INPUT / name).exists() for name in ['gold.json', 'questions.json', 'answers.json']):
    raise RuntimeError('forbidden evaluation file present in parser input mount')
if any(OUTPUT.iterdir()):
    raise RuntimeError('refusing nonempty output directory')

started = time.perf_counter()
report = {
    'status': 'RUNNING',
    'pipeline_version': 'v1',
    'engine': 'PaddlePaddle',
    'pdfs': [],
    'repetitions': 2,
    'hostMounts': {'input': 'read-only PDFs only', 'modelCache': 'read-only frozen weights'},
    'network': 'none',
    'customPrompt': None,
    'correction': None,
    'python': sys.version,
    'packages': {},
}
for package in ['paddleocr', 'paddlepaddle-gpu', 'paddlex']:
    try:
        report['packages'][package] = importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        pass
try:
    import paddle
    if not paddle.device.is_compiled_with_cuda() or paddle.device.cuda.device_count() < 1:
        raise RuntimeError('CUDA GPU is unavailable; refusing CPU fallback')
    paddle.device.set_device('gpu:0')
    report['device'] = {'selectedBeforeModel': paddle.device.get_device(), 'cudaCompiled': paddle.device.is_compiled_with_cuda(), 'cudaDeviceCount': paddle.device.cuda.device_count()}
except Exception as exc:
    raise RuntimeError('PaddleOCR-VL must run on a visible CUDA GPU') from exc

write_once(OUTPUT / 'run-start.json', {'status': 'STARTED', 'at': time.time(), **report})
try:
    load_start = time.perf_counter()
    pipeline = PaddleOCRVL(pipeline_version='v1')
    actual_device = paddle.device.get_device()
    if actual_device != 'gpu:0':
        raise RuntimeError(f'PaddleOCR-VL selected {actual_device!r}, expected gpu:0')
    report['device']['selectedAfterModel'] = actual_device
    report['modelLoadMs'] = round((time.perf_counter() - load_start) * 1000, 3)
    for repetition in [1, 2]:
        for name in DOCS:
            pdf = INPUT / f'{name}.pdf'
            target = OUTPUT / f'repeat-{repetition}' / name
            target.mkdir(parents=True, exist_ok=False)
            parse_start = time.perf_counter()
            results = list(pipeline.predict(str(pdf)))
            elapsed_ms = round((time.perf_counter() - parse_start) * 1000, 3)
            if len(results) != EXPECTED_PAGES[name]:
                raise RuntimeError(f'{name}: predictor returned {len(results)} pages, expected {EXPECTED_PAGES[name]}')
            files = []
            for index, result in enumerate(results):
                result.save_to_json(save_path=str(target))
                result.save_to_markdown(save_path=str(target))
                page_files = sorted(p.name for p in target.iterdir() if p.is_file())
                files = page_files
            report['pdfs'].append({
                'id': name,
                'repetition': repetition,
                'inputSha256': sha256(pdf),
                'pageResultCount': len(results),
                'elapsedMs': elapsed_ms,
                'resultFiles': files,
            })
            # Persist each completed PDF immediately so later failures retain its receipt.
            write_once(OUTPUT / f'repeat-{repetition}-{name}-receipt.json', report['pdfs'][-1])
    report['status'] = 'PARSED'
except Exception as exc:
    report['status'] = 'FAILED'
    report['error'] = {'type': type(exc).__name__, 'message': str(exc), 'traceback': traceback.format_exc()}
    raise
finally:
    report['totalMs'] = round((time.perf_counter() - started) * 1000, 3)
    report['cgroupMemoryPeak'] = cgroup_memory_peak()
    try:
        report['gpuSnapshot'] = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
            check=True, capture_output=True, text=True, timeout=10,
        ).stdout.strip().splitlines()
    except Exception as exc:
        report['gpuSnapshotError'] = repr(exc)
    write_once(OUTPUT / 'run-result.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
