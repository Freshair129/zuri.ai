"""Build data/source/price-pdf-index.json: base code -> where its price exists in the ใบราคา PDFs.

Usage:
  py -3 scripts/build-price-pdf-index.py <bases.json> <pdf-root> <out.json>

<bases.json> is either a JSON array of base-code strings or the unpriced worklist
(array of objects with a "base" field). Scans every *.pdf under <pdf-root> recursively.
Informational input to ingest (review/unpriced-offers.jsonl join) — never affects the graph.
"""
import json, re, sys
from pathlib import Path
from pypdf import PdfReader

def main() -> None:
    bases_path, pdf_root, out_path = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    raw = json.loads(Path(bases_path).read_text(encoding="utf-8"))
    bases = sorted({(e["base"] if isinstance(e, dict) else e).upper() for e in raw})
    # word-ish boundaries: TPP00-2 must not match inside XTPP00-2 or TPP00-25
    rx = {b: re.compile(r"(?<![A-Z0-9])" + re.escape(b) + r"(?![0-9])") for b in bases}
    index: dict[str, list[dict]] = {}
    pdfs = sorted(pdf_root.rglob("*.pdf"))
    for pdf in pdfs:
        rel = pdf.relative_to(pdf_root).as_posix()
        try:
            reader = PdfReader(str(pdf))
        except Exception as err:
            print(f"[skip] {rel}: {err}", file=sys.stderr)
            continue
        hits: dict[str, list[int]] = {}
        for page_no, page in enumerate(reader.pages, start=1):
            try:
                text = (page.extract_text() or "").upper()
            except Exception:
                continue
            for b in bases:
                if rx[b].search(text):
                    hits.setdefault(b, []).append(page_no)
        for b, pages in hits.items():
            index.setdefault(b, []).append({"file": rel, "pages": pages})
        print(f"[scan] {rel}: {len(reader.pages)} pages, {len(hits)} base hits")
    Path(out_path).write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    found = sum(1 for b in bases if b in index)
    print(f"[done] {found}/{len(bases)} bases found across {len(pdfs)} PDFs -> {out_path}")

if __name__ == "__main__":
    main()
