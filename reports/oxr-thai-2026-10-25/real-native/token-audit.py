"""Post-run diagnostic only; never changes chunks, inference, or scores."""
import json,pathlib
from tokenizers import Tokenizer
tokenizer=Tokenizer.from_file('/model/614241f622f53c4eeff9890bdc4f31cfecc418b3/tokenizer.json')
tokenizer.no_truncation()
result={}
for arm in ['baseline','paddle']:
    chunks=json.loads(pathlib.Path('/evidence/native-'+arm+'/chunks.json').read_text())
    sizes=[len(tokenizer.encode('passage: '+c['text']).ids) for c in chunks]
    result[arm]={'chunkCount':len(sizes),'maxTokens':max(sizes),'over512':sum(n>512 for n in sizes),'tokenCounts':sizes}
with pathlib.Path('/result/token-audit.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
