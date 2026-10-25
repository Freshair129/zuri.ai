"""Evidence-aware candidate schema with a generic per-chunk output budget."""

from typing import Literal

from pydantic import BaseModel, Field


MAX_FACT_CANDIDATES_PER_CHUNK = 8
MAX_RELATION_CANDIDATES_PER_CHUNK = 4


class FactCandidate(BaseModel):
    kind: Literal['prose', 'table_row'] = Field(description='Whether this is a prose fact or a row-bound table fact')
    subject: str = Field(description='Exact source text for the fact subject')
    predicate: str = Field(max_length=64, description='Short candidate fact predicate; not source evidence')
    value: str = Field(description='Exact source text for the value')
    description: str = Field(max_length=120, description='Optional paraphrase; never evidence')
    evidenceQuote: str = Field(max_length=800, description='Exact shortest complete prose sentence; empty for table_row facts')
    predicateCue: str = Field(max_length=160, description='Exact prose predicate cue; empty for table_row facts')
    rowQuote: str = Field(max_length=800, description='Exact full row body; empty for prose facts')
    headerQuote: str = Field(max_length=300, description='Exact full header cell for the value column; empty for prose facts')
    tableId: str = Field(description='Table id from the packetized input; metadata only, not source evidence')
    tableRowLabel: str = Field(description='Adapter-generated row label from packetized input; metadata only, not source evidence')
    subjectColumnIndex: int = Field(description='Zero-based table column containing the exact subject cell; -1 for prose facts')
    columnIndex: int = Field(description='Zero-based table column containing the exact value cell; -1 for prose facts')


class RelationCandidate(BaseModel):
    participants: list[str] = Field(
        min_length=2,
        description='At least two distinct exact source names; duplicate values are rejected by the validator',
    )
    predicate: str = Field(max_length=64, description='Candidate relation predicate; not source evidence')
    description: str = Field(max_length=120, description='Optional paraphrase; never evidence')
    evidenceQuote: str = Field(max_length=800, description='Exact shortest complete prose sentence containing all participants and an explicit relation cue')
    relationCue: str = Field(max_length=160, description='Exact relation wording copied from evidenceQuote')


class EvidenceOutput(BaseModel):
    factCandidates: list[FactCandidate] = Field(
        max_length=MAX_FACT_CANDIDATES_PER_CHUNK,
        description='At most eight source-evidence-bearing fact candidates per chunk, in source order',
    )
    relationCandidates: list[RelationCandidate] = Field(
        max_length=MAX_RELATION_CANDIDATES_PER_CHUNK,
        description='At most four explicit prose relation candidates per chunk, in source order',
    )
