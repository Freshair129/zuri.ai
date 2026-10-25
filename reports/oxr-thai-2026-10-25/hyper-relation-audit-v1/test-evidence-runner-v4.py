from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).with_name('extract-evidence-native-v4.py')
SPEC = importlib.util.spec_from_file_location('extract_evidence_native_v4', RUNNER_PATH)
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


if __name__ == '__main__':
    unittest.main()
