from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).with_name('extract-evidence-native-v5.py')
SPEC = importlib.util.spec_from_file_location('extract_evidence_native_v5', RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ProgressSummaryTests(unittest.TestCase):
    def test_zero_calls_with_unstarted_null_responses(self) -> None:
        summary = RUNNER.progress_summary([{
            'chunks': [
                {'callResponse': None, 'structuredResponse': None},
                {'callResponse': None, 'structuredResponse': None},
            ],
        }])
        self.assertEqual(summary, {
            'responseCount': 0,
            'structuredChunkCount': 0,
            'thinkingObserved': False,
        })

    def test_one_call_progress_tolerates_other_unstarted_null_chunk(self) -> None:
        summary = RUNNER.progress_summary([{
            'chunks': [
                {
                    'callResponse': {'done': True, 'done_reason': 'stop', 'thinkingPresent': False},
                    'structuredResponse': {'factCandidates': [], 'relationCandidates': []},
                },
                {'callResponse': None, 'structuredResponse': None},
            ],
        }])
        self.assertEqual(summary, {
            'responseCount': 1,
            'structuredChunkCount': 1,
            'thinkingObserved': False,
        })

    def test_complete_pass_aggregates_all_responses(self) -> None:
        summary = RUNNER.progress_summary([{
            'chunks': [
                {
                    'callResponse': {'done': True, 'done_reason': 'stop', 'thinkingPresent': False},
                    'structuredResponse': {},
                },
                {
                    'callResponse': {'done': True, 'done_reason': 'stop', 'thinkingPresent': True},
                    'structuredResponse': {},
                },
            ],
        }])
        self.assertEqual(summary, {
            'responseCount': 2,
            'structuredChunkCount': 2,
            'thinkingObserved': True,
        })

    def test_length_finished_response_is_not_complete(self) -> None:
        self.assertFalse(RUNNER.response_is_complete({'done': True, 'done_reason': 'length'}))
        self.assertFalse(RUNNER.response_is_complete({'done': False, 'done_reason': 'stop'}))
        self.assertFalse(RUNNER.response_is_complete(None))
        self.assertTrue(RUNNER.response_is_complete({'done': True, 'done_reason': 'stop'}))

    def test_budgeted_schema_keeps_cardinality_and_candidate_limits(self) -> None:
        schema = RUNNER.EvidenceOutput.model_json_schema()
        self.assertEqual(schema['properties']['factCandidates']['maxItems'], 8)
        self.assertEqual(schema['properties']['relationCandidates']['maxItems'], 4)
        self.assertEqual(schema['$defs']['RelationCandidate']['properties']['participants']['minItems'], 2)
        self.assertEqual(schema['$defs']['FactCandidate']['properties']['evidenceQuote']['maxLength'], 800)

    def test_pydantic_rejects_output_over_candidate_budget(self) -> None:
        fact = {
            'kind': 'table_row', 'subject': 'A', 'predicate': 'has', 'value': '1',
            'description': '', 'evidenceQuote': '', 'predicateCue': '', 'rowQuote': 'A\t1',
            'headerQuote': 'Value', 'tableId': 't', 'tableRowLabel': 'packet row 1',
            'subjectColumnIndex': 0, 'columnIndex': 1,
        }
        relation = {
            'participants': ['A', 'B'], 'predicate': 'states', 'description': '',
            'evidenceQuote': 'A states B.', 'relationCue': 'states',
        }
        with self.assertRaises(ValueError):
            RUNNER.EvidenceOutput.model_validate({'factCandidates': [fact] * 9, 'relationCandidates': []})
        with self.assertRaises(ValueError):
            RUNNER.EvidenceOutput.model_validate({'factCandidates': [], 'relationCandidates': [relation] * 5})


if __name__ == '__main__':
    unittest.main()
