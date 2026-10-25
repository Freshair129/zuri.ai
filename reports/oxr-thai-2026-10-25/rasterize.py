"""Render synthetic fixtures and create image-only equivalents; never reads business files."""
import hashlib, json, pathlib, sys
import pypdfium2 as pdfium
from PIL import Image

root = pathlib.Path(sys.argv[1])
corpus = json.loads((root / 'corpus.json').read_text(encoding='utf8'))
images = []
for doc in corpus['documents']:
    pdf = pdfium.PdfDocument(str(root / f"{doc['id']}-digital.pdf"))
    assert len(pdf) == 1, f"Unexpected overflow: {doc['id']} has {len(pdf)} pages"
    image = pdf[0].render(scale=2.5).to_pil().convert('RGB')
    image.save(root / f"{doc['id']}-page.png")
    image.save(root / f"{doc['id']}-raster.pdf", 'PDF', resolution=180)
    thumb = image.copy(); thumb.thumbnail((595, 842)); images.append(thumb)
sheet = Image.new('RGB', (1190, 1684), 'white')
for i, image in enumerate(images): sheet.paste(image, ((i % 2) * 595, (i // 2) * 842))
sheet.save(root / 'contact-sheet.png')
hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.suffix in ['.pdf', '.html'] or p.name == 'corpus.json'}
(root / 'fixture-hashes.json').write_text(json.dumps(hashes, indent=2), encoding='utf8')
print(f"Rendered {len(images)} pages; saved {len(images)} raster-only PDFs")
