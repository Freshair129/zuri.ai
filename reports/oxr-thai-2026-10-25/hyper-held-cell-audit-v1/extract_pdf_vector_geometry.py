"""Extract table-cell vector rectangles from the frozen source PDFs only."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import sys
from pathlib import Path
from typing import Any

import pdfminer
import pdfplumber
from held_cell_repair import numeric_word_key


ROOT = next(path for path in Path(__file__).resolve().parents if (path / "AGENTS.md").is_file())
RAW = ROOT / ".local/hyper-held-cell-audit-20261025"
SIDE_CAR = ROOT / ".local/thai-table-chunking-20261025/run-v2/table-sidecar.json"
PADDLE_DIR = ROOT / ".local/thai-native-20261025/paddle-2"
PDF_DIR = ROOT / ".local/thai-native-20261025/input"
OUTPUT = RAW / "pdf-vector-geometry-v1.json"


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return sha256(path.read_bytes())


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def bbox_iou(left: list[float], right: list[float]) -> float:
    ix = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    iy = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    intersection = ix * iy
    union = (left[2] - left[0]) * (left[3] - left[1]) + (right[2] - right[0]) * (right[3] - right[1]) - intersection
    return intersection / union if union > 0 else 0.0


def boundary_index(boundaries: list[float], value: float, tolerance: float = 0.05) -> int:
    matches = [index for index, boundary in enumerate(boundaries) if abs(boundary - value) <= tolerance]
    if len(matches) != 1:
        raise ValueError(f"PDF vector cell edge is not a unique grid boundary: {value}")
    return matches[0]


def vector_cells(table: Any, scale_x: float, scale_y: float, table_id: str) -> tuple[list[dict[str, Any]], list[float], list[float]]:
    raw_cells: list[tuple[float, float, float, float]] = []
    for row in table.rows:
        for cell in row.cells:
            if cell is not None:
                raw_cells.append(tuple(float(value) for value in cell))
    x_boundaries = sorted({round(value, 3) for cell in raw_cells for value in (cell[0], cell[2])})
    y_boundaries = sorted({round(value, 3) for cell in raw_cells for value in (cell[1], cell[3])})
    if len(x_boundaries) < 2 or len(y_boundaries) < 2:
        raise ValueError(f"PDF table {table_id} has insufficient vector boundaries")

    result: list[dict[str, Any]] = []
    seen: set[tuple[float, float, float, float]] = set()
    for raw in raw_cells:
        key = tuple(round(value, 3) for value in raw)
        if key in seen:
            continue
        seen.add(key)
        x0, top, x1, bottom = key
        col_start = boundary_index(x_boundaries, x0)
        col_end = boundary_index(x_boundaries, x1) - 1
        row_start = boundary_index(y_boundaries, top)
        row_end = boundary_index(y_boundaries, bottom) - 1
        if col_end < col_start or row_end < row_start:
            raise ValueError(f"PDF table {table_id} has an invalid vector-cell span")
        result.append({
            "id": f"pdfvector:{table_id}:r{row_start}:c{col_start}:n{len(result)}",
            "pdfBox": [x0, top, x1, bottom],
            "box": [x0 * scale_x, top * scale_y, x1 * scale_x, bottom * scale_y],
            "rowStart": row_start,
            "rowEnd": row_end,
            "rowSpan": row_end - row_start + 1,
            "vectorColumnStart": col_start,
            "vectorColumnEnd": col_end,
        })
    return result, x_boundaries, y_boundaries


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    sidecar = read_json(SIDE_CAR)
    paddle_docs = {doc: read_json(PADDLE_DIR / f"{doc}.json") for doc in ("economy", "population")}
    source_hashes = {
        "tableSidecar": file_sha(SIDE_CAR),
        "economyPaddleRaw": file_sha(PADDLE_DIR / "economy.json"),
        "populationPaddleRaw": file_sha(PADDLE_DIR / "population.json"),
        "economyPdf": file_sha(PDF_DIR / "economy.pdf"),
        "populationPdf": file_sha(PDF_DIR / "population.pdf"),
    }
    tables: dict[str, Any] = {}
    open_pdfs: dict[str, Any] = {}
    try:
        for doc in ("economy", "population"):
            pdf_path = PDF_DIR / f"{doc}.pdf"
            expected_doc_hash = paddle_docs[doc].get("inputSha256")
            if expected_doc_hash and expected_doc_hash != source_hashes[f"{doc}Pdf"]:
                raise SystemExit(f"Frozen PDF hash mismatch for {doc}")
            open_pdfs[doc] = pdfplumber.open(pdf_path)

        for source_table in sidecar["tables"]:
            table_id = str(source_table["id"])
            doc = str(source_table["doc"])
            page_index = int(source_table["page"])
            source_pdf_hash = source_hashes[f"{doc}Pdf"]
            if source_table.get("pdfSha256") != source_pdf_hash:
                raise SystemExit(f"Table sidecar PDF hash mismatch for {table_id}")
            pdf_page = open_pdfs[doc].pages[page_index]
            paddle_page = paddle_docs[doc]["raw"][page_index]["res"]
            scale_x = float(paddle_page["width"]) / float(pdf_page.width)
            scale_y = float(paddle_page["height"]) / float(pdf_page.height)
            if abs(scale_x - scale_y) > 0.002:
                raise SystemExit(f"PDF-to-Paddle scale differs by axis for {table_id}")

            table_blocks = [
                block for block in paddle_page["parsing_res_list"]
                if block.get("block_label") == "table" and block.get("block_bbox")
            ]
            if len(table_blocks) != 1:
                raise SystemExit(f"Expected one Paddle source table block for {table_id}")
            paddle_box = [float(value) for value in table_blocks[0]["block_bbox"]]
            pdf_tables = pdf_page.find_tables()
            matches = []
            for index, candidate in enumerate(pdf_tables):
                converted = [
                    float(candidate.bbox[0]) * scale_x,
                    float(candidate.bbox[1]) * scale_y,
                    float(candidate.bbox[2]) * scale_x,
                    float(candidate.bbox[3]) * scale_y,
                ]
                matches.append((bbox_iou(paddle_box, converted), index, candidate, converted))
            matches.sort(key=lambda item: item[0], reverse=True)
            if not matches or matches[0][0] < 0.90 or (len(matches) > 1 and matches[0][0] - matches[1][0] < 0.20):
                raise SystemExit(f"PDF table does not uniquely match Paddle table bounds for {table_id}: {[m[0] for m in matches]}")
            iou, pdf_table_index, pdf_table, matched_box = matches[0]
            cells, x_bounds, y_bounds = vector_cells(pdf_table, scale_x, scale_y, table_id)
            numeric_words = []
            for word_index, word in enumerate(pdf_page.extract_words(keep_blank_chars=False)):
                text = str(word.get("text", ""))
                canonical = numeric_word_key(text)
                if canonical is None:
                    continue
                pdf_box = [float(word["x0"]), float(word["top"]), float(word["x1"]), float(word["bottom"])]
                center_x = (pdf_box[0] + pdf_box[2]) / 2
                center_y = (pdf_box[1] + pdf_box[3]) / 2
                if not (float(pdf_table.bbox[0]) <= center_x <= float(pdf_table.bbox[2]) and float(pdf_table.bbox[1]) <= center_y <= float(pdf_table.bbox[3])):
                    continue
                numeric_words.append({
                    "wordIndex": word_index,
                    "text": text,
                    "comparisonCanonical": canonical,
                    "pdfBox": pdf_box,
                    "box": [pdf_box[0] * scale_x, pdf_box[1] * scale_y, pdf_box[2] * scale_x, pdf_box[3] * scale_y],
                })
            overlap_count = 0
            for index, left in enumerate(cells):
                for right in cells[index + 1:]:
                    overlap_x = min(left["box"][2], right["box"][2]) - max(left["box"][0], right["box"][0])
                    overlap_y = min(left["box"][3], right["box"][3]) - max(left["box"][1], right["box"][1])
                    overlap_count += int(overlap_x > 0.5 and overlap_y > 0.5)
            source_html_rows = max(int(cell.get("rowEnd", cell["row"])) for cell in source_table["cells"]) + 1
            source_html_columns = max(int(cell.get("colEnd", cell["col"])) for cell in source_table["cells"]) + 1
            pdf_vector_rows = len(y_bounds) - 1
            pdf_vector_columns = len(x_bounds) - 1
            topology_usable = (
                overlap_count == 0
                and pdf_vector_rows == source_html_rows
                and pdf_vector_columns == source_html_columns
            )
            tables[table_id] = {
                "doc": doc,
                "pageIndex": page_index,
                "sourcePdfSha256": source_pdf_hash,
                "paddlePageSize": [int(paddle_page["width"]), int(paddle_page["height"])],
                "pdfPageSize": [float(pdf_page.width), float(pdf_page.height)],
                "paddlePerPdfPointScale": [scale_x, scale_y],
                "paddleTableBlockBox": paddle_box,
                "pdfTableMatch": {
                    "index": pdf_table_index,
                    "bbox": [float(value) for value in pdf_table.bbox],
                    "bboxTransformedToPaddle": matched_box,
                    "bboxIoUWithPaddleBlock": iou,
                    "vectorRowCount": len(pdf_table.rows),
                    "vectorColumnBoundaryCount": len(x_bounds),
                    "vectorRowBoundaryCount": len(y_bounds),
                },
                "topologyCheck": {
                    "status": "USABLE" if topology_usable else "HELD",
                    "overlappingCellPairCount": overlap_count,
                    "pdfVectorRowCount": pdf_vector_rows,
                    "sourceHtmlRowCount": source_html_rows,
                    "pdfVectorColumnCount": pdf_vector_columns,
                    "sourceHtmlColumnCount": source_html_columns,
                    "reason": None if topology_usable else "VECTOR_GRID_INCOMPLETE_OR_OVERLAPPING",
                },
                "numericTextLayerWords": numeric_words,
                "vectorCells": cells,
            }
    finally:
        for pdf in open_pdfs.values():
            pdf.close()

    output = {
        "schema": "hyper-held-cell-pdf-vector-geometry-v1",
        "status": "SOURCE_GEOMETRY_AND_NUMERIC_TEXT_LAYER",
        "extractionMethod": "pdfplumber find_tables vector rectangles plus numeric-syntax-filtered extract_words PDF text-layer tokens; no OCR output is changed here",
        "runtime": {
            "python": sys.version.split()[0],
            "executable": sys.executable,
            "platform": platform.platform(),
            "pdfplumber": pdfplumber.__version__,
            "pdfminer": pdfminer.__version__,
            "packages": {
                name: importlib.metadata.version(name)
                for name in ("pdfplumber", "pdfminer.six", "Pillow", "pypdfium2", "cryptography", "cffi", "charset-normalizer", "pycparser")
            },
        },
        "sourceSha256": source_hashes,
        "tables": tables,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(OUTPUT.relative_to(ROOT)).replace("\\", "/"),
        "outputSha256": file_sha(OUTPUT),
        "runtime": output["runtime"],
        "tables": {key: {"pdfTableMatch": value["pdfTableMatch"], "vectorCells": len(value["vectorCells"])} for key, value in tables.items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
