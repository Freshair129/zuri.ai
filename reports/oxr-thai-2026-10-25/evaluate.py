"""Offline pinned-E5 cosine assessment. Not a native Genesis/GKS acceptance test."""
import hashlib, importlib.util, json, os, pathlib, sys, time, unicodedata
import numpy as np

def canonical(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if not c.isspace())

def distance(a, b):
    # Exact bit-parallel Levenshtein; no approximate difflib ratio and no CER cap.
    if not a: return len(b)
    masks = {}
    for i, c in enumerate(a): masks[c] = masks.get(c, 0) | (1 << i)
    positive, negative, score, high = ~0, 0, len(a), 1 << (len(a) - 1)
    for c in b:
        eq = masks.get(c, 0)
        xv = eq | negative
        xh = (((eq & positive) + positive) ^ positive) | eq
        ph, mh = negative | ~(xh | positive), positive & xh
        if ph & high: score += 1
        if mh & high: score -= 1
        ph = (ph << 1) | 1
        positive, negative = (mh << 1) | ~(xv | ph), ph & xv
    return score

def supports(text, doc, qa):
    value = canonical(text)
    if not all(canonical(x) in value for x in qa['evidence']): return False
    if len(qa['evidence']) > 1 and doc.get('table'):
        rows = [r for r in doc['table']['rows'] if qa['evidence'][0] in r]
        # Full contiguous row association, not scattered matching cells anywhere.
        return any(canonical(''.join(r)) in value.replace('|', '') for r in rows)
    return True

ARTIFACTS = {
 'onnx/model.onnx':'ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665',
 'tokenizer.json':'0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
 'tokenizer_config.json':'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
 'special_tokens_map.json':'d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7',
 'config.json':'69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959'
}

