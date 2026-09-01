from __future__ import annotations

import argparse
import contextlib
import copy
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "memory-reflector.py"
SPEC = importlib.util.spec_from_file_location("memory_reflector", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
memory_reflector = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = memory_reflector
SPEC.loader.exec_module(memory_reflector)


def create_commander(
    home: Path, commander_id: str, name: str
) -> memory_reflector.Commander:
    root = home / "commanders" / commander_id
    memory = root / "agentcontext" / "memory"
    memory.mkdir(parents=True)
    commander_file = root / "COMMANDER.md"
    l1_file = memory / memory_reflector.L1_NAME
    l2_file = memory / memory_reflector.L2_NAME
    l3_file = memory / memory_reflector.L3_NAME
    commander_file.write_text(f"# {name}\n", encoding="utf-8")
    l1_file.write_text("", encoding="utf-8")
    l2_file.write_text("# Working\n", encoding="utf-8")
    l3_file.write_text("# Durable\n", encoding="utf-8")
    return memory_reflector.Commander(
        commander_id,
        name,
        root,
        commander_file,
        l1_file,
        l2_file,
        l3_file,
    )


def l1_bytes(*records: dict[str, object]) -> bytes:
    return b"".join(
        json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
        + b"\n"
        for record in records
    )


def observation(tier: str, text: str, day: int) -> dict[str, object]:
    return {
        "ts": f"2026-08-{day:02d}T12:00:00Z",
        "tier": tier,
        "text": text,
        "source": "test-observer",
        "refs": [],
    }


def valid_report(
    commander: memory_reflector.Commander,
    before: dict[str, str],
    staged: dict[str, str],
    mode: str = "reflector",
    *,
    inventory: dict[str, object] | None = None,
    coverage_attestation: dict[str, object] | None = None,
    l1_retention: dict[str, object] | None = None,
) -> dict[str, object]:
    report: dict[str, object] = {
        "schema_version": memory_reflector.SCHEMA_VERSION,
        "prompt_version": memory_reflector.PROMPT_VERSION,
        "mode": mode,
        "commander_id": commander.commander_id,
        "commander_name": commander.name,
        "status": "success",
        "changes": {
            "l1_changed": staged["l1"] != before["l1"],
            "l2_changed": staged["l2"] != before["l2"],
            "l3_changed": staged["l3"] != before["l3"],
        },
        "counts": {
            "l2_kept_or_added": 1,
            "l3_kept_or_added": 1,
            "shared_reported": 0,
            "project_reported": 0,
            "dropped": 0,
        },
        "hashes": {
            "commander_before": before["commander"],
            "commander_after": before["commander"],
            "l1_before": before["l1"],
            "l1_after": staged["l1"],
            "l2_before": before["l2"],
            "l2_after": staged["l2"],
            "l3_before": before["l3"],
            "l3_after": staged["l3"],
        },
        "files_examined": [str(commander.commander_file)],
        "shared_candidates": [],
        "project_candidates": [],
        "uncertainties": [],
        "blockers": [],
    }
    if mode == "reflector":
        report["l1_retention"] = l1_retention or {
            "merged_medium": [],
            "removed_rule_promoted": [],
            "removed_expired_low": [],
            "observer_contract_breaches": [],
        }
    if inventory is not None:
        if coverage_attestation is None:
            raise AssertionError("coverage_attestation is required with inventory")
        report["inventory"] = {
            "aggregate_sha256": inventory["aggregate_sha256"],
            "files_expected": inventory["file_count"],
            "bytes_expected": inventory["byte_count"],
            "files_examined": inventory["file_count"],
            "bytes_examined": inventory["byte_count"],
            "items_expected": inventory["item_count"],
            "items_examined": inventory["item_count"],
            "indexed_items": inventory["indexed_item_count"],
            "inline_only_items": inventory["inline_only_item_count"],
            "unindexed_items": inventory["unindexed_item_count"],
        }
        report["coverage_attestation"] = coverage_attestation
    return report


def valid_model_report(*args, **kwargs) -> dict[str, object]:
    report = valid_report(*args, **kwargs)
    report["counts"].pop("shared_reported")
    report["counts"].pop("project_reported")
    return report


def fill_source_coverage(path: Path) -> None:
    payload = json.loads(path.read_bytes())
    for row in payload["coverage"]:
        row["dispositions"] = ["NOT_RELEVANT"]
    path.write_bytes(memory_reflector.canonical_json(payload) + b"\n")


def create_inventory(root: Path, item_count: int) -> dict[str, object]:
    root.mkdir()
    (root / "MEMORY.md").write_text(
        "".join(f"- Source fact {index}.\n" for index in range(item_count)),
        encoding="utf-8",
    )
    return memory_reflector.build_inventory([root])


def audit_coverage_attestation(
    inventory: dict[str, object] | None,
    snapshots: list[dict[str, str]],
    *,
    run_nonce: str = "a" * 64,
    sidecar_sha256: str = "b" * 64,
) -> dict[str, object]:
    item_count = 0 if inventory is None else int(inventory["item_count"])
    return {
        "schema_version": memory_reflector.COVERAGE_SCHEMA_VERSION,
        "run_nonce": run_nonce,
        "sidecar_sha256": sidecar_sha256,
        "inventory_sha256": (
            "" if inventory is None else inventory["aggregate_sha256"]
        ),
        "source_items_expected": item_count,
        "source_items_examined": item_count,
        "snapshots_expected": len(snapshots),
        "snapshots_examined": len(snapshots),
    }


def audit_report(
    commanders: list[memory_reflector.Commander],
    *,
    status: str,
    correction_ids: list[str],
    findings: list[dict[str, object]],
    mode: str = "reflector",
    inventory: dict[str, object] | None = None,
    snapshots: list[dict[str, str]] | None = None,
    coverage_attestation: dict[str, object] | None = None,
) -> dict[str, object]:
    semantic_checks = {key: True for key in memory_reflector.AUDIT_SEMANTIC_CHECKS}
    by_kind = {
        finding_kind: check
        for check, finding_kind in memory_reflector.AUDIT_SEMANTIC_CHECKS.items()
    }
    for finding in findings:
        if finding["severity"] == "blocking" and finding["kind"] in by_kind:
            semantic_checks[by_kind[finding["kind"]]] = False
    exact_snapshots = snapshots or snapshot_attestation(commanders)
    return {
        "schema_version": memory_reflector.SCHEMA_VERSION,
        "prompt_version": memory_reflector.PROMPT_VERSION,
        "mode": mode,
        "status": status,
        "commanders_expected": len(commanders),
        "commander_ids": [item.commander_id for item in commanders],
        "inventory_attestation": memory_reflector._expected_inventory_attestation(
            inventory
        ),
        "coverage_attestation": coverage_attestation
        or audit_coverage_attestation(inventory, exact_snapshots),
        "semantic_checks": semantic_checks,
        "correction_commander_ids": correction_ids,
        "findings": findings,
    }


def snapshot_attestation(
    commanders: list[memory_reflector.Commander],
) -> list[dict[str, str]]:
    snapshots: list[dict[str, str]] = []
    for commander in commanders:
        for tier, path in (
            ("l1", commander.l1_file),
            ("l2", commander.l2_file),
            ("l3", commander.l3_file),
        ):
            digest = memory_reflector.sha256_file(path)
            for phase in ("before", "after"):
                snapshots.append(
                    {
                        "snapshot_id": memory_reflector._snapshot_id(
                            commander.commander_id, tier, phase
                        ),
                        "sha256": digest,
                    }
                )
    return snapshots


def blocking_finding(*commander_ids: str) -> dict[str, object]:
    return {
        "severity": "blocking",
        "kind": "agent_failure",
        "summary": "One Commander needs a correction pass.",
        "source_item_ids": [],
        "commander_ids": list(commander_ids),
        "evidence": [f"commander:{commander_ids[0]}"],
    }


def success_result(commander: memory_reflector.Commander) -> memory_reflector.CommanderResult:
    hashes = memory_reflector._hash_snapshot(commander)
    return memory_reflector.CommanderResult(
        commander.commander_id,
        commander.name,
        True,
        report={
            "status": "success",
            "changes": {
                "l1_changed": False,
                "l2_changed": False,
                "l3_changed": False,
            },
            "counts": {},
            "hashes": {
                "commander_before": hashes["commander"],
                "commander_after": hashes["commander"],
                "l1_before": hashes["l1"],
                "l1_after": hashes["l1"],
                "l2_before": hashes["l2"],
                "l2_after": hashes["l2"],
                "l3_before": hashes["l3"],
                "l3_after": hashes["l3"],
            },
        },
    )


class InventoryTests(unittest.TestCase):
    def test_inventory_tracks_indexed_inline_and_unindexed_items(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "memory"
            root.mkdir()
            (root / "MEMORY.md").write_text(
                "# Memory\n\n- [Linked fact](linked.md)\n- Inline-only fact\n",
                encoding="utf-8",
            )
            (root / "linked.md").write_text("# Linked\n\nFact.\n", encoding="utf-8")
            (root / "unindexed.md").write_text(
                "# Unindexed\n\nAnother fact.\n", encoding="utf-8"
            )

            inventory = memory_reflector.build_inventory([root])
            memory_reflector.validate_inventory_shape(inventory)
            memory_reflector.verify_inventory_files(inventory)

            self.assertEqual(inventory["file_count"], 3)
            self.assertEqual(inventory["item_count"], 3)
            self.assertEqual(inventory["indexed_item_count"], 1)
            self.assertEqual(inventory["inline_only_item_count"], 1)
            self.assertEqual(inventory["unindexed_item_count"], 1)
            by_origin = {item["origin"]: item for item in inventory["items"]}
            self.assertEqual(by_origin["indexed"]["linked_files"], ["linked.md"])
            self.assertEqual(by_origin["unindexed"]["relative_path"], "unindexed.md")
            self.assertTrue(
                all(memory_reflector.HASH_RE.fullmatch(item["item_id"]) for item in inventory["items"])
            )

    def test_inventory_detects_added_or_changed_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "memory"
            root.mkdir()
            (root / "MEMORY.md").write_text("- Inline fact\n", encoding="utf-8")
            inventory = memory_reflector.build_inventory([root])

            (root / "new.md").write_text("new\n", encoding="utf-8")
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.verify_inventory_files(inventory)
            self.assertEqual(raised.exception.code, "source_inventory_changed")

    def test_agent_report_requires_exact_item_level_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "MEMORY.md").write_text(
                "- [Linked](linked.md)\n- Inline\n", encoding="utf-8"
            )
            (source / "linked.md").write_text("linked\n", encoding="utf-8")
            (source / "loose.md").write_text("loose\n", encoding="utf-8")
            inventory = memory_reflector.build_inventory([source])
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_bytes(commander.l2_file.read_bytes())
            (workspace / memory_reflector.L3_NAME).write_bytes(commander.l3_file.read_bytes())
            run_nonce = "c" * 64
            coverage_path = workspace / memory_reflector.SOURCE_COVERAGE_NAME
            memory_reflector.write_control_json(
                coverage_path,
                memory_reflector._source_coverage_skeleton(
                    commander, inventory, run_nonce
                ),
            )
            fill_source_coverage(coverage_path)
            staged, staged_l1 = memory_reflector._validate_stage(
                workspace,
                "claude-import",
                65536,
                commander.l1_file.read_bytes(),
                expect_source_coverage=True,
            )
            coverage, coverage_attestation = (
                memory_reflector._validate_source_coverage_sidecar(
                    coverage_path, commander, inventory, run_nonce, staged
                )
            )
            report = valid_report(
                commander,
                before,
                staged,
                "claude-import",
                inventory=inventory,
                coverage_attestation=coverage_attestation,
            )

            memory_reflector.validate_agent_report(
                report,
                commander,
                "claude-import",
                before,
                staged,
                inventory,
                coverage_attestation,
                commander.l1_file.read_bytes(),
                staged_l1,
            )

            duplicate = copy.deepcopy(coverage)
            duplicate["coverage"][-1]["item_id"] = duplicate["coverage"][0]["item_id"]
            coverage_path.write_bytes(memory_reflector.canonical_json(duplicate) + b"\n")
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_source_coverage_sidecar(
                    coverage_path, commander, inventory, run_nonce, staged
                )
            self.assertEqual(raised.exception.code, "agent_report_coverage_invalid")

            mixed = copy.deepcopy(coverage)
            mixed["coverage"][0]["dispositions"] = ["NOT_RELEVANT", "L2"]
            coverage_path.write_bytes(memory_reflector.canonical_json(mixed) + b"\n")
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_source_coverage_sidecar(
                    coverage_path, commander, inventory, run_nonce, staged
                )
            self.assertEqual(raised.exception.code, "agent_report_coverage_invalid")

    def test_224_item_sidecar_keeps_terminal_schemas_compact_and_validates_quickly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory = create_inventory(root / "source-224", 224)
            small_inventory = create_inventory(root / "source-1", 1)
            self.assertEqual(inventory["item_count"], 224)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            nonce = "d" * 64
            large_schema = memory_reflector.build_agent_schema(
                commander, "claude-import", before, inventory, nonce
            )
            small_schema = memory_reflector.build_agent_schema(
                commander, "claude-import", before, small_inventory, nonce
            )
            large_schema_bytes = memory_reflector.canonical_json(large_schema)
            small_schema_bytes = memory_reflector.canonical_json(small_schema)
            self.assertLess(len(large_schema_bytes), 16 * 1024)
            self.assertLess(abs(len(large_schema_bytes) - len(small_schema_bytes)), 256)
            self.assertNotIn(b'"coverage"', large_schema_bytes)
            for item in inventory["items"]:
                self.assertNotIn(item["item_id"].encode("ascii"), large_schema_bytes)

            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_bytes(commander.l2_file.read_bytes())
            (workspace / memory_reflector.L3_NAME).write_bytes(commander.l3_file.read_bytes())
            coverage_path = workspace / memory_reflector.SOURCE_COVERAGE_NAME
            memory_reflector.write_control_json(
                coverage_path,
                memory_reflector._source_coverage_skeleton(
                    commander, inventory, nonce
                ),
            )
            fill_source_coverage(coverage_path)
            staged, _staged_l1 = memory_reflector._validate_stage(
                workspace,
                "claude-import",
                65536,
                commander.l1_file.read_bytes(),
                expect_source_coverage=True,
            )
            started = time.monotonic()
            coverage, attestation = memory_reflector._validate_source_coverage_sidecar(
                coverage_path, commander, inventory, nonce, staged
            )
            elapsed = time.monotonic() - started
            self.assertEqual(len(coverage["coverage"]), 224)
            self.assertEqual(attestation["items_examined"], 224)
            self.assertLess(coverage_path.stat().st_size, 64 * 1024)
            self.assertLess(elapsed, 1.0)

            commanders = [
                create_commander(root / "audit-home", f"c{index}-id", f"C{index}")
                for index in range(9)
            ]
            snapshots = [
                {
                    "snapshot_id": memory_reflector._snapshot_id(
                        item.commander_id, tier, phase
                    ),
                    "sha256": memory_reflector.sha256_bytes(
                        f"{item.commander_id}:{tier}:{phase}".encode("utf-8")
                    ),
                }
                for item in commanders
                for tier in ("l1", "l2", "l3")
                for phase in ("before", "after")
            ]
            audit_schema = memory_reflector.build_audit_schema(
                "claude-import", commanders, inventory, snapshots, nonce
            )
            audit_schema_bytes = memory_reflector.canonical_json(audit_schema)
            self.assertEqual(len(snapshots), 54)
            self.assertLess(len(audit_schema_bytes), 16 * 1024)
            for item in inventory["items"]:
                self.assertNotIn(item["item_id"].encode("ascii"), audit_schema_bytes)
            for snapshot in snapshots:
                self.assertNotIn(snapshot["snapshot_id"].encode("ascii"), audit_schema_bytes)

    def test_source_coverage_rejects_unfilled_unknown_and_binding_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory = create_inventory(root / "source", 3)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            nonce = "e" * 64
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_bytes(commander.l2_file.read_bytes())
            (workspace / memory_reflector.L3_NAME).write_bytes(commander.l3_file.read_bytes())
            path = workspace / memory_reflector.SOURCE_COVERAGE_NAME
            memory_reflector.write_control_json(
                path,
                memory_reflector._source_coverage_skeleton(
                    commander, inventory, nonce
                ),
            )
            fill_source_coverage(path)
            staged, staged_l1 = memory_reflector._validate_stage(
                workspace,
                "claude-import",
                65536,
                commander.l1_file.read_bytes(),
                expect_source_coverage=True,
            )
            valid, attestation = memory_reflector._validate_source_coverage_sidecar(
                path, commander, inventory, nonce, staged
            )

            mutations: dict[str, object] = {}
            candidate = copy.deepcopy(valid)
            candidate["coverage"].pop()
            mutations["missing-row"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"].append(copy.deepcopy(candidate["coverage"][-1]))
            mutations["extra-row"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"][0]["item_id"] = "f" * 64
            mutations["unknown-id"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"].reverse()
            mutations["wrong-order"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"][0]["dispositions"] = []
            mutations["unfilled"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"][0]["dispositions"] = ["UNKNOWN"]
            mutations["unknown-label"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["coverage"][0]["dispositions"] = ["L2", "L2"]
            mutations["duplicate-label"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["inventory_sha256"] = "0" * 64
            mutations["inventory-mismatch"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["schema_version"] = True
            mutations["schema-version-boolean"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["items_expected"] = 2
            mutations["count-mismatch"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["run_nonce"] = "0" * 64
            mutations["nonce-mismatch"] = candidate
            candidate = copy.deepcopy(valid)
            candidate["extra"] = True
            mutations["extra-key"] = candidate

            for label, payload in mutations.items():
                with self.subTest(label=label):
                    path.write_bytes(memory_reflector.canonical_json(payload) + b"\n")
                    with self.assertRaises(memory_reflector.LauncherError) as raised:
                        memory_reflector._validate_source_coverage_sidecar(
                            path, commander, inventory, nonce, staged
                        )
                    self.assertEqual(
                        raised.exception.code, "agent_report_coverage_invalid"
                    )

            path.write_bytes(memory_reflector.canonical_json(valid) + b"\n")
            before = memory_reflector._hash_snapshot(commander)
            report = valid_report(
                commander,
                before,
                staged,
                "claude-import",
                inventory=inventory,
                coverage_attestation=attestation,
            )
            for label, field, value in (
                ("sidecar-hash", "sidecar_sha256", "0" * 64),
                ("examined-count", "items_examined", 2),
                ("inventory-hash", "inventory_sha256", "0" * 64),
                ("run-nonce", "run_nonce", "0" * 64),
                ("schema-version-boolean", "schema_version", True),
            ):
                with self.subTest(final_attestation=label):
                    changed = copy.deepcopy(report)
                    changed["coverage_attestation"][field] = value
                    with self.assertRaises(memory_reflector.LauncherError) as raised:
                        memory_reflector.validate_agent_report(
                            changed,
                            commander,
                            "claude-import",
                            before,
                            staged,
                            inventory,
                            attestation,
                            commander.l1_file.read_bytes(),
                            staged_l1,
                        )
                    self.assertEqual(
                        raised.exception.code, "agent_report_coverage_invalid"
                    )
            changed = copy.deepcopy(report)
            changed["coverage_attestation"]["stage_sha256"]["l2"] = "0" * 64
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.validate_agent_report(
                    changed,
                    commander,
                    "claude-import",
                    before,
                    staged,
                    inventory,
                    attestation,
                    commander.l1_file.read_bytes(),
                    staged_l1,
                )
            self.assertEqual(
                raised.exception.code, "agent_report_coverage_invalid"
            )

    def test_coverage_sidecar_rejects_unsafe_files_encoding_secrets_and_races(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "coverage.json"
            valid = b'{"schema_version":1}\n'

            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")

            path.mkdir()
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")
            path.rmdir()

            target = root / "target.json"
            target.write_bytes(valid)
            path.symlink_to(target)
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")
            path.unlink()

            os.link(target, path)
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")
            path.unlink()
            target.unlink()

            path.write_bytes(b"x" * (memory_reflector.MAX_COVERAGE_SIDECAR_BYTES + 1))
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")

            path.write_bytes(b"\xff")
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")

            synthetic_secret = "AKIA" + "A" * 16
            path.write_text(json.dumps({"value": synthetic_secret}), encoding="utf-8")
            with self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")

            path.write_bytes(valid)
            opened = path.stat()
            changed = mock.Mock(
                st_dev=opened.st_dev,
                st_ino=opened.st_ino,
                st_size=opened.st_size,
                st_mtime_ns=opened.st_mtime_ns + 1,
                st_ctime_ns=opened.st_ctime_ns,
                st_nlink=opened.st_nlink,
            )
            with mock.patch.object(
                memory_reflector.os, "fstat", side_effect=[opened, changed]
            ), self.assertRaises(memory_reflector.LauncherError):
                memory_reflector._read_coverage_sidecar(path, "invalid")


class DiscoveryAndCommandTests(unittest.TestCase):
    def test_roster_comes_from_supported_happy_cli_and_is_sorted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            second = create_commander(home, "b-id", "Beta")
            first = create_commander(home, "a-id", "Alpha")
            payload = {
                "commanders": [
                    {
                        "id": second.commander_id,
                        "name": second.name,
                        "commanderPath": str(second.commander_file),
                    },
                    {
                        "id": first.commander_id,
                        "name": first.name,
                        "commanderPath": str(first.commander_file),
                    },
                ]
            }
            completed = subprocess.CompletedProcess(
                ["happy"], 0, stdout=json.dumps(payload).encode("utf-8")
            )
            with mock.patch.object(
                memory_reflector.subprocess, "run", return_value=completed
            ) as run:
                commanders = memory_reflector.discover_commanders(["happy"], home)

            self.assertEqual([item.commander_id for item in commanders], ["a-id", "b-id"])
            self.assertEqual(run.call_args.args[0], ["happy", "commander", "list", "--json"])

    def test_roster_rejects_intermediate_memory_directory_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commander = create_commander(home, "a-id", "Alpha")
            memory_root = commander.l1_file.parent
            outside = Path(temporary) / "outside-memory"
            memory_root.rename(outside)
            memory_root.symlink_to(outside, target_is_directory=True)
            payload = {
                "commanders": [
                    {
                        "id": commander.commander_id,
                        "name": commander.name,
                        "commanderPath": str(commander.commander_file),
                    }
                ]
            }
            completed = subprocess.CompletedProcess(
                ["happy"], 0, stdout=json.dumps(payload).encode("utf-8")
            )

            with mock.patch.object(
                memory_reflector.subprocess, "run", return_value=completed
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.discover_commanders(["happy"], home)

            self.assertEqual(raised.exception.code, "commander_path_invalid")

    def test_agent_command_is_ephemeral_isolated_and_model_pinned(self) -> None:
        command = memory_reflector.codex_exec_command(
            ["codex"],
            Path("/stage/workspace"),
            Path("/stage/control/schema.json"),
            Path("/stage/control/last.json"),
            "workspace-write",
            "gpt-test-model",
        )

        for flag in (
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--json",
            "--output-schema",
        ):
            self.assertEqual(command.count(flag), 1)
        self.assertEqual(command[command.index("--model") + 1], "gpt-test-model")
        self.assertEqual(command[command.index("--sandbox") + 1], "workspace-write")
        self.assertIn(
            "sandbox_workspace_write.exclude_tmpdir_env_var=true", command
        )
        self.assertIn("sandbox_workspace_write.exclude_slash_tmp=true", command)
        self.assertEqual(command[-1], "-")

        read_only = memory_reflector.codex_exec_command(
            ["codex"],
            Path("/stage/workspace"),
            Path("/stage/control/schema.json"),
            Path("/stage/control/last.json"),
            "read-only",
            "gpt-test-model",
        )
        self.assertNotIn(
            "sandbox_workspace_write.exclude_tmpdir_env_var=true", read_only
        )
        self.assertNotIn("sandbox_workspace_write.exclude_slash_tmp=true", read_only)

    def test_codex_environment_scrubs_session_and_happy_runtime_state(self) -> None:
        source = {
            "PATH": "/safe/bin",
            "CODEX_BIN": "/safe/codex",
            "HOME": "/safe/home",
            "CODEX_HOME": "/safe/codex-home",
            "GEMINI_API_KEY": "remove",
            "GOG_KEYRING_PASSWORD": "remove",
            "HAPPYHERD_SESSION": "remove",
            "HAPPY_RECONNECT_TOKEN": "remove",
            "HAPPY_FORKED_FROM": "remove",
            "HAPPY_HOME_DIR": "/private/home",
            "HAPPY_CLI_BIN": "/private/happy",
            "HAPPY_SIDE_CHAT": "remove",
            "CODEX_THREAD_ID": "remove",
            "CODEX_GOAL_ID": "remove",
            "CODEX_SESSION_ID": "remove",
        }

        isolated = memory_reflector.isolated_codex_env(source)

        self.assertEqual(
            isolated,
            {
                "PATH": "/safe/bin",
                "HOME": "/safe/home",
                "CODEX_HOME": "/safe/codex-home",
            },
        )

    def test_codex_cli_canary_uses_isolated_env_and_requires_launcher_flags(self) -> None:
        help_text = b" ".join(
            (
                b"--ephemeral",
                b"--json",
                b"--ignore-user-config",
                b"--ignore-rules",
                b"--output-schema",
                b"--output-last-message",
            )
        )
        completed = subprocess.CompletedProcess(
            ["codex", "exec", "--help"], 0, stdout=help_text
        )
        with mock.patch.object(
            memory_reflector.subprocess, "run", return_value=completed
        ) as run, mock.patch.object(
            memory_reflector,
            "isolated_codex_env",
            return_value={"CODEX_HOME": "/safe/auth-home"},
        ):
            memory_reflector.validate_codex_cli(["codex"])

        self.assertEqual(run.call_args.args[0], ["codex", "exec", "--help"])
        self.assertEqual(
            run.call_args.kwargs["env"], {"CODEX_HOME": "/safe/auth-home"}
        )

    def test_default_fleet_budget_keeps_sixty_minute_outer_margin(self) -> None:
        args = memory_reflector.build_parser().parse_args(["weekly"])

        self.assertEqual(args.fleet_timeout_seconds, 18_000)
        self.assertEqual(21_600 - args.fleet_timeout_seconds, 3_600)
        self.assertEqual(args.max_concurrency, 1)
        self.assertFalse(args.no_timeout)

    def test_parser_accepts_three_wide_unbounded_mode_and_rejects_four(self) -> None:
        parser = memory_reflector.build_parser()
        args = parser.parse_args(
            ["weekly", "--max-concurrency", "3", "--no-timeout"]
        )

        self.assertEqual(args.max_concurrency, 3)
        self.assertTrue(args.no_timeout)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(
            SystemExit
        ):
            parser.parse_args(["weekly", "--max-concurrency", "4"])

    def test_no_timeout_ignores_disabled_deadline_values_in_main(self) -> None:
        stdout = mock.Mock()
        stdout.buffer = io.BytesIO()
        with mock.patch.object(
            memory_reflector, "install_signal_handlers"
        ), mock.patch.object(
            memory_reflector.atexit, "register"
        ), mock.patch.object(
            memory_reflector,
            "execute",
            return_value=(0, {"success": True}),
        ) as execute, mock.patch.object(memory_reflector.sys, "stdout", stdout):
            exit_code = memory_reflector.main(
                [
                    "weekly",
                    "--no-timeout",
                    "--timeout-seconds",
                    "0",
                    "--audit-timeout-seconds",
                    "0",
                    "--fleet-timeout-seconds",
                    "0",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertTrue(execute.call_args.args[0].no_timeout)

    def test_weekly_parser_rejects_migration_only_expected_count(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                memory_reflector.build_parser().parse_args(
                    ["weekly", "--expected-count", "9"]
                )


class CodexBoundaryTests(unittest.TestCase):
    def test_jsonl_requires_one_successful_terminal_event(self) -> None:
        valid = b'{"type":"thread.started"}\n{"type":"turn.completed"}\n'
        failed = b'{"type":"turn.failed"}\n'
        duplicate = b'{"type":"turn.completed"}\n{"type":"turn.completed"}\n'
        trailing = b'{"type":"turn.completed"}\n{"type":"item.completed"}\n'
        self.assertTrue(memory_reflector._validate_terminal_jsonl(valid))
        self.assertFalse(memory_reflector._validate_terminal_jsonl(failed))
        self.assertFalse(memory_reflector._validate_terminal_jsonl(duplicate))
        self.assertFalse(memory_reflector._validate_terminal_jsonl(trailing))

    def test_invoke_uses_new_process_session_scrubbed_env_and_silent_stdout(self) -> None:
        class FakeProcess:
            pid = 12345
            returncode = 0

            def __init__(self) -> None:
                synthetic_secret = "AKIA" + "A" * 16
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(
                    json.dumps({"type": "item.completed", "detail": synthetic_secret}).encode()
                    + b"\n"
                    + b'{"type":"turn.completed"}\n'
                )

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_text('{"status":"success"}', encoding="utf-8")
            captured_out = io.StringIO()
            captured_err = io.StringIO()
            with mock.patch.object(
                memory_reflector.subprocess, "Popen", return_value=FakeProcess()
            ) as popen, mock.patch.object(
                memory_reflector, "isolated_codex_env", return_value={"PATH": "/safe/bin"}
            ), contextlib.redirect_stdout(captured_out), contextlib.redirect_stderr(captured_err):
                result = memory_reflector.invoke_codex(
                    ["codex", "exec"], "prompt", last_message, 30
                )

        self.assertTrue(result.success)
        self.assertEqual(result.message, {"status": "success"})
        self.assertEqual(captured_out.getvalue(), "")
        self.assertEqual(captured_err.getvalue(), "")
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual(popen.call_args.kwargs["env"], {"PATH": "/safe/bin"})
        self.assertEqual(popen.call_args.kwargs["stderr"], subprocess.DEVNULL)

    def test_timeout_terminates_the_process_group(self) -> None:
        class TimeoutProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()

            def poll(self):
                return None

        process = TimeoutProcess()
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_reflector.subprocess, "Popen", return_value=process
        ), mock.patch.object(memory_reflector, "_terminate_process_group") as terminate:
            result = memory_reflector.invoke_codex(
                ["codex"], "prompt", Path(temporary) / "last.json", 0
            )

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "codex_timeout")
        terminate.assert_called_once_with(process)

    def test_reader_start_failure_terminates_and_unregisters_child(self) -> None:
        class StartedProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()

            def poll(self):
                return None

        process = StartedProcess()
        active_children: set[object] = set()
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_reflector, "ACTIVE_CHILDREN", active_children
        ), mock.patch.object(
            memory_reflector.subprocess, "Popen", return_value=process
        ), mock.patch.object(
            memory_reflector.threading.Thread,
            "start",
            side_effect=RuntimeError("thread unavailable"),
        ), mock.patch.object(
            memory_reflector, "_terminate_process_group"
        ) as terminate:
            result = memory_reflector.invoke_codex(
                ["codex"], "prompt", Path(temporary) / "last.json", None
            )

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "codex_stdout_read_failed")
        terminate.assert_called_once_with(process)
        self.assertEqual(active_children, set())

    def test_completed_leader_cannot_leave_unregistered_process_group(self) -> None:
        class CompleteProcess:
            pid = 12345
            returncode = 0

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(b'{"type":"turn.completed"}\n')

            def poll(self):
                return self.returncode

        process = CompleteProcess()
        active_children: set[object] = set()
        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_text('{"status":"success"}', encoding="utf-8")
            with mock.patch.object(
                memory_reflector, "ACTIVE_CHILDREN", active_children
            ), mock.patch.object(
                memory_reflector.subprocess, "Popen", return_value=process
            ), mock.patch.object(
                memory_reflector,
                "_process_group_exists",
                side_effect=[True, False, False],
            ) as group_exists, mock.patch.object(
                memory_reflector, "_terminate_process_group"
            ) as terminate:
                result = memory_reflector.invoke_codex(
                    ["codex"], "prompt", last_message, None
                )

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "codex_process_group_leaked")
        terminate.assert_called_once_with(process)
        self.assertEqual(group_exists.call_count, 3)
        self.assertEqual(active_children, set())
        self.assertFalse(last_message.exists())

    def test_no_timeout_runs_until_process_completion_without_deadline(self) -> None:
        class CompleteAfterPollProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(b'{"type":"turn.completed"}\n')
                self.poll_count = 0

            def poll(self):
                self.poll_count += 1
                if self.poll_count >= 2:
                    self.returncode = 0
                return self.returncode

        process = CompleteAfterPollProcess()
        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_text('{"status":"success"}', encoding="utf-8")
            with mock.patch.object(
                memory_reflector.subprocess, "Popen", return_value=process
            ), mock.patch.object(
                memory_reflector.time,
                "monotonic",
                side_effect=AssertionError("no deadline clock expected"),
            ), mock.patch.object(
                memory_reflector, "_terminate_process_group"
            ) as terminate:
                result = memory_reflector.invoke_codex(
                    ["codex"], "prompt", last_message, None
                )

        self.assertTrue(result.success, result.error_code)
        terminate.assert_not_called()

    def test_termination_checks_group_after_leader_exit_and_kills_descendants(self) -> None:
        process = mock.Mock(pid=24680)
        process.poll.return_value = 0
        with mock.patch.object(
            memory_reflector,
            "_process_group_exists",
            side_effect=[True, True, False],
        ), mock.patch.object(memory_reflector.os, "killpg") as killpg:
            memory_reflector._terminate_process_group(process, grace_seconds=0)

        self.assertEqual(
            killpg.call_args_list,
            [
                mock.call(24680, memory_reflector.signal.SIGTERM),
                mock.call(24680, memory_reflector.signal.SIGKILL),
            ],
        )

    def test_invoke_rejects_oversized_jsonl_and_cleans_last_message(self) -> None:
        class OverflowProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(
                    b"x" * (memory_reflector.MAX_CODEX_JSONL_BYTES + 1)
                )

            def poll(self):
                return None

        process = OverflowProcess()
        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_text("{}", encoding="utf-8")
            with mock.patch.object(
                memory_reflector.subprocess, "Popen", return_value=process
            ), mock.patch.object(
                memory_reflector, "_terminate_process_group"
            ) as terminate:
                result = memory_reflector.invoke_codex(
                    ["codex"], "prompt", last_message, 30
                )

            self.assertFalse(result.success)
            self.assertEqual(result.error_code, "codex_stdout_too_large")
            self.assertFalse(last_message.exists())
            terminate.assert_called_once_with(process)

    def test_no_timeout_still_terminates_on_stdout_overflow(self) -> None:
        class OverflowProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(
                    b"x" * (memory_reflector.MAX_CODEX_JSONL_BYTES + 1)
                )

            def poll(self):
                return None

        process = OverflowProcess()
        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_text("{}", encoding="utf-8")
            with mock.patch.object(
                memory_reflector.subprocess, "Popen", return_value=process
            ), mock.patch.object(
                memory_reflector, "_terminate_process_group"
            ) as terminate:
                result = memory_reflector.invoke_codex(
                    ["codex"], "prompt", last_message, None
                )

        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "codex_stdout_too_large")
        self.assertFalse(last_message.exists())
        terminate.assert_called_once_with(process)

    def test_invoke_stat_caps_last_message_before_read(self) -> None:
        class CompleteProcess:
            pid = 12345
            returncode = 0

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO(b'{"type":"turn.completed"}\n')

            def poll(self):
                return self.returncode

        with tempfile.TemporaryDirectory() as temporary:
            last_message = Path(temporary) / "last.json"
            last_message.write_bytes(
                b"x" * (memory_reflector.MAX_LAST_MESSAGE_BYTES + 1)
            )
            with mock.patch.object(
                memory_reflector.subprocess,
                "Popen",
                return_value=CompleteProcess(),
            ):
                result = memory_reflector.invoke_codex(
                    ["codex"], "prompt", last_message, 30
                )

            self.assertFalse(result.success)
            self.assertEqual(result.error_code, "codex_last_message_too_large")
            self.assertFalse(last_message.exists())

    def test_cleanup_terminates_all_active_groups_and_removes_staging_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary) / "active-stage"
            staging.mkdir()
            child_list = [
                mock.Mock(pid=12345),
                mock.Mock(pid=12346),
                mock.Mock(pid=12347),
            ]
            children = set(child_list)
            active_roots = {staging}
            with mock.patch.object(
                memory_reflector, "ACTIVE_CHILDREN", children
            ), mock.patch.object(
                memory_reflector, "ACTIVE_TEMP_ROOTS", active_roots
            ), mock.patch.object(
                memory_reflector, "SHUTDOWN_REQUESTED", memory_reflector.threading.Event()
            ), mock.patch.object(memory_reflector, "_terminate_process_group") as terminate:
                memory_reflector.cleanup_active_state()

            self.assertEqual(terminate.call_count, 3)
            terminate.assert_has_calls(
                [mock.call(child) for child in child_list], any_order=True
            )
            self.assertFalse(staging.exists())
            self.assertEqual(children, set())
            self.assertEqual(active_roots, set())

    def test_cleanup_retains_surviving_group_and_blocks_new_spawns(self) -> None:
        child = mock.Mock(pid=12345)
        active_children = {child}
        shutdown = threading.Event()
        with mock.patch.object(
            memory_reflector, "ACTIVE_CHILDREN", active_children
        ), mock.patch.object(
            memory_reflector, "ACTIVE_TEMP_ROOTS", set()
        ), mock.patch.object(
            memory_reflector, "SHUTDOWN_REQUESTED", shutdown
        ), mock.patch.object(
            memory_reflector, "_process_group_exists", return_value=True
        ), mock.patch.object(
            memory_reflector, "_terminate_process_group"
        ) as terminate:
            memory_reflector.cleanup_active_state()
            launch_allowed = memory_reflector._begin_child_spawn()

        terminate.assert_called_once_with(child)
        self.assertTrue(shutdown.is_set())
        self.assertFalse(launch_allowed)
        self.assertEqual(active_children, {child})

    def test_signal_cleanup_is_reentrant_and_defers_temp_root_removal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary) / "active-stage"
            staging.mkdir()
            child = mock.Mock(pid=12345)
            handlers: dict[int, object] = {}

            def capture(signum, handler):
                handlers[signum] = handler

            with mock.patch.object(
                memory_reflector, "ACTIVE_CHILDREN", {child}
            ), mock.patch.object(
                memory_reflector, "ACTIVE_TEMP_ROOTS", {staging}
            ), mock.patch.object(
                memory_reflector, "SHUTDOWN_REQUESTED", memory_reflector.threading.Event()
            ), mock.patch.object(
                memory_reflector.signal, "signal", side_effect=capture
            ), mock.patch.object(
                memory_reflector, "_terminate_process_group"
            ) as terminate:
                memory_reflector.install_signal_handlers()
                with memory_reflector.ACTIVE_STATE_LOCK, self.assertRaises(
                    SystemExit
                ) as raised:
                    handlers[memory_reflector.signal.SIGTERM](
                        memory_reflector.signal.SIGTERM, None
                    )

            self.assertEqual(
                raised.exception.code, 128 + memory_reflector.signal.SIGTERM
            )
            terminate.assert_called_once_with(child)
            self.assertTrue(staging.exists())

    def test_signal_between_spawn_and_registration_terminates_fresh_group(self) -> None:
        class SpawnedProcess:
            pid = 12345
            returncode = None

            def __init__(self) -> None:
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO()

            def poll(self):
                return None

        process = SpawnedProcess()
        handlers: dict[int, object] = {}
        active_children: set[object] = set()
        real_register = memory_reflector._register_active_child

        def capture(signum, handler):
            handlers[signum] = handler

        def signal_then_register(child):
            handlers[memory_reflector.signal.SIGTERM](
                memory_reflector.signal.SIGTERM, None
            )
            return real_register(child)

        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            memory_reflector, "ACTIVE_CHILDREN", active_children
        ), mock.patch.object(
            memory_reflector, "ACTIVE_TEMP_ROOTS", set()
        ), mock.patch.object(
            memory_reflector, "ACTIVE_SPAWNS", 0
        ), mock.patch.object(
            memory_reflector, "PENDING_SIGNAL", None
        ), mock.patch.object(
            memory_reflector,
            "SHUTDOWN_REQUESTED",
            threading.Event(),
        ), mock.patch.object(
            memory_reflector.signal, "signal", side_effect=capture
        ), mock.patch.object(
            memory_reflector.subprocess, "Popen", return_value=process
        ), mock.patch.object(
            memory_reflector,
            "_register_active_child",
            side_effect=signal_then_register,
        ), mock.patch.object(
            memory_reflector, "_terminate_process_group"
        ) as terminate:
            memory_reflector.install_signal_handlers()
            with self.assertRaises(SystemExit) as raised:
                memory_reflector.invoke_codex(
                    ["codex"],
                    "prompt",
                    Path(temporary) / "last.json",
                    None,
                )
            self.assertEqual(memory_reflector.ACTIVE_SPAWNS, 0)

        self.assertEqual(
            raised.exception.code, 128 + memory_reflector.signal.SIGTERM
        )
        terminate.assert_called_once_with(process)
        self.assertEqual(active_children, set())


class StagingAndPublishingTests(unittest.TestCase):
    def test_migration_publishes_only_after_compact_report_and_sidecar_validate(self) -> None:
        for scenario in ("success", "timeout", "invalid-sidecar", "invalid-final-hash"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                inventory = create_inventory(root / "source", 3)
                commander = create_commander(
                    root / ".happyherd", "alpha-id", "Alpha"
                )
                original_l2 = commander.l2_file.read_bytes()
                before = memory_reflector._hash_snapshot(commander)
                staged_l2 = b"# Working\n\n- Semantically migrated.\n"

                def fake_invoke(command, _prompt, _last_message, _timeout):
                    workspace = Path(command[command.index("-C") + 1])
                    coverage_path = workspace / memory_reflector.SOURCE_COVERAGE_NAME
                    (workspace / memory_reflector.L2_NAME).write_bytes(staged_l2)
                    fill_source_coverage(coverage_path)
                    if scenario == "invalid-sidecar":
                        payload = json.loads(coverage_path.read_bytes())
                        payload["coverage"][0]["dispositions"] = []
                        coverage_path.write_bytes(
                            memory_reflector.canonical_json(payload) + b"\n"
                        )
                        return memory_reflector.CodexResult(True, None, {})
                    if scenario == "timeout":
                        return memory_reflector.CodexResult(
                            False, "codex_timeout", None
                        )
                    staged, _ = memory_reflector._validate_stage(
                        workspace,
                        "claude-import",
                        65536,
                        commander.l1_file.read_bytes(),
                        expect_source_coverage=True,
                    )
                    payload = json.loads(coverage_path.read_bytes())
                    _coverage, attestation = (
                        memory_reflector._validate_source_coverage_sidecar(
                            coverage_path,
                            commander,
                            inventory,
                            payload["run_nonce"],
                            staged,
                        )
                    )
                    report = valid_model_report(
                        commander,
                        before,
                        staged,
                        "claude-import",
                        inventory=inventory,
                        coverage_attestation=attestation,
                    )
                    if scenario == "invalid-final-hash":
                        report["coverage_attestation"]["sidecar_sha256"] = "0" * 64
                    return memory_reflector.CodexResult(True, None, report)

                with mock.patch.object(
                    memory_reflector, "invoke_codex", side_effect=fake_invoke
                ):
                    result = memory_reflector.run_commander(
                        commander,
                        "claude-import",
                        inventory,
                        ["codex"],
                        60,
                        65536,
                        root,
                        memory_reflector.DEFAULT_MODEL,
                    )

                self.assertFalse(
                    (commander.l2_file.parent / memory_reflector.SOURCE_COVERAGE_NAME).exists()
                )
                if scenario == "success":
                    self.assertTrue(result.success, result.error_code)
                    self.assertEqual(result.phase, "published")
                    self.assertEqual(commander.l2_file.read_bytes(), staged_l2)
                else:
                    self.assertFalse(result.success)
                    self.assertEqual(commander.l2_file.read_bytes(), original_l2)
                    if scenario == "timeout":
                        self.assertEqual(result.error_code, "codex_timeout")
                        self.assertEqual(
                            result.phase,
                            "coverage_sealed_final_response_missing",
                        )
                        self.assertEqual(result.coverage_item_count, 3)
                    elif scenario == "invalid-final-hash":
                        self.assertEqual(
                            result.phase, "coverage_sealed_report_rejected"
                        )
                        self.assertEqual(result.coverage_item_count, 3)

    def test_224_item_import_derives_candidate_counts_before_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory = create_inventory(root / "source", 224)
            commander = create_commander(
                root / ".happyherd", "alpha-id", "Alpha"
            )
            before = memory_reflector._hash_snapshot(commander)

            def fake_invoke(command, _prompt, _last_message, _timeout):
                schema_path = Path(command[command.index("--output-schema") + 1])
                schema = json.loads(schema_path.read_bytes())
                model_count_keys = set(
                    schema["properties"]["counts"]["properties"]
                )
                self.assertEqual(
                    model_count_keys,
                    {"l2_kept_or_added", "l3_kept_or_added", "dropped"},
                )

                workspace = Path(command[command.index("-C") + 1])
                coverage_path = workspace / memory_reflector.SOURCE_COVERAGE_NAME
                fill_source_coverage(coverage_path)
                coverage_payload = json.loads(coverage_path.read_bytes())
                for row in coverage_payload["coverage"][:2]:
                    row["dispositions"] = ["REPORT_SHARED"]
                coverage_path.write_bytes(
                    memory_reflector.canonical_json(coverage_payload) + b"\n"
                )
                staged, _staged_l1 = memory_reflector._validate_stage(
                    workspace,
                    "claude-import",
                    65536,
                    commander.l1_file.read_bytes(),
                    expect_source_coverage=True,
                )
                _coverage, attestation = (
                    memory_reflector._validate_source_coverage_sidecar(
                        coverage_path,
                        commander,
                        inventory,
                        coverage_payload["run_nonce"],
                        staged,
                    )
                )
                report = valid_model_report(
                    commander,
                    before,
                    staged,
                    "claude-import",
                    inventory=inventory,
                    coverage_attestation=attestation,
                )
                report["shared_candidates"] = [
                    {
                        "summary": "One reusable method is reported for review.\n",
                        "target": "shared:rules\n",
                        "evidence": [
                            row["item_id"] + "\n"
                            for row in coverage_payload["coverage"][:2]
                        ],
                    }
                ]
                report["files_examined"] = [
                    str(commander.commander_file) + "\n"
                ]
                report["uncertainties"] = [
                    "One bounded uncertainty remains.\n"
                ]
                return memory_reflector.CodexResult(True, None, report)

            with mock.patch.object(
                memory_reflector, "invoke_codex", side_effect=fake_invoke
            ):
                result = memory_reflector.run_commander(
                    commander,
                    "claude-import",
                    inventory,
                    ["codex"],
                    None,
                    65536,
                    root,
                    memory_reflector.DEFAULT_MODEL,
                )

            self.assertTrue(result.success, result.error_code)
            self.assertEqual(result.phase, "published")
            self.assertEqual(result.coverage_item_count, 224)
            self.assertEqual(result.report["counts"]["shared_reported"], 1)
            self.assertEqual(result.report["counts"]["project_reported"], 0)
            candidate = result.report["shared_candidates"][0]
            self.assertEqual(
                candidate["summary"],
                "One reusable method is reported for review.",
            )
            self.assertEqual(candidate["target"], "shared:rules")
            self.assertTrue(
                all("\n" not in item for item in candidate["evidence"])
            )
            self.assertEqual(
                result.report["files_examined"], [str(commander.commander_file)]
            )
            self.assertEqual(
                result.report["uncertainties"],
                ["One bounded uncertainty remains."],
            )

    def test_agent_report_sealing_rejects_legacy_candidate_count_fields(self) -> None:
        legacy_report = {
            "counts": {
                "l2_kept_or_added": 0,
                "l3_kept_or_added": 0,
                "shared_reported": 0,
                "project_reported": 0,
                "dropped": 0,
            },
            "shared_candidates": [],
            "project_candidates": [],
        }

        with self.assertRaises(memory_reflector.LauncherError) as raised:
            memory_reflector._seal_agent_report(legacy_report)

        self.assertEqual(raised.exception.code, "agent_report_schema_invalid")

    def test_l1_ids_exclude_line_terminators_but_layout_drift_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commander = create_commander(
                Path(temporary) / ".happyherd", "alpha-id", "Alpha"
            )
            raw = json.dumps(
                observation("low", "Expired low-value observation.", 1),
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            lf = raw + b"\n"
            crlf = raw + b"\r\n"
            expected_id = memory_reflector.sha256_bytes(raw)
            self.assertEqual(list(memory_reflector._parse_l1_records(lf)), [expected_id])
            self.assertEqual(
                list(memory_reflector._parse_l1_records(crlf)), [expected_id]
            )
            empty_retention = {
                "merged_medium": [],
                "removed_rule_promoted": [],
                "removed_expired_low": [],
                "observer_contract_breaches": [],
            }
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_l1_retention(
                    empty_retention, lf, crlf, commander
                )
            self.assertEqual(raised.exception.code, "agent_report_l1_invalid")

            declared = copy.deepcopy(empty_retention)
            declared["removed_expired_low"] = [{"source_sha256": expected_id}]
            memory_reflector._validate_l1_retention(
                declared, crlf, b"", commander
            )

    def test_weekly_rejects_undeclared_blank_line_rewrite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commander = create_commander(
                Path(temporary) / ".happyherd", "alpha-id", "Alpha"
            )
            record = l1_bytes(observation("high", "Keep exact framing.", 1))
            retention = {
                "merged_medium": [],
                "removed_rule_promoted": [],
                "removed_expired_low": [],
                "observer_contract_breaches": [],
            }
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_l1_retention(
                    retention, record + b"\n", record, commander
                )
            self.assertEqual(raised.exception.code, "agent_report_l1_invalid")

    def test_rule_promoted_removal_rejects_private_and_shared_symlink_escapes(
        self,
    ) -> None:
        for scope in ("private", "shared"):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as temporary:
                home = Path(temporary) / ".happyherd"
                commander = create_commander(home, "alpha-id", "Alpha")
                outside = Path(temporary) / "outside-rules"
                outside.mkdir()
                (outside / "owning-rule.md").write_text(
                    "# Escaped rule\n", encoding="utf-8"
                )
                rules_root = (
                    commander.root / "agentcontext/rules"
                    if scope == "private"
                    else home / "agentcontext/rules"
                )
                rules_root.mkdir(parents=True)
                (rules_root / "escape").symlink_to(
                    outside, target_is_directory=True
                )
                before_l1 = l1_bytes(
                    observation("high", "Claimed as rule-promoted.", 1)
                )
                source_id = next(
                    iter(memory_reflector._parse_l1_records(before_l1))
                )
                retention = {
                    "merged_medium": [],
                    "removed_rule_promoted": [
                        {
                            "source_sha256": source_id,
                            "rule_path": str(
                                rules_root / "escape" / "owning-rule.md"
                            ),
                        }
                    ],
                    "removed_expired_low": [],
                    "observer_contract_breaches": [],
                }

                with self.assertRaises(memory_reflector.LauncherError) as raised:
                    memory_reflector._validate_l1_retention(
                        retention, before_l1, b"", commander
                    )

                self.assertEqual(
                    raised.exception.code, "agent_report_l1_invalid"
                )

    def test_rule_promoted_removal_accepts_real_nested_owner_rule(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commander = create_commander(home, "alpha-id", "Alpha")
            nested = commander.root / "agentcontext/rules/learnings"
            nested.mkdir(parents=True)
            rule = nested / "owner.md"
            rule.write_text("# Owning rule\n", encoding="utf-8")
            before_l1 = l1_bytes(
                observation("high", "Represented by a real owning rule.", 1)
            )
            source_id = next(iter(memory_reflector._parse_l1_records(before_l1)))
            retention = {
                "merged_medium": [],
                "removed_rule_promoted": [
                    {"source_sha256": source_id, "rule_path": str(rule)}
                ],
                "removed_expired_low": [],
                "observer_contract_breaches": [],
            }

            memory_reflector._validate_l1_retention(
                retention, before_l1, b"", commander
            )

    def test_weekly_agent_can_apply_only_declared_l1_retention_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before_l1 = l1_bytes(
                observation("medium", "Same topic, first evidence.", 1),
                observation("medium", "Same topic, second evidence.", 2),
                observation("low", "Expired low-value observation.", 3),
            )
            commander.l1_file.write_bytes(before_l1)
            merged_l1 = l1_bytes(
                observation("medium", "Merged evidence for the same topic.", 4)
            )
            before_ids = list(memory_reflector._parse_l1_records(before_l1))
            merged_id = next(iter(memory_reflector._parse_l1_records(merged_l1)))
            before = memory_reflector._hash_snapshot(commander)

            def fake_invoke(command, _prompt, _last_message, _timeout):
                workspace = Path(command[command.index("-C") + 1])
                (workspace / memory_reflector.L1_NAME).write_bytes(merged_l1)
                staged, _ = memory_reflector._validate_stage(
                    workspace, "reflector", 65536, before_l1
                )
                retention = {
                    "merged_medium": [
                        {"source_sha256": before_ids[:2], "result_sha256": merged_id}
                    ],
                    "removed_rule_promoted": [],
                    "removed_expired_low": [{"source_sha256": before_ids[2]}],
                    "observer_contract_breaches": [],
                }
                return memory_reflector.CodexResult(
                    True,
                    None,
                    valid_model_report(
                        commander,
                        before,
                        staged,
                        l1_retention=retention,
                    ),
                )

            with mock.patch.object(
                memory_reflector, "invoke_codex", side_effect=fake_invoke
            ):
                result = memory_reflector.run_commander(
                    commander,
                    "reflector",
                    None,
                    ["codex"],
                    60,
                    65536,
                    root,
                    memory_reflector.DEFAULT_MODEL,
                )

            self.assertTrue(result.success, result.error_code)
            self.assertEqual(commander.l1_file.read_bytes(), merged_l1)

    def test_migration_staging_keeps_l1_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before_l1 = l1_bytes(observation("high", "Retain exactly.", 1))
            commander.l1_file.write_bytes(before_l1)
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_bytes(commander.l2_file.read_bytes())
            (workspace / memory_reflector.L3_NAME).write_bytes(commander.l3_file.read_bytes())

            staged, staged_l1 = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, before_l1
            )
            self.assertEqual(staged["l1"], memory_reflector.sha256_bytes(before_l1))
            self.assertEqual(staged_l1, before_l1)

            (workspace / memory_reflector.L1_NAME).write_bytes(before_l1)
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_stage(
                    workspace, "claude-import", 65536, before_l1
                )
            self.assertEqual(raised.exception.code, "stage_allowed_paths_invalid")

    def test_source_coverage_sidecar_is_for_claude_import_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            workspace = root / "workspace"
            workspace.mkdir()
            for source in (commander.l1_file, commander.l2_file, commander.l3_file):
                (workspace / source.name).write_bytes(source.read_bytes())
            (workspace / memory_reflector.SOURCE_COVERAGE_NAME).write_text(
                "{}\n", encoding="utf-8"
            )

            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_stage(
                    workspace,
                    "reflector",
                    65536,
                    commander.l1_file.read_bytes(),
                )

            self.assertEqual(raised.exception.code, "stage_allowed_paths_invalid")

    def test_correction_context_exposes_ephemeral_initial_and_current_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            initial = {
                "l1": commander.l1_file.read_bytes(),
                "l2": commander.l2_file.read_bytes(),
                "l3": commander.l3_file.read_bytes(),
            }
            commander.l2_file.write_text(
                "# Working\n\n- Current pass content.\n", encoding="utf-8"
            )
            observed_context: list[Path] = []

            def fake_invoke(command, prompt, _last_message, _timeout):
                control = Path(command[command.index("--output-schema") + 1]).parent
                context_path = control / "correction-context.json"
                observed_context.append(context_path)
                context = json.loads(context_path.read_bytes())
                self.assertTrue(Path(context["prior_audit_path"]).is_file())
                for tier in ("l1", "l2", "l3"):
                    initial_path = Path(context["initial_memory"][tier])
                    current_path = Path(context["current_memory"][tier])
                    self.assertTrue(initial_path.is_file())
                    self.assertTrue(current_path.is_file())
                    self.assertEqual(initial_path.read_bytes(), initial[tier])
                self.assertIn("may have expired", prompt)
                workspace = Path(command[command.index("-C") + 1])
                before = memory_reflector._hash_snapshot(commander)
                staged, staged_l1 = memory_reflector._validate_stage(
                    workspace,
                    "claude-import",
                    65536,
                    commander.l1_file.read_bytes(),
                )
                self.assertEqual(
                    Path(context["current_memory"]["l1"]), commander.l1_file
                )
                del staged_l1
                return memory_reflector.CodexResult(
                    True,
                    None,
                    valid_model_report(
                        commander, before, staged, mode="claude-import"
                    ),
                )

            with mock.patch.object(
                memory_reflector, "invoke_codex", side_effect=fake_invoke
            ):
                result = memory_reflector.run_commander(
                    commander,
                    "claude-import",
                    None,
                    ["codex"],
                    60,
                    65536,
                    root,
                    memory_reflector.DEFAULT_MODEL,
                    correction_audit={"status": "fail", "findings": []},
                    correction_initial_memory=initial,
                )

            self.assertTrue(result.success, result.error_code)
            self.assertEqual(len(observed_context), 1)
            self.assertFalse(observed_context[0].exists())

    def test_publish_aborts_on_last_moment_live_memory_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_text(
                "# Working\n\n- Staged update.\n", encoding="utf-8"
            )
            (workspace / memory_reflector.L3_NAME).write_bytes(commander.l3_file.read_bytes())
            staged, _ = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, commander.l1_file.read_bytes()
            )
            concurrent = b"# Working\n\n- Concurrent update.\n"
            commander.l2_file.write_bytes(concurrent)

            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._atomic_publish(
                    commander, workspace, before, staged, "claude-import"
                )

            self.assertEqual(raised.exception.code, "live_memory_changed_at_publish")
            self.assertEqual(commander.l2_file.read_bytes(), concurrent)
            leftovers = [
                item
                for item in commander.l2_file.parent.iterdir()
                if item.name.startswith(f".{memory_reflector.L2_NAME}.")
            ]
            self.assertEqual(leftovers, [])

    def test_publish_rolls_back_when_shutdown_starts_after_final_replace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            original_l2 = commander.l2_file.read_bytes()
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_text(
                "# Working\n\n- New.\n", encoding="utf-8"
            )
            (workspace / memory_reflector.L3_NAME).write_bytes(
                commander.l3_file.read_bytes()
            )
            staged, _ = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, commander.l1_file.read_bytes()
            )
            shutdown = threading.Event()
            real_replace = os.replace
            calls = 0

            def replace_then_signal(source, target):
                nonlocal calls
                calls += 1
                real_replace(source, target)
                if calls == 1:
                    shutdown.set()

            with mock.patch.object(
                memory_reflector, "SHUTDOWN_REQUESTED", shutdown
            ), mock.patch.object(
                memory_reflector.os, "replace", side_effect=replace_then_signal
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._atomic_publish(
                    commander, workspace, before, staged, "claude-import"
                )

            self.assertEqual(raised.exception.code, "launcher_shutdown")
            self.assertEqual(commander.l2_file.read_bytes(), original_l2)

    def test_publish_rolls_back_when_shutdown_starts_during_final_readback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            original_l2 = commander.l2_file.read_bytes()
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_text(
                "# Working\n\n- New.\n", encoding="utf-8"
            )
            (workspace / memory_reflector.L3_NAME).write_bytes(
                commander.l3_file.read_bytes()
            )
            staged, _ = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, commander.l1_file.read_bytes()
            )
            shutdown = threading.Event()
            real_sha256_file = memory_reflector.sha256_file
            l3_hashes = 0

            def hash_then_signal(path):
                nonlocal l3_hashes
                digest = real_sha256_file(path)
                if path == commander.l3_file:
                    l3_hashes += 1
                    if l3_hashes == 2:
                        shutdown.set()
                return digest

            with mock.patch.object(
                memory_reflector, "SHUTDOWN_REQUESTED", shutdown
            ), mock.patch.object(
                memory_reflector,
                "sha256_file",
                side_effect=hash_then_signal,
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._atomic_publish(
                    commander, workspace, before, staged, "claude-import"
                )

            self.assertEqual(raised.exception.code, "launcher_shutdown")
            self.assertEqual(commander.l2_file.read_bytes(), original_l2)

    def test_publish_rolls_back_all_files_when_interrupted_between_replaces(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            originals = {
                "l2": commander.l2_file.read_bytes(),
                "l3": commander.l3_file.read_bytes(),
            }
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_text(
                "# Working\n\n- New.\n", encoding="utf-8"
            )
            (workspace / memory_reflector.L3_NAME).write_text(
                "# Durable\n\n- New.\n", encoding="utf-8"
            )
            staged, _ = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, commander.l1_file.read_bytes()
            )
            real_replace = os.replace
            calls = 0

            def interrupt(source, target):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise SystemExit(143)
                return real_replace(source, target)

            with mock.patch.object(memory_reflector.os, "replace", side_effect=interrupt):
                with self.assertRaises(SystemExit):
                    memory_reflector._atomic_publish(
                        commander, workspace, before, staged, "claude-import"
                    )

            self.assertEqual(commander.l2_file.read_bytes(), originals["l2"])
            self.assertEqual(commander.l3_file.read_bytes(), originals["l3"])

    def test_publish_reports_rollback_failure_instead_of_masking_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "alpha-id", "Alpha")
            before = memory_reflector._hash_snapshot(commander)
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / memory_reflector.L2_NAME).write_text(
                "# Working\n\n- New.\n", encoding="utf-8"
            )
            (workspace / memory_reflector.L3_NAME).write_text(
                "# Durable\n\n- New.\n", encoding="utf-8"
            )
            staged, _ = memory_reflector._validate_stage(
                workspace, "claude-import", 65536, commander.l1_file.read_bytes()
            )
            real_replace = os.replace
            calls = 0

            def fail_rollback(source, target):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise SystemExit(143)
                if calls == 4:
                    raise OSError("rollback failed")
                return real_replace(source, target)

            with mock.patch.object(
                memory_reflector.os, "replace", side_effect=fail_rollback
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._atomic_publish(
                    commander, workspace, before, staged, "claude-import"
                )

            self.assertEqual(raised.exception.code, "memory_rollback_failed")


class PrivacyAndAuditTests(unittest.TestCase):
    def test_shared_secret_patterns_and_public_results_do_not_leak_report_details(self) -> None:
        synthetic_secret = "AKIA" + "A" * 16
        self.assertTrue(memory_reflector.contains_secret(synthetic_secret))
        result = memory_reflector.CommanderResult(
            "alpha-id",
            "Alpha",
            True,
            report={
                "status": "success",
                "changes": {
                    "l1_changed": False,
                    "l2_changed": False,
                    "l3_changed": False,
                },
                "counts": {"shared_reported": 1},
                "shared_candidates": [{"summary": synthetic_secret}],
                "uncertainties": [synthetic_secret],
                "blockers": [],
            },
        )

        public = memory_reflector._public_commander_result(result)

        self.assertNotIn("shared_candidates", public)
        self.assertNotIn("uncertainties", public)
        self.assertNotIn("blockers", public)
        self.assertFalse(memory_reflector.contains_secret(memory_reflector.canonical_json(public)))

    def test_public_audit_projection_redacts_finding_prose_and_evidence(self) -> None:
        sentinel = "private-audit-sentinel"
        message = {
            "status": "fail",
            "commanders_expected": 1,
            "correction_commander_ids": ["alpha-id"],
            "findings": [
                {
                    "severity": "blocking",
                    "kind": "agent_failure",
                    "summary": sentinel,
                    "source_item_ids": [],
                    "commander_ids": ["alpha-id"],
                    "evidence": [f"path:{sentinel}"],
                }
            ],
        }

        public = memory_reflector._public_audit_result(
            memory_reflector.CodexResult(True, None, message)
        )

        encoded = memory_reflector.canonical_json(public)
        self.assertNotIn(sentinel.encode("utf-8"), encoded)
        self.assertEqual(public["finding_kinds"], ["agent_failure"])
        self.assertEqual(public["blocking_finding_count"], 1)

    def test_candidate_evidence_must_be_an_opaque_reference(self) -> None:
        with self.assertRaises(memory_reflector.LauncherError) as raised:
            memory_reflector._validate_candidates(
                [
                    {
                        "summary": "Candidate is reported without copying source text.",
                        "target": "shared:rules",
                        "evidence": ["copied private source excerpt"],
                    }
                ]
            )
        self.assertEqual(raised.exception.code, "agent_report_privacy_invalid")

    def test_terminal_lf_canonicalization_is_copy_on_write_and_field_bounded(
        self,
    ) -> None:
        synthetic_secret = "AKIA" + "A" * 16
        report = {
            "counts": {
                "l2_kept_or_added": 1,
                "l3_kept_or_added": 1,
                "dropped": 0,
            },
            "files_examined": ["/tmp/evidence\n"],
            "shared_candidates": [
                {
                    "summary": synthetic_secret + "\n",
                    "target": "shared:rules\n",
                    "evidence": ["a" * 64 + "\n"],
                }
            ],
            "project_candidates": [
                {
                    "summary": "One project candidate.\n",
                    "target": "/tmp/project-guide\n",
                    "evidence": ["source:" + "b" * 64 + "\n"],
                }
            ],
            "uncertainties": ["One uncertainty.\n"],
            "blockers": ["One blocker.\n"],
            "l1_retention": {
                "merged_medium": [],
                "removed_rule_promoted": [],
                "removed_expired_low": [],
                "observer_contract_breaches": ["One observer breach.\n"],
            },
            "coverage_attestation": {"sidecar_sha256": "c" * 64},
            "hashes": {"l2_after": "d" * 64},
        }
        original = copy.deepcopy(report)

        sealed = memory_reflector._seal_agent_report(report)

        self.assertEqual(report, original)
        self.assertEqual(sealed["files_examined"], ["/tmp/evidence"])
        self.assertEqual(
            sealed["shared_candidates"][0],
            {
                "summary": synthetic_secret,
                "target": "shared:rules",
                "evidence": ["a" * 64],
            },
        )
        self.assertEqual(
            sealed["project_candidates"][0],
            {
                "summary": "One project candidate.",
                "target": "/tmp/project-guide",
                "evidence": ["source:" + "b" * 64],
            },
        )
        self.assertEqual(sealed["uncertainties"], ["One uncertainty."])
        self.assertEqual(sealed["blockers"], ["One blocker."])
        self.assertEqual(
            sealed["l1_retention"]["observer_contract_breaches"],
            ["One observer breach."],
        )
        self.assertEqual(
            sealed["coverage_attestation"], report["coverage_attestation"]
        )
        self.assertEqual(sealed["hashes"], report["hashes"])
        self.assertEqual(sealed["counts"]["shared_reported"], 1)
        self.assertEqual(sealed["counts"]["project_reported"], 1)
        self.assertTrue(
            memory_reflector.contains_secret(memory_reflector.canonical_json(sealed))
        )

    def test_terminal_lf_canonicalization_rejects_every_other_line_shape(
        self,
    ) -> None:
        self.assertEqual(
            memory_reflector._canonicalize_safe_summary("One line.\n"),
            "One line.",
        )
        for reference in ("/tmp/file", "a" * 64, "source:item-id"):
            self.assertEqual(
                memory_reflector._canonicalize_opaque_ref(reference + "\n"),
                reference,
            )

        invalid_summaries = (
            "First\nSecond",
            "One line.\n\n",
            "One line.\r",
            "One line.\r\n",
            "\n",
            "   \n",
            "x" * memory_reflector.SAFE_SUMMARY_MAX + "\n",
        )
        invalid_references = (
            "source:item\ninside",
            "source:item\n\n",
            "source:item\r",
            "source:item\r\n",
            "\n",
            "relative-path\n",
            "/" + "x" * (memory_reflector.SAFE_REF_MAX - 1) + "\n",
        )
        for value in invalid_summaries:
            with self.subTest(kind="summary", value=repr(value)):
                self.assertEqual(
                    memory_reflector._canonicalize_safe_summary(value), value
                )
                with self.assertRaises(memory_reflector.LauncherError):
                    memory_reflector._validate_safe_summary(value)
        for value in invalid_references:
            with self.subTest(kind="reference", value=repr(value)):
                self.assertEqual(
                    memory_reflector._canonicalize_opaque_ref(value), value
                )
                with self.assertRaises(memory_reflector.LauncherError):
                    memory_reflector._validate_opaque_ref(value)

    def test_audit_schema_matches_fail_closed_privacy_validator(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commander = create_commander(
                Path(temporary) / ".happyherd", "alpha-id", "Alpha"
            )
            commanders = [commander]
            snapshots = snapshot_attestation(commanders)
            schema = memory_reflector.build_audit_schema(
                "reflector", commanders, None, snapshots, "a" * 64
            )
            finding_schema = schema["properties"]["findings"]["items"]
            summary_schema = finding_schema["properties"]["summary"]
            evidence_schema = finding_schema["properties"]["evidence"]["items"]

            def accepts_string(value_schema, value):
                return (
                    value_schema["minLength"] <= len(value)
                    <= value_schema["maxLength"]
                    and re.search(value_schema["pattern"], value) is not None
                )

            valid_summary = "One bounded semantic finding."
            valid_evidence = "snapshot:" + "b" * 64
            invalid_summary = "First line\nSecond line"
            invalid_evidence = "agent-reports.json#/commanders/0"
            self.assertTrue(accepts_string(summary_schema, valid_summary))
            self.assertTrue(accepts_string(evidence_schema, valid_evidence))
            self.assertFalse(accepts_string(summary_schema, invalid_summary))
            self.assertFalse(accepts_string(evidence_schema, invalid_evidence))
            self.assertTrue(
                accepts_string(summary_schema, valid_summary + "\n")
            )
            self.assertTrue(
                accepts_string(evidence_schema, valid_evidence + "\n")
            )
            for invalid_suffix in ("\r", "\r\n", "\n\n"):
                self.assertFalse(
                    accepts_string(summary_schema, valid_summary + invalid_suffix)
                )
                self.assertFalse(
                    accepts_string(evidence_schema, valid_evidence + invalid_suffix)
                )

            base_finding = {
                "severity": "nonblocking",
                "kind": "candidate",
                "summary": valid_summary,
                "source_item_ids": [],
                "commander_ids": [commander.commander_id],
                "evidence": [valid_evidence],
            }
            valid = audit_report(
                commanders,
                status="pass",
                correction_ids=[],
                findings=[base_finding],
                snapshots=snapshots,
            )
            memory_reflector.validate_audit_report(
                valid,
                "reflector",
                commanders,
                None,
                snapshots,
                valid["coverage_attestation"],
            )
            terminal_lf = copy.deepcopy(valid)
            terminal_lf["findings"][0]["summary"] += "\n"
            terminal_lf["findings"][0]["evidence"] = [valid_evidence + "\n"]
            canonical = memory_reflector._seal_audit_report(terminal_lf)
            memory_reflector.validate_audit_report(
                canonical,
                "reflector",
                commanders,
                None,
                snapshots,
                canonical["coverage_attestation"],
            )
            self.assertEqual(
                canonical["findings"][0]["summary"], valid_summary
            )
            self.assertEqual(
                canonical["findings"][0]["evidence"], [valid_evidence]
            )
            secret = "AKIA" + "A" * 16
            secret_report = copy.deepcopy(valid)
            secret_report["findings"][0]["summary"] = secret + "\n"
            secret_report = memory_reflector._seal_audit_report(secret_report)
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.validate_audit_report(
                    secret_report,
                    "reflector",
                    commanders,
                    None,
                    snapshots,
                    secret_report["coverage_attestation"],
                )
            self.assertEqual(
                raised.exception.code, "audit_report_secret_detected"
            )
            for field, invalid_value in (
                ("summary", invalid_summary),
                ("evidence", [invalid_evidence]),
                ("summary", valid_summary + "\n\n"),
                ("summary", valid_summary + "\r\n"),
                ("evidence", [valid_evidence + "\n\n"]),
                ("evidence", [valid_evidence + "\r\n"]),
            ):
                with self.subTest(field=field):
                    finding = copy.deepcopy(base_finding)
                    finding[field] = invalid_value
                    report = audit_report(
                        commanders,
                        status="pass",
                        correction_ids=[],
                        findings=[finding],
                        snapshots=snapshots,
                    )
                    report = memory_reflector._seal_audit_report(report)
                    with self.assertRaises(
                        memory_reflector.LauncherError
                    ) as raised:
                        memory_reflector.validate_audit_report(
                            report,
                            "reflector",
                            commanders,
                            None,
                            snapshots,
                            report["coverage_attestation"],
                        )
                    self.assertEqual(
                        raised.exception.code, "audit_report_privacy_invalid"
                    )

    def test_audit_requires_correction_ids_to_equal_blocking_finding_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            first = create_commander(home, "a-id", "Alpha")
            second = create_commander(home, "b-id", "Beta")
            commanders = [first, second]
            snapshots = snapshot_attestation(commanders)
            valid = audit_report(
                commanders,
                status="fail",
                correction_ids=["a-id"],
                findings=[blocking_finding("a-id")],
                snapshots=snapshots,
            )
            memory_reflector.validate_audit_report(
                valid,
                "reflector",
                commanders,
                None,
                snapshots,
                valid["coverage_attestation"],
            )

            mismatched = copy.deepcopy(valid)
            mismatched["correction_commander_ids"] = ["b-id"]
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.validate_audit_report(
                    mismatched,
                    "reflector",
                    commanders,
                    None,
                    snapshots,
                    valid["coverage_attestation"],
                )
            self.assertEqual(raised.exception.code, "audit_report_status_invalid")

            unknown = copy.deepcopy(valid)
            unknown["correction_commander_ids"] = ["unknown-id"]
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.validate_audit_report(
                    unknown,
                    "reflector",
                    commanders,
                    None,
                    snapshots,
                    valid["coverage_attestation"],
                )
            self.assertEqual(raised.exception.code, "audit_report_identity_invalid")

    def test_audit_rejects_pass_with_empty_attestations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commander = create_commander(home, "a-id", "Alpha")
            commanders = [commander]
            snapshots = snapshot_attestation(commanders)
            report = audit_report(
                commanders,
                status="pass",
                correction_ids=[],
                findings=[],
                snapshots=snapshots,
            )
            report["coverage_attestation"]["snapshots_examined"] = 0

            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.validate_audit_report(
                    report,
                    "reflector",
                    commanders,
                    None,
                    snapshots,
                    audit_coverage_attestation(None, snapshots),
                )

            self.assertEqual(
                raised.exception.code, "audit_report_attestation_invalid"
            )

    def test_audit_coverage_sidecar_requires_exact_rows_all_examined(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory = create_inventory(root / "source", 3)
            commander = create_commander(root / ".happyherd", "a-id", "Alpha")
            snapshots = snapshot_attestation([commander])
            nonce = "a" * 64
            path = root / memory_reflector.AUDIT_COVERAGE_NAME
            skeleton = memory_reflector._audit_coverage_skeleton(
                "claude-import", inventory, snapshots, nonce
            )
            memory_reflector.write_control_json(path, skeleton)
            with self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector._validate_audit_coverage_sidecar(
                    path, "claude-import", inventory, snapshots, nonce
                )
            self.assertEqual(
                raised.exception.code, "audit_report_attestation_invalid"
            )

            completed = copy.deepcopy(skeleton)
            for row in completed["source_items"]:
                row["examined"] = True
            for row in completed["snapshots"]:
                row["examined"] = True
            path.write_bytes(memory_reflector.canonical_json(completed) + b"\n")
            attestation = memory_reflector._validate_audit_coverage_sidecar(
                path, "claude-import", inventory, snapshots, nonce
            )
            self.assertEqual(attestation["source_items_examined"], 3)
            self.assertEqual(attestation["snapshots_examined"], 6)

            for label, mutation in (
                (
                    "source-id",
                    lambda value: value["source_items"][0].update(
                        {"item_id": "0" * 64}
                    ),
                ),
                (
                    "snapshot-hash",
                    lambda value: value["snapshots"][0].update(
                        {"sha256": "0" * 64}
                    ),
                ),
                (
                    "source-examined-integer",
                    lambda value: value["source_items"][0].update(
                        {"examined": 1}
                    ),
                ),
                (
                    "snapshot-examined-integer",
                    lambda value: value["snapshots"][0].update(
                        {"examined": 1}
                    ),
                ),
                (
                    "schema-version-boolean",
                    lambda value: value.update({"schema_version": True}),
                ),
                (
                    "extra-key",
                    lambda value: value.update({"extra": True}),
                ),
            ):
                with self.subTest(label=label):
                    changed = copy.deepcopy(completed)
                    mutation(changed)
                    path.write_bytes(
                        memory_reflector.canonical_json(changed) + b"\n"
                    )
                    with self.assertRaises(memory_reflector.LauncherError):
                        memory_reflector._validate_audit_coverage_sidecar(
                            path, "claude-import", inventory, snapshots, nonce
                        )

    def test_direct_aggregate_staging_builds_inventory_schema_and_validates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            commander = create_commander(root / ".happyherd", "a-id", "Alpha")
            source = root / "source"
            source.mkdir()
            (source / "MEMORY.md").write_text("- Opaque source item.\n", encoding="utf-8")
            inventory = memory_reflector.build_inventory([source])
            initial_memory = memory_reflector._initial_memory_snapshot([commander])
            run_root = root / "audit-run"
            run_root.mkdir()
            snapshots = snapshot_attestation([commander])
            audit_messages: list[dict[str, object]] = []

            def fake_invoke(command, prompt, _last_message, _timeout):
                schema_path = Path(command[command.index("--output-schema") + 1])
                schema = json.loads(schema_path.read_bytes())
                source_items = schema["properties"]["findings"]["items"][
                    "properties"
                ]["source_item_ids"]["items"]
                self.assertEqual(source_items["pattern"], "^[0-9a-f]{64}$")
                self.assertNotIn("enum", source_items)
                self.assertIn("coverage_attestation", schema["required"])
                self.assertIn("semantic_checks", schema["required"])
                self.assertIn("every before/after L1/L2/L3 snapshot", prompt)
                workspace = Path(command[command.index("-C") + 1])
                self.assertNotIn(str(workspace / "agent-reports.json"), prompt)
                coverage_path = workspace / memory_reflector.AUDIT_COVERAGE_NAME
                coverage = json.loads(coverage_path.read_bytes())
                self.assertTrue(
                    all(not row["examined"] for row in coverage["source_items"])
                )
                for row in coverage["source_items"]:
                    row["examined"] = True
                for row in coverage["snapshots"]:
                    row["examined"] = True
                coverage_path.write_bytes(
                    memory_reflector.canonical_json(coverage) + b"\n"
                )
                attestation = memory_reflector._validate_audit_coverage_sidecar(
                    coverage_path,
                    "claude-import",
                    inventory,
                    snapshots,
                    coverage["run_nonce"],
                )
                audit_message = audit_report(
                    [commander],
                    status="pass",
                    correction_ids=[],
                    findings=[
                        {
                            "severity": "nonblocking",
                            "kind": "candidate",
                            "summary": "One audit candidate.\n",
                            "source_item_ids": [inventory["items"][0]["item_id"]],
                            "commander_ids": [commander.commander_id],
                            "evidence": [inventory["items"][0]["item_id"] + "\n"],
                        }
                    ],
                    mode="claude-import",
                    inventory=inventory,
                    snapshots=snapshots,
                    coverage_attestation=attestation,
                )
                audit_messages.append(audit_message)
                return memory_reflector.CodexResult(True, None, audit_message)

            captured_out = io.StringIO()
            captured_err = io.StringIO()
            with mock.patch.object(
                memory_reflector, "invoke_codex", side_effect=fake_invoke
            ), contextlib.redirect_stdout(captured_out), contextlib.redirect_stderr(
                captured_err
            ):
                result = memory_reflector._run_aggregate_audit_staged(
                    "claude-import",
                    [commander],
                    [success_result(commander)],
                    inventory,
                    ["codex"],
                    60,
                    initial_memory,
                    memory_reflector.DEFAULT_MODEL,
                    run_root,
                )

            self.assertTrue(result.success, result.error_code)
            self.assertEqual(
                result.message["findings"][0]["summary"],
                "One audit candidate.",
            )
            self.assertEqual(
                result.message["findings"][0]["evidence"],
                [inventory["items"][0]["item_id"]],
            )
            self.assertEqual(
                result.message["coverage_attestation"],
                audit_messages[0]["coverage_attestation"],
            )
            self.assertTrue(
                audit_messages[0]["findings"][0]["summary"].endswith("\n")
            )
            self.assertEqual(captured_out.getvalue(), "")
            self.assertEqual(captured_err.getvalue(), "")


class ConcurrencyAndNoTimeoutTests(unittest.TestCase):
    def test_batch_caps_live_workers_at_three_and_preserves_roster_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commanders = [
                create_commander(home, f"c{index}-id", f"C{index}")
                for index in range(6)
            ]
            expected = memory_reflector._initial_expected_hashes(
                memory_reflector._initial_memory_snapshot(commanders)
            )
            release = threading.Event()
            first_three_started = threading.Event()
            lock = threading.Lock()
            entered: list[str] = []
            active = 0
            peak_active = 0
            output: list[list[memory_reflector.CommanderResult]] = []
            errors: list[BaseException] = []

            def fake_run(commander, *_args, **_kwargs):
                nonlocal active, peak_active
                self.assertIsNone(_args[3])
                with lock:
                    entered.append(commander.commander_id)
                    active += 1
                    peak_active = max(peak_active, active)
                    if active == 3:
                        first_three_started.set()
                try:
                    if not release.wait(2):
                        raise AssertionError("worker release timed out")
                    return success_result(commander)
                finally:
                    with lock:
                        active -= 1

            def coordinate() -> None:
                try:
                    output.append(
                        memory_reflector._run_commander_batch(
                            commanders,
                            "reflector",
                            None,
                            ["codex"],
                            None,
                            None,
                            0,
                            65536,
                            None,
                            memory_reflector.DEFAULT_MODEL,
                            3,
                            expected,
                        )
                    )
                except BaseException as exc:
                    errors.append(exc)

            with mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ), mock.patch.object(
                memory_reflector,
                "SHUTDOWN_REQUESTED",
                threading.Event(),
            ):
                coordinator = threading.Thread(target=coordinate)
                coordinator.start()
                self.assertTrue(first_three_started.wait(1))
                time.sleep(0.05)
                with lock:
                    self.assertEqual(len(entered), 3)
                    self.assertEqual(active, 3)
                release.set()
                coordinator.join(3)

            self.assertFalse(coordinator.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual(peak_active, 3)
            self.assertEqual(set(entered), {item.commander_id for item in commanders})
            self.assertEqual(
                [item.commander_id for item in output[0]],
                [item.commander_id for item in commanders],
            )

    def test_batch_isolates_one_worker_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commanders = [
                create_commander(home, f"c{index}-id", f"C{index}")
                for index in range(4)
            ]
            expected = memory_reflector._initial_expected_hashes(
                memory_reflector._initial_memory_snapshot(commanders)
            )
            invoked: list[str] = []
            lock = threading.Lock()

            def fake_run(commander, *_args, **_kwargs):
                with lock:
                    invoked.append(commander.commander_id)
                if commander.commander_id == "c1-id":
                    raise RuntimeError("isolated worker failure")
                return success_result(commander)

            with mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ):
                results = memory_reflector._run_commander_batch(
                    commanders,
                    "reflector",
                    None,
                    ["codex"],
                    60,
                    None,
                    0,
                    65536,
                    None,
                    memory_reflector.DEFAULT_MODEL,
                    3,
                    expected,
                )

            self.assertEqual(set(invoked), {item.commander_id for item in commanders})
            self.assertEqual(
                [item.commander_id for item in results],
                [item.commander_id for item in commanders],
            )
            failed = next(item for item in results if item.commander_id == "c1-id")
            self.assertFalse(failed.success)
            self.assertEqual(failed.error_code, "commander_worker_failed")
            self.assertTrue(
                all(
                    item.success
                    for item in results
                    if item.commander_id != "c1-id"
                )
            )

    def test_concurrent_disjoint_atomic_publishes_reconcile_expected_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / ".happyherd"
            commanders = [
                create_commander(home, "a-id", "Alpha"),
                create_commander(home, "b-id", "Beta"),
            ]
            expected = memory_reflector._initial_expected_hashes(
                memory_reflector._initial_memory_snapshot(commanders)
            )
            publish_barrier = threading.Barrier(2)

            def fake_run(commander, *_args, **_kwargs):
                before = memory_reflector._hash_snapshot(commander)
                workspace = root / f"stage-{commander.commander_id}"
                workspace.mkdir()
                (workspace / memory_reflector.L2_NAME).write_text(
                    f"# Working\n\n- Updated {commander.commander_id}.\n",
                    encoding="utf-8",
                )
                (workspace / memory_reflector.L3_NAME).write_bytes(
                    commander.l3_file.read_bytes()
                )
                staged, _ = memory_reflector._validate_stage(
                    workspace,
                    "claude-import",
                    65536,
                    commander.l1_file.read_bytes(),
                )
                publish_barrier.wait(timeout=2)
                memory_reflector._atomic_publish(
                    commander, workspace, before, staged, "claude-import"
                )
                after = memory_reflector._hash_snapshot(commander)
                return memory_reflector.CommanderResult(
                    commander.commander_id,
                    commander.name,
                    True,
                    report={
                        "status": "success",
                        "changes": {
                            "l1_changed": False,
                            "l2_changed": True,
                            "l3_changed": False,
                        },
                        "counts": {},
                        "hashes": {
                            "commander_before": before["commander"],
                            "commander_after": after["commander"],
                            "l1_before": before["l1"],
                            "l1_after": after["l1"],
                            "l2_before": before["l2"],
                            "l2_after": after["l2"],
                            "l3_before": before["l3"],
                            "l3_after": after["l3"],
                        },
                    },
                    phase="published",
                )

            with mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ), mock.patch.object(
                memory_reflector,
                "SHUTDOWN_REQUESTED",
                threading.Event(),
            ):
                results = memory_reflector._run_commander_batch(
                    commanders,
                    "claude-import",
                    None,
                    ["codex"],
                    None,
                    None,
                    0,
                    65536,
                    root,
                    memory_reflector.DEFAULT_MODEL,
                    2,
                    expected,
                )

            self.assertTrue(all(item.success for item in results))
            for commander in commanders:
                self.assertEqual(
                    expected[commander.commander_id],
                    memory_reflector._hash_snapshot(commander),
                )
                self.assertIn(
                    commander.commander_id,
                    commander.l2_file.read_text(encoding="utf-8"),
                )

    def test_execute_audits_only_after_failed_batch_peers_complete(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commanders = [
                create_commander(home, f"c{index}-id", f"C{index}")
                for index in range(4)
            ]
            args = argparse.Namespace(
                mode="weekly",
                staging_root=None,
                timeout_seconds=60,
                audit_timeout_seconds=30,
                fleet_timeout_seconds=600,
                no_timeout=False,
                max_concurrency=3,
                max_correction_rounds=0,
                model=memory_reflector.DEFAULT_MODEL,
                max_memory_bytes=65536,
            )
            passed_audit = audit_report(
                commanders, status="pass", correction_ids=[], findings=[]
            )
            lock = threading.Lock()
            active = 0
            invoked: set[str] = set()
            audit_called = False

            def fake_run(commander, *_args, **_kwargs):
                nonlocal active
                with lock:
                    active += 1
                    invoked.add(commander.commander_id)
                try:
                    time.sleep(0.01)
                    if commander.commander_id == "c1-id":
                        raise RuntimeError("isolated worker failure")
                    return success_result(commander)
                finally:
                    with lock:
                        active -= 1

            def fake_audit(_mode, _commanders, results, *_args):
                nonlocal audit_called
                audit_called = True
                with lock:
                    self.assertEqual(active, 0)
                    self.assertEqual(
                        invoked, {item.commander_id for item in commanders}
                    )
                self.assertEqual(
                    [item.commander_id for item in results],
                    [item.commander_id for item in commanders],
                )
                return memory_reflector.CodexResult(
                    True, None, passed_audit
                )

            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector, "discover_commanders", return_value=commanders
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ), mock.patch.object(
                memory_reflector, "run_aggregate_audit", side_effect=fake_audit
            ):
                exit_code, summary = memory_reflector.execute(args)

            self.assertEqual(exit_code, 1)
            self.assertTrue(audit_called)
            self.assertEqual(
                [item["commander_id"] for item in summary["commanders"]],
                [item.commander_id for item in commanders],
            )
            failed = next(
                item
                for item in summary["commanders"]
                if item["commander_id"] == "c1-id"
            )
            self.assertEqual(failed["error_code"], "commander_worker_failed")


class FleetBudgetAndCorrectionTests(unittest.TestCase):
    def weekly_args(self, *, max_correction_rounds: int = 2) -> argparse.Namespace:
        return argparse.Namespace(
            mode="weekly",
            staging_root=None,
            timeout_seconds=60,
            audit_timeout_seconds=30,
            fleet_timeout_seconds=600,
            no_timeout=False,
            max_concurrency=1,
            max_correction_rounds=max_correction_rounds,
            model=memory_reflector.DEFAULT_MODEL,
            max_memory_bytes=65536,
        )

    def test_bounded_timeout_reserves_audit_budget(self) -> None:
        with mock.patch.object(memory_reflector.time, "monotonic", return_value=100.0):
            self.assertEqual(memory_reflector._bounded_timeout(60, 130.0, 10), 20)
            self.assertEqual(memory_reflector._bounded_timeout(5, 130.0, 10), 5)
            self.assertIsNone(memory_reflector._bounded_timeout(60, 110.0, 10))

    def test_no_timeout_bypasses_all_deadlines_and_parallelizes_corrections(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commanders = [
                create_commander(home, "a-id", "Alpha"),
                create_commander(home, "b-id", "Beta"),
                create_commander(home, "c-id", "Gamma"),
            ]
            failed_audit = audit_report(
                commanders,
                status="fail",
                correction_ids=["c-id", "a-id"],
                findings=[blocking_finding("c-id", "a-id")],
            )
            passed_audit = audit_report(
                commanders, status="pass", correction_ids=[], findings=[]
            )
            args = self.weekly_args()
            args.no_timeout = True
            args.max_concurrency = 3
            active = 0
            lock = threading.Lock()
            correction_barrier = threading.Barrier(2)
            invocations: list[tuple[str, bool, int | None]] = []
            audit_timeouts: list[int | None] = []
            audit_messages = iter((failed_audit, passed_audit))

            def fake_run(
                commander,
                _mode,
                _inventory,
                _codex,
                timeout,
                *_args,
                **kwargs,
            ):
                nonlocal active
                is_correction = "correction_audit" in kwargs
                with lock:
                    active += 1
                    invocations.append(
                        (commander.commander_id, is_correction, timeout)
                    )
                try:
                    if is_correction:
                        correction_barrier.wait(timeout=2)
                    return success_result(commander)
                finally:
                    with lock:
                        active -= 1

            def fake_audit(
                _mode,
                _commanders,
                _results,
                _inventory,
                _codex,
                timeout,
                *_args,
            ):
                with lock:
                    self.assertEqual(active, 0)
                audit_timeouts.append(timeout)
                return memory_reflector.CodexResult(
                    True, None, next(audit_messages)
                )

            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector, "discover_commanders", return_value=commanders
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ), mock.patch.object(
                memory_reflector, "run_aggregate_audit", side_effect=fake_audit
            ), mock.patch.object(
                memory_reflector,
                "_bounded_timeout",
                side_effect=AssertionError("deadline helper must be bypassed"),
            ):
                exit_code, summary = memory_reflector.execute(args)

            self.assertEqual(exit_code, 0)
            self.assertTrue(summary["success"])
            self.assertTrue(summary["no_timeout"])
            self.assertIsNone(summary["fleet_timeout_seconds"])
            self.assertEqual(summary["max_concurrency"], 3)
            self.assertEqual(summary["correction_rounds"], [["a-id", "c-id"]])
            self.assertEqual(audit_timeouts, [None, None])
            self.assertTrue(all(timeout is None for _id, _correction, timeout in invocations))
            correction_invocations = [
                item[0] for item in invocations if item[1]
            ]
            self.assertEqual(len(correction_invocations), 2)
            self.assertEqual(set(correction_invocations), {"a-id", "c-id"})
            self.assertEqual(
                [item["commander_id"] for item in summary["commanders"]],
                ["a-id", "b-id", "c-id"],
            )

    def test_execute_reruns_only_aggregate_correction_ids_then_reaudits(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            first = create_commander(home, "a-id", "Alpha")
            second = create_commander(home, "b-id", "Beta")
            commanders = [first, second]
            failed_audit = audit_report(
                commanders,
                status="fail",
                correction_ids=["a-id"],
                findings=[blocking_finding("a-id")],
            )
            passed_audit = audit_report(
                commanders, status="pass", correction_ids=[], findings=[]
            )

            def fake_run(commander, *_args, **_kwargs):
                return success_result(commander)

            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector, "discover_commanders", return_value=commanders
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ) as run_agent, mock.patch.object(
                memory_reflector,
                "run_aggregate_audit",
                side_effect=[
                    memory_reflector.CodexResult(True, None, failed_audit),
                    memory_reflector.CodexResult(True, None, passed_audit),
                ],
            ) as run_audit:
                exit_code, summary = memory_reflector.execute(self.weekly_args())

            self.assertEqual(exit_code, 0)
            self.assertTrue(summary["success"])
            self.assertEqual(summary["correction_rounds"], [["a-id"]])
            self.assertEqual(run_agent.call_count, 3)
            corrected = run_agent.call_args_list[-1]
            self.assertEqual(corrected.args[0].commander_id, "a-id")
            self.assertEqual(corrected.kwargs["correction_audit"], failed_audit)
            self.assertEqual(
                corrected.kwargs["correction_initial_memory"]["l2"],
                b"# Working\n",
            )
            self.assertEqual(run_audit.call_count, 2)

    def test_execute_detects_earlier_commander_drift_before_audit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            first = create_commander(home, "a-id", "Alpha")
            second = create_commander(home, "b-id", "Beta")
            commanders = [first, second]

            def fake_run(commander, *_args, **_kwargs):
                if commander.commander_id == "b-id":
                    first.l2_file.write_text(
                        "# Working\n\n- Unattested drift.\n", encoding="utf-8"
                    )
                return success_result(commander)

            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector, "discover_commanders", return_value=commanders
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector, "run_commander", side_effect=fake_run
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.execute(self.weekly_args())

            self.assertEqual(
                raised.exception.code,
                "successful_publish_attestation_invalid",
            )

    def test_execute_fails_when_supported_roster_changes_before_audit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            first = create_commander(home, "a-id", "Alpha")
            added = create_commander(home, "b-id", "Beta")
            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector,
                "discover_commanders",
                side_effect=[[first], [first, added]],
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector,
                "run_commander",
                side_effect=lambda item, *_args, **_kwargs: success_result(item),
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.execute(self.weekly_args())

            self.assertEqual(raised.exception.code, "commander_roster_changed")

    def test_execute_rechecks_supported_roster_before_correction_edit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commander = create_commander(home, "a-id", "Alpha")
            added = create_commander(home, "b-id", "Beta")
            failed_audit = audit_report(
                [commander],
                status="fail",
                correction_ids=["a-id"],
                findings=[blocking_finding("a-id")],
            )
            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector,
                "discover_commanders",
                side_effect=[
                    [commander],
                    [commander],
                    [commander],
                    [commander],
                    [commander, added],
                ],
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector,
                "run_commander",
                side_effect=lambda item, *_args, **_kwargs: success_result(item),
            ) as run_agent, mock.patch.object(
                memory_reflector,
                "run_aggregate_audit",
                return_value=memory_reflector.CodexResult(
                    True, None, failed_audit
                ),
            ), self.assertRaises(memory_reflector.LauncherError) as raised:
                memory_reflector.execute(self.weekly_args())

            self.assertEqual(raised.exception.code, "commander_roster_changed")
            self.assertEqual(run_agent.call_count, 1)

    def test_execute_stops_after_the_configured_correction_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / ".happyherd"
            commander = create_commander(home, "a-id", "Alpha")
            commanders = [commander]
            failed_audit = audit_report(
                commanders,
                status="fail",
                correction_ids=["a-id"],
                findings=[blocking_finding("a-id")],
            )
            with mock.patch.dict(
                memory_reflector.os.environ, {"HAPPY_HOME_DIR": str(home)}
            ), mock.patch.object(
                memory_reflector, "discover_commanders", return_value=commanders
            ), mock.patch.object(
                memory_reflector, "default_codex_command", return_value=["codex"]
            ), mock.patch.object(
                memory_reflector, "validate_codex_cli"
            ), mock.patch.object(
                memory_reflector,
                "run_commander",
                side_effect=lambda item, *_args, **_kwargs: success_result(item),
            ) as run_agent, mock.patch.object(
                memory_reflector,
                "run_aggregate_audit",
                return_value=memory_reflector.CodexResult(True, None, failed_audit),
            ) as run_audit:
                exit_code, summary = memory_reflector.execute(
                    self.weekly_args(max_correction_rounds=1)
                )

            self.assertEqual(exit_code, 1)
            self.assertFalse(summary["success"])
            self.assertEqual(summary["correction_rounds"], [["a-id"]])
            self.assertEqual(run_agent.call_count, 2)
            self.assertEqual(run_audit.call_count, 2)


if __name__ == "__main__":
    unittest.main()
