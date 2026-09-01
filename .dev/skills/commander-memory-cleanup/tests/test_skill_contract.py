from __future__ import annotations

import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


class CommanderMemoryCleanupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_uses_happyherd_authority_without_legacy_herd_contracts(self) -> None:
        for retired in (
            "$HERD_COMMANDER_ID",
            "~/.herd",
            "herd quests",
            "herd commander transcripts",
            "PROPOSE-SHARED",
            "Proposal Files",
        ):
            with self.subTest(retired=retired):
                self.assertNotIn(retired, self.text)

        for current in ("HAPPY_HOME_DIR", "`happy` owns", "`happyherd` owns"):
            with self.subTest(current=current):
                self.assertIn(current, self.text)

    def test_preserves_semantic_agent_boundary(self) -> None:
        required = (
            "one fresh, independent agent invocation per Commander",
            "The launcher is a loop that invokes `codex exec`",
            "deterministic code may only\ninventory, enumerate opaque IDs, stage, invoke, validate",
            "must never prefill or infer a disposition",
            "must never repair prose or make a semantic",
            "A zero-change result is valid",
        )
        for phrase in required:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)

    def test_keeps_immutable_and_report_only_boundaries_explicit(self) -> None:
        required = (
            "`COMMANDER.md` is immutable in every mode",
            "`0-observations.jsonl` is byte-immutable in observer and `claude-import`",
            "A reflector may change staged L1 only to merge same-topic medium",
            "Claude import source files and their inventory are immutable",
            "Shared or project knowledge is report-only",
            "coverage row per source item ID",
            "Coverage sidecars are ephemeral",
        )
        for phrase in required:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)

    def test_documents_installed_entrypoint_and_timeout_margin(self) -> None:
        for phrase in (
            "/home/ec2-user/.claude/skills/commander-memory-cleanup/scripts/memory-reflector.py",
            "18,000 seconds (300 minutes)",
            "21,600-second (360-minute) outer timeout",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)

    def test_documents_three_wide_and_unbounded_execution_contract(self) -> None:
        for phrase in (
            "`--max-concurrency` accepts only 1, 2, or 3",
            "never starts a fourth\nlive child process group",
            "only\nafter every Commander worker in the current batch has completed",
            "Explicit `--no-timeout`\ndisables every per-Commander, correction, audit, and fleet deadline",
            "locked active\nchild registry covers every concurrent process group",
            "prevent queued workers from launching",
            "public\n  Commander/correction output remains in frozen roster order",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)

    def test_documents_fleet_hardening_and_audit_attestation(self) -> None:
        for phrase in (
            "rejects symlinks anywhere below each canonical Commander root",
            "last successfully published digest",
            "original run's exact L1/L2/L3 bytes",
            "every Commander × L1/L2/L3 × before/after snapshot",
            "auditor's final response carries only its nonce/digest/count",
            "Audit evidence remains outside the dedicated",
            "A pass is valid only when every",
            "Final stdout exposes only",
            "hard byte cap",
            "TERM-ignoring descendants",
            "rolls every replaced file back",
            "reached without symlinks beneath the real Commander-private",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)


if __name__ == "__main__":
    unittest.main()
