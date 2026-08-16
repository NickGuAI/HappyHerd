from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo


SCRIPT = Path(__file__).resolve().parents[1] / "memory-observer.py"
SPEC = importlib.util.spec_from_file_location("memory_observer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
memory_observer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = memory_observer
SPEC.loader.exec_module(memory_observer)


class MemoryObserverTest(unittest.TestCase):
    def test_defaults_to_previous_complete_new_york_day(self) -> None:
        now = datetime(2026, 8, 10, 3, 0, tzinfo=ZoneInfo("America/New_York"))

        window = memory_observer.resolve_window(None, None, None, now=now)

        self.assertEqual(window.since, date(2026, 8, 9))
        self.assertEqual(window.until, date(2026, 8, 9))

    def test_accepts_single_day_and_bounded_range(self) -> None:
        single = memory_observer.resolve_window(date(2026, 6, 1), None, None)
        weekly = memory_observer.resolve_window(
            None, date(2026, 6, 1), date(2026, 6, 7)
        )

        self.assertEqual(single.days, 1)
        self.assertEqual(weekly.days, 7)

    def test_rejects_partial_reversed_or_oversized_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "provided together"):
            memory_observer.resolve_window(None, date(2026, 6, 1), None)
        with self.assertRaisesRegex(ValueError, "on or after"):
            memory_observer.resolve_window(
                None, date(2026, 6, 8), date(2026, 6, 1)
            )
        with self.assertRaisesRegex(ValueError, "maximum is 14"):
            memory_observer.resolve_window(
                None, date(2026, 6, 1), date(2026, 6, 15)
            )

    def test_prompt_bounds_both_sources_and_l1_only(self) -> None:
        window = memory_observer.EvidenceWindow(
            date(2026, 6, 1), date(2026, 6, 7)
        )

        prompt = memory_observer.build_prompt(window)

        self.assertIn(memory_observer.CLAUDE_SESSIONS, prompt)
        self.assertIn(memory_observer.CODEX_SESSIONS, prompt)
        self.assertIn("[2026-06-01T04:00:00Z, 2026-06-08T04:00:00Z)", prompt)
        self.assertIn("Write L1 only", prompt)
        self.assertIn("Do not spawn subagents", prompt)
        self.assertIn("Do not create candidate JSONL", prompt)
        self.assertIn("Mandatory low-memory scan order", prompt)
        self.assertIn(
            '\"timestamp\"[[:space:]]*:[[:space:]]*\"(2026-06-01|2026-06-02',
            prompt,
        )
        self.assertIn("Do not search for bare date strings", prompt)
        self.assertIn("Never read or summarize excluded sidechain content", prompt)
        self.assertIn("parent_thread_id", prompt)
        self.assertIn("physical first line only", prompt)
        self.assertIn("calls, tool outputs, reasoning", prompt)
        self.assertIn("first 240 characters", prompt)
        self.assertIn("emit more than 12 KiB", prompt)
        self.assertIn("HappyHerd is the current system", prompt)
        self.assertIn("predecessor-system implementation fact", prompt)
        self.assertIn("final observation must be fully de-branded", prompt)
        self.assertIn("run's final diff must contain no predecessor identifier", prompt)
        self.assertIn("exact idempotency pair", prompt)
        self.assertIn("partition is already consumed", prompt)
        self.assertIn("L1 is the daily evidence layer, not", prompt)
        self.assertIn("Multiple L1 records may share this partition pair", prompt)
        self.assertIn("pipeline ending in `head`", prompt)
        self.assertIn("rg -Fq", prompt)
        self.assertIn("material daily task flow", prompt)
        self.assertIn("completed deliverable", prompt)
        self.assertIn("specific one-off debug result", prompt)
        self.assertIn("A partial task is material only", prompt)
        self.assertIn("A request with no assistant", prompt)
        self.assertIn("investigation with no finding", prompt)
        self.assertIn("does not become noise merely because it completed", prompt)
        self.assertIn("suppress an observation because its meaning", prompt)
        self.assertIn("Retention, semantic merging, and promotion belong", prompt)
        self.assertIn("must be byte-identical at L1", prompt)

    @mock.patch.object(memory_observer.shutil, "which", return_value="/usr/bin/codex")
    @mock.patch.object(memory_observer.subprocess, "run")
    def test_invokes_one_ephemeral_codex_agent_for_the_window(
        self, run: mock.Mock, _which: mock.Mock
    ) -> None:
        window = memory_observer.EvidenceWindow(
            date(2026, 6, 1), date(2026, 6, 7)
        )

        memory_observer.run_codex(window)

        run.assert_called_once()
        args, kwargs = run.call_args
        self.assertEqual(
            args[0],
            [
                "codex",
                "exec",
                "--ephemeral",
                "-C",
                memory_observer.WORKSPACE,
                "--sandbox",
                "workspace-write",
                "-c",
                'approval_policy="never"',
                "-c",
                'model_reasoning_effort="max"',
                "--skip-git-repo-check",
                "-",
            ],
        )
        self.assertTrue(kwargs["check"])
        self.assertTrue(kwargs["text"])
        self.assertEqual(kwargs["env"]["HAPPY_HOME_DIR"], memory_observer.HAPPY_HOME)
        self.assertIn("2026-06-01 through 2026-06-07", kwargs["input"])

    @mock.patch.object(memory_observer.shutil, "which", return_value="/usr/bin/codex")
    @mock.patch.object(
        memory_observer.subprocess,
        "run",
        side_effect=subprocess.CalledProcessError(9, ["codex"]),
    )
    def test_codex_failure_is_not_swallowed(
        self, _run: mock.Mock, _which: mock.Mock
    ) -> None:
        window = memory_observer.EvidenceWindow(
            date(2026, 6, 1), date(2026, 6, 7)
        )

        with self.assertRaises(subprocess.CalledProcessError):
            memory_observer.run_codex(window)


if __name__ == "__main__":
    unittest.main()
