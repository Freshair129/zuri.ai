"""Isolated real parser execution. Reads PDF bytes, never reference answers."""
import argparse, hashlib, importlib.metadata, json, pathlib, signal, subprocess, time, traceback

def json_default(value):
    if hasattr(value, 'tolist'): return value.tolist()
    if hasattr(value, 'model_dump'): return value.model_dump(mode='json')
    if isinstance(value, pathlib.Path): return str(value)
    raise TypeError(type(value).__name__)

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2, default=json_default)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('parser', choices=['docling','paddle'])
    ap.add_argument('--input', default='/input')
    ap.add_argument('--output', default='/bench')
    ap.add_argument('--setup', action='store_true')
    ap.add_argument('--bounded-detector', action='store_true', help='Separate Paddle max-side-1280 resource profile')
    args=ap.parse_args(); out=pathlib.Path(args.output); out.mkdir(parents=True,exist_ok=True); started=time.perf_counter()
    name='paddle1280' if args.parser=='paddle' and args.bounded_detector else args.parser
    predict_args={'use_table_orientation_classify':False} if args.parser=='paddle' else {}
    if args.bounded_detector:predict_args.update(text_det_limit_type='max',text_det_limit_side_len=1280)
    packages={p:importlib.metadata.version(p) for p in ['docling','docling-core','docling-ibm-models','paddleocr','paddlex','paddlepaddle','torch','transformers','numpy']}
    if args.parser=='docling':
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions, OcrMode, AcceleratorOptions, AcceleratorDevice, TableFormerMode
        from docling.document_converter import DocumentConverter, PdfFormatOption
        options=PdfPipelineOptions()
        options.do_ocr=True; options.do_table_structure=True
        options.ocr_options=TesseractCliOcrOptions(lang=['tha','eng'], mode=OcrMode.FULL_PAGE)
        options.table_structure_options.do_cell_matching=True
        options.table_structure_options.mode=TableFormerMode.ACCURATE
        options.accelerator_options=AcceleratorOptions(num_threads=2,device=AcceleratorDevice.CPU)
        options.document_timeout=180
        config=options.model_dump(mode='json',serialize_as_any=True)
        config['ocr_options']=options.ocr_options.model_dump(mode='json')
        config['table_structure_options']=options.table_structure_options.model_dump(mode='json')
        engine=DocumentConverter(format_options={InputFormat.PDF:PdfFormatOption(pipeline_options=options)})
        engine.initialize_pipeline(InputFormat.PDF)
        tesseract=subprocess.run(['tesseract','--version'],capture_output=True,text=True).stdout
    else:
        from paddleocr import PPStructureV3
        config=dict(lang='th',ocr_version='PP-OCRv5',text_detection_model_name='PP-OCRv5_server_det',text_recognition_model_name='th_PP-OCRv5_mobile_rec',
                    use_doc_orientation_classify=False,use_doc_unwarping=False,
                    use_textline_orientation=False,use_formula_recognition=False,
                    use_chart_recognition=False,use_seal_recognition=False,
                    use_table_recognition=True,device='cpu',cpu_threads=2,enable_mkldnn=False)
        if args.bounded_detector:config.update(text_det_limit_type='max',text_det_limit_side_len=1280)
        engine=PPStructureV3(**config);tesseract=None
        engine.export_paddlex_config_to_yaml(str(out/(name+'-resolved-'+('setup' if args.setup else 'run')+'.yaml')))
    metadata={'parser':name,'packages':packages,'config':config,'predictConfig':predict_args,'initializationMs':(time.perf_counter()-started)*1000,'tesseract':tesseract,'setupOnly':args.setup}
    write(out/(name+('-setup.json' if args.setup else '-runtime.json')),metadata)
    if args.setup:return
    def timed_out(signum,frame):raise TimeoutError('Per-input 180 second timeout')
    signal.signal(signal.SIGALRM,timed_out)
    for pdf in sorted(pathlib.Path(args.input).glob('*.pdf')):
        destination=out/'parsed'/(pdf.stem+'-'+name+'.json')
        if destination.exists():raise RuntimeError('Refuse overwriting '+str(destination))
        record={'id':pdf.stem,'parser':name,'inputSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        start=time.perf_counter();signal.alarm(180)
        try:
            if args.parser=='docling':
                result=engine.convert(pdf)
                record.update(status='PARSED' if result.status.value=='success' else 'PARTIAL',raw=result.document.export_to_dict(),conversionStatus=result.status.value,errors=[str(e) for e in result.errors])
            else:
                pages=[result.json for result in engine.predict(input=str(pdf),**predict_args)]
                record.update(status='PARSED' if pages else 'EMPTY',raw=pages)
        except Exception as e:
            record.update(status='ERROR',error=type(e).__name__,message=str(e),traceback=traceback.format_exc())
        finally:
            signal.alarm(0)
            record['elapsedMs']=(time.perf_counter()-start)*1000
            write(destination,record)
            print(pdf.stem,name,record['status'],round(record['elapsedMs']),flush=True)
    write(out/(name+'-resources.json'),{'memoryPeakBytes':int(pathlib.Path('/sys/fs/cgroup/memory.peak').read_text())})

if __name__=='__main__':main()
