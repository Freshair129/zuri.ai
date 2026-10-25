"""Structured evidence-aware candidate schema for the isolated follow-up run."""

from typing import Literal

from pydantic import BaseModel, Field


class FactCandidate(BaseModel):
    kind: Literal['prose', 'table_row'] = Field(description='Whether this is a prose fact or a row-bound table fact')
    subject: str = Field(description='Exact source text for the fact subject')
    predicate: str = Field(description='Short candidate fact predicate; not source evidence')
    value: str = Field(description='Exact source text for the value')
    description: str = Field(description='Optional paraphrase; never evidence')
    evidenceQuote: str = Field(description='Exact prose quote; empty for table_row facts')
    predicateCue: str = Field(description='Exact prose predicate cue; empty for table_row facts')
    rowQuote: str = Field(description='Exact full row body; empty for prose facts')
    headerQuote: str = Field(description='Exact full header cell for the value column; empty for prose facts')
    tableId: str = Field(description='Table id from the packetized input; metadata only, not source evidence')
    tableRowLabel: str = Field(description='Adapter-generated row label from packetized input; metadata only, not source evidence')
    subjectColumnIndex: int = Field(description='Zero-based table column containing the exact subject cell; -1 for prose facts')
    columnIndex: int = Field(description='Zero-based table column containing the exact value cell; -1 for prose facts')


class RelationCandidate(BaseModel):
    participants: list[str] = Field(
        min_length=2,
        description='At least two distinct exact source names; duplicate values are rejected by the validator',
    )
    predicate: str = Field(description='Candidate relation predicate; not source evidence')
    description: str = Field(description='Optional paraphrase; never evidence')
    evidenceQuote: str = Field(description='Exact prose quote containing all participants and an explicit relation cue')
    relationCue: str = Field(description='Exact relation wording copied from evidenceQuote')


class EvidenceOutput(BaseModel):
    factCandidates: list[FactCandidate] = Field(description='Source-evidence-bearing fact candidates')
    relationCandidates: list[RelationCandidate] = Field(description='Explicit prose relation candidates only')