def main():
    root, model = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    pdf_parsers = sys.argv[3].split(',') if len(sys.argv) > 3 else ['baseline','oxr']
    for relative, expected in ARTIFACTS.items():
        actual = hashlib.file_digest((model / relative).open('rb'), 'sha256').hexdigest()
        assert actual == expected, f'Model hash mismatch: {relative}'
    spec = importlib.util.spec_from_file_location('actual_worker_embedder', root / 'embedder.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    corpus = json.loads((root / 'corpus.json').read_text(encoding='utf8'))
    prepared = json.loads((root / 'prepared.json').read_text(encoding='utf8'))
    docs = {d['id']: d for d in corpus['documents']}
    record_map = {(r['id'], r['parser']): r for r in prepared['records']}
    token, session = module.load(str(model))
    token.no_truncation()
    cache_path = root / 'embedding-cache.json'
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {'model':ARTIFACTS, 'vectors':{}}
    assert cache['model'] == ARTIFACTS
    def vectors(texts, mode):
        keys = [hashlib.sha256((mode + '\0' + text).encode()).hexdigest() for text in texts]
        missing = dict((key,text) for key,text in zip(keys,texts) if key not in cache['vectors'])
        items = list(missing.items())
        for offset in range(0,len(items),8):
            batch=items[offset:offset+8]
            for _,text in batch:
                assert len(token.encode(f'{mode}: '+text).ids)<=512, 'TOKEN_OVERFLOW: evaluation aborted, not silently truncated'
            values = module.embed(token, session, [text for _,text in batch], mode)
            for (key,_), value in zip(batch,values): cache['vectors'][key] = value
            if offset % 80 == 0: print(f'embedded {offset}/{len(items)} new {mode} texts', flush=True)
        cache_path.write_text(json.dumps(cache,separators=(',',':')))
        return np.asarray([cache['vectors'][key] for key in keys],dtype=np.float32)
    questions = [(d,q) for d in docs.values() for q in d['qa']]
    qvectors = vectors([q['question'] for _,q in questions], 'query')
    parsing=[]; arms=[]
    for variant in ['digital','raster','html']:
      for parser in (['html-control'] if variant=='html' else pdf_parsers):
        records=[]
        for doc in docs.values():
            r=record_map.get((f"{doc['id']}-{variant}",parser),{'id':f"{doc['id']}-{variant}",'doc':doc['id'],'status':'NOT_RUN','text':'','tables':[],'elapsedMs':None,'chunks':{'current':[],'experimental':[]}})
            records.append(r); gold=canonical(doc['referenceText']); actual=canonical(r['text'])
            goldrows=([doc['table']['headers']]+doc['table']['rows']) if doc.get('table') else []
            actualrows=[row for table in r['tables'] for row in table.get('rows',[])]
            cells=[c for row in goldrows for c in row]
            exactcells=0
            # Index-positioned cells, across one expected table. Extra/missing tables are visible.
            for rowidx,row in enumerate(goldrows):
                for colidx,cell in enumerate(row):
                    if rowidx<len(actualrows) and colidx<len(actualrows[rowidx]) and canonical(cell)==canonical(actualrows[rowidx][colidx]): exactcells+=1
            measured=r['status']=='PARSED'
            edits=distance(gold,actual) if measured else None
            parsing.append({'id':r['id'],'parser':parser,'status':r['status'],'elapsedMs':r['elapsedMs'],
              'referenceChars':len(gold),'outputChars':len(actual) if measured else None,'editDistance':edits,'cer':edits/max(1,len(gold)) if measured else None,
              'criticalMatches':sum(all(canonical(x) in actual for x in q['evidence']) for q in doc['qa']) if measured else None,'criticalTotal':len(doc['qa']),
              'cellContentMatches':sum(canonical(c) in actual for c in cells) if measured else None,'cellPositionMatches':exactcells if measured else None,'cellTotal':len(cells),'parsedTableCount':len(r['tables']) if measured else None})
        for chunker in ['current','experimental']:
            chunks=[dict(c,doc=r['doc']) for r in records for c in r['chunks'][chunker]]
            sizes=[len(token.encode('passage: '+c['text']).ids) for c in chunks]
            matrix=vectors([c['text'] for c in chunks],'passage') if chunks else None
            queryrows=[]
            for i,(doc,qa) in enumerate(questions):
                scores=(matrix@qvectors[i]) if matrix is not None else []
                order=sorted(range(len(chunks)),key=lambda j:(-float(scores[j]),j))
                rank=next((k+1 for k,j in enumerate(order) if chunks[j]['doc']==doc['id'] and supports(chunks[j]['text'],doc,qa)),None)
                document_rank=next((k+1 for k,j in enumerate(order) if chunks[j]['doc']==doc['id']),None)
                parse_status=next(r['status'] for r in records if r.get('doc',r['id'].rsplit('-',1)[0])==doc['id'])
                queryrows.append({'id':qa['id'],'parseStatus':parse_status,'evidenceRank':rank,'documentRank':document_rank,'top5Tokens':sum(sizes[j] for j in order[:5]),'top5':[{'doc':chunks[j]['doc'],'score':float(scores[j]),'text':chunks[j]['text']} for j in order[:5]]})
            measured_queries=[q for q in queryrows if q['parseStatus']=='PARSED']
            arms.append({'variant':variant,'parser':parser,'chunker':chunker,'parsedDocuments':sum(r['status']=='PARSED' for r in records),'notRunDocuments':sum(r['status']=='NOT_RUN' for r in records),'failedDocuments':sum(r['status'] not in ['PARSED','NOT_RUN'] for r in records),'expectedDocuments':len(docs),'chunkCount':len(chunks),'maxTokens':max(sizes,default=0),'tokenOverflow':sum(n>512 for n in sizes),'queries':len(questions),'measuredQueries':len(measured_queries),'rateDefinition':'end-to-end over all queries; unavailable source is failure, not measured retrieval miss',
              'evidenceHit1':sum(q['evidenceRank']==1 for q in queryrows)/len(questions),
              'evidenceHit5':sum(q['evidenceRank'] is not None and q['evidenceRank']<=5 for q in queryrows)/len(questions),
              'mrr':sum(1/q['evidenceRank'] if q['evidenceRank'] else 0 for q in queryrows)/len(questions),
              'documentHit5':sum(q['documentRank'] is not None and q['documentRank']<=5 for q in queryrows)/len(questions),
              'conditionalEvidenceHit5':sum(q['evidenceRank'] is not None and q['evidenceRank']<=5 for q in measured_queries)/len(measured_queries) if measured_queries else None,'totalChunkTokens':sum(sizes),'meanTop5Tokens':sum(q['top5Tokens'] for q in queryrows)/len(queryrows),'queryResults':queryrows})
    result={'model':'intfloat/multilingual-e5-small','revision':'614241f622f53c4eeff9890bdc4f31cfecc418b3','artifacts':ARTIFACTS,'retrieval':'offline exact cosine, no native hybrid/graph/RRF or reranker','normalization':'NFKC then remove Unicode whitespace; retain punctuation and erroneous/null characters','parsing':parsing,'arms':arms}
    (root/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps([{k:v for k,v in a.items() if k!='queryResults'} for a in arms],indent=2),flush=True)

if __name__=='__main__':main()
