"""Hash actual read-only native model bytes; no inference or product state."""
import hashlib,json,pathlib
root=pathlib.Path('/model/614241f622f53c4eeff9890bdc4f31cfecc418b3')
records=[]
for p in sorted(root.rglob('*')):
    if p.is_file():
        with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        records.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':digest})
assert records and any(r['path'].endswith('.onnx') for r in records)
with pathlib.Path('/result/native-models.json').open('x') as f:json.dump(records,f,indent=2)
print('Native model files:',len(records))
