"""Frozen Paddle1280 profile on public PDFs. Never reads gold or questions."""
import hashlib,json,pathlib,signal,time,traceback,importlib.metadata
from paddleocr import PPStructureV3
out=pathlib.Path('/bench')
config=dict(lang='th',ocr_version='PP-OCRv5',text_detection_model_name='PP-OCRv5_server_det',text_recognition_model_name='th_PP-OCRv5_mobile_rec',use_doc_orientation_classify=False,use_doc_unwarping=False,use_textline_orientation=False,use_formula_recognition=False,use_chart_recognition=False,use_seal_recognition=False,use_table_recognition=True,device='cpu',cpu_threads=2,enable_mkldnn=False,text_det_limit_type='max',text_det_limit_side_len=1280)
predict=dict(use_table_orientation_classify=False,text_det_limit_type='max',text_det_limit_side_len=1280)
def write(name,value):
    with (out/name).open('x',encoding='utf8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
def timeout(*args):raise TimeoutError('600-second per-document bound')
signal.signal(signal.SIGALRM,timeout)
start=time.perf_counter();engine=PPStructureV3(**config)
engine.export_paddlex_config_to_yaml(str(out/'resolved.yaml'))
write('runtime.json',dict(config=config,predict=predict,initializationMs=(time.perf_counter()-start)*1000,packages={p:importlib.metadata.version(p) for p in ['paddleocr','paddlex','paddlepaddle']}))
for pdf in sorted(pathlib.Path('/input').glob('*.pdf')):
    record=dict(id=pdf.stem,parser='paddle1280',inputSha256=hashlib.sha256(pdf.read_bytes()).hexdigest());start=time.perf_counter();signal.alarm(600)
    try:record.update(status='PARSED',raw=[r.json for r in engine.predict(input=str(pdf),**predict)])
    except Exception as e:record.update(status='ERROR',error=type(e).__name__,message=str(e),traceback=traceback.format_exc())
    finally:
        signal.alarm(0);record['elapsedMs']=(time.perf_counter()-start)*1000;write(pdf.stem+'.json',record);print(pdf.stem,record['status'],round(record['elapsedMs']),flush=True)
write('resources.json',dict(memoryPeakBytes=int(pathlib.Path('/sys/fs/cgroup/memory.peak').read_text())))
