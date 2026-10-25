"""Record model bytes and installed package evidence; no application data."""
import hashlib,json,pathlib,subprocess,sys,yaml
root=pathlib.Path('/cache'); records=[]
for p in sorted(root.rglob('*')):
    if p.is_file() and p.suffix.lower() in {'.bin','.safetensors','.onnx','.pdiparams','.pdmodel','.json','.yaml','.yml','.pth','.pt'}:
        with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        records.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':digest})
for language in ['tha','eng']:
    p=pathlib.Path('/usr/share/tesseract-ocr/5/tessdata')/(language+'.traineddata')
    with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    records.append({'path':str(p),'bytes':p.stat().st_size,'sha256':digest})
assert any('tableformer' in r['path'] and r['bytes']>1000000 for r in records), 'Missing TableFormer weights'
assert any('th_PP-OCRv5_mobile_rec' in r['path'] and r['bytes']>1000000 for r in records), 'Missing Thai recognition weights'
config=yaml.safe_load(pathlib.Path('/bench/paddle-resolved-setup.yaml').read_text())
general=config['SubPipelines']['GeneralOCR']['SubModules']['TextRecognition']['model_name']
table=config['SubPipelines']['TableRecognition']['SubPipelines']['GeneralOCR']['SubModules']['TextRecognition']['model_name']
assert general==table=='th_PP-OCRv5_mobile_rec',(general,table)
with pathlib.Path(sys.argv[1]).open('x') as f:
    json.dump({'models':records,'thaiRecognizers':{'general':general,'table':table},'packages':subprocess.check_output([sys.executable,'-m','pip','freeze'],text=True),'systemPackages':subprocess.check_output(['dpkg-query','-W','tesseract-ocr','tesseract-ocr-tha','tesseract-ocr-eng'],text=True)},f,indent=2)
print('Fingerprinted',len(records),'model/config files')
