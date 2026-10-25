"""Model-only bootstrap. This container receives no PDFs, gold or questions."""
import importlib.metadata
import json
import os
import pathlib
import sys

import paddle
from paddleocr import PaddleOCRVL

if not paddle.device.is_compiled_with_cuda() or paddle.device.cuda.device_count() < 1:
    raise RuntimeError('CUDA GPU is unavailable; refusing CPU fallback')
paddle.device.set_device('gpu:0')
out = pathlib.Path('/out')
out.mkdir(parents=True, exist_ok=True)
pipeline = PaddleOCRVL(pipeline_version='v1')
actual_device = paddle.device.get_device()
if actual_device != 'gpu:0':
    raise RuntimeError(f'PaddleOCR-VL selected {actual_device!r}, expected gpu:0')
data = {
    'status': 'MODEL_BOOTSTRAPPED',
    'python': sys.version,
    'packages': {},
    'pipeline_version': 'v1',
    'device': actual_device,
    'cudaDeviceCount': paddle.device.cuda.device_count(),
    'cudaCompiled': paddle.device.is_compiled_with_cuda(),
    'environment': {k: os.environ.get(k) for k in ['CUDA_VISIBLE_DEVICES', 'PADDLE_PDX_HOME']},
}
for name in ['paddleocr', 'paddlepaddle-gpu', 'paddlex', 'paddleocr-vl']:
    try:
        data['packages'][name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        pass
data['pipeline_class'] = type(pipeline).__qualname__
with (out / 'bootstrap.json').open('x', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps(data, ensure_ascii=False, indent=2))
