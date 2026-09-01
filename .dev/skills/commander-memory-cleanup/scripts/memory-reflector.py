#!/usr/bin/env python3
"""Launch one semantic memory agent per HappyHerd Commander, then audit the fleet.

The launcher deliberately performs no semantic cleanup. It discovers, stages,
invokes, hashes, validates, and publishes mode-authorized agent output. Raw
Codex JSONL and last messages remain ephemeral and are never printed.
"""

from __future__ import annotations

import argparse
import atexit
import concurrent.futures
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence


SCHEMA_VERSION = 4
PROMPT_VERSION = "commander-memory-cleanup-v4"
INVENTORY_SCHEMA_VERSION = 2
COVERAGE_SCHEMA_VERSION = 1
L1_NAME = "0-observations.jsonl"
L2_NAME = "1-working-memory.md"
L3_NAME = "2-long-term-memory.md"
SOURCE_COVERAGE_NAME = "source-coverage.json"
AUDIT_COVERAGE_NAME = "audit-coverage.json"
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SAFE_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
TOP_LEVEL_LIST_RE = re.compile(r"^[-*+]\s+")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
SAFE_SUMMARY_MAX = 240
SAFE_REF_MAX = 1024
SAFE_SUMMARY_PATTERN = r"^[^\r\n]*[^\s\r\n][^\r\n]*$"
OPAQUE_REF_PATTERN = (
    r"^(/[^\r\n]*|[0-9a-f]{64}|[A-Za-z][A-Za-z0-9_-]*:[^\s]+)$"
)
SAFE_SUMMARY_RE = re.compile(SAFE_SUMMARY_PATTERN)
OPAQUE_REF_RE = re.compile(OPAQUE_REF_PATTERN)
MAX_REPORT_LIST_ITEMS = 4096
MAX_REPORT_EVIDENCE_ITEMS = 256
MAX_CODEX_JSONL_BYTES = 8 * 1024 * 1024
MAX_LAST_MESSAGE_BYTES = 8 * 1024 * 1024
MAX_COVERAGE_SIDECAR_BYTES = 512 * 1024
STDOUT_READ_CHUNK_BYTES = 64 * 1024
PROCESS_POLL_SECONDS = 0.05
PROCESS_TERMINATION_GRACE_SECONDS = 5.0
DEFAULT_MODEL = "gpt-5.6-sol"
DEFAULT_MAX_CORRECTION_ROUNDS = 2
DEFAULT_FLEET_TIMEOUT_SECONDS = 18_000
DEFAULT_MAX_CONCURRENCY = 1
MAX_MAX_CONCURRENCY = 3
ACTIVE_CHILDREN: set[subprocess.Popen[bytes]] = set()
ACTIVE_TEMP_ROOTS: set[Path] = set()
ACTIVE_STATE_LOCK = threading.RLock()
SHUTDOWN_REQUESTED = threading.Event()
ACTIVE_SPAWNS = 0
PENDING_SIGNAL: int | None = None
AUDIT_SEMANTIC_CHECKS = {
    "item_coverage": "source_item_gap",
    "singular_ownership": "ownership_conflict",
    "no_unjustified_duplication": "duplication",
    "stale_exclusion": "stale_inclusion",
    "sensitive_exclusion": "sensitive_inclusion",
    "report_only_candidates": "candidate_write_violation",
    "protected_files": "protected_file_change",
    "allowed_change_set": "disallowed_change",
    "all_commanders_treated": "agent_failure",
}
COVERAGE_DISPOSITIONS = frozenset(
    {
        "L2",
        "L3",
        "REPORT_SHARED",
        "REPORT_PROJECT",
        "EXCLUDE_STALE",
        "EXCLUDE_SENSITIVE",
        "NOT_RELEVANT",
    }
)
CODEX_ENV_ALLOWLIST = frozenset(
    {
        "HOME",
        "PATH",
        "USER",
        "LOGNAME",
        "SHELL",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "TMPDIR",
        "TZ",
        "CODEX_HOME",
        "CODEX_CI",
        "CODEX_MANAGED_BY_NPM",
        "CODEX_MANAGED_PACKAGE_ROOT",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
    }
)


def _load_secret_patterns() -> list[re.Pattern[str]]:
    candidates = (
        Path(__file__).absolute().parents[2]
        / "systemops-preserve-ai-state/scripts/secret_patterns.py",
        Path(__file__).resolve().parents[2]
        / "systemops-preserve-ai-state/scripts/secret_patterns.py",
        Path.home() / ".claude/skills/systemops-preserve-ai-state/scripts/secret_patterns.py",
    )
    for owner in candidates:
        if owner.exists():
            break
    else:
        raise FileNotFoundError(
            "systemops-preserve-ai-state secret pattern owner was not found; tried: "
            + ", ".join(str(candidate) for candidate in candidates)
        )
    spec = importlib.util.spec_from_file_location("ai_state_secret_patterns", owner)
    if spec is None or spec.loader is None:
        raise RuntimeError("systemops-preserve-ai-state secret pattern owner is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return list(module.SECRET_PATTERNS)


SECRET_PATTERNS = _load_secret_patterns()


class LauncherError(Exception):
    """A fail-closed launcher error safe to expose by code only."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Commander:
    commander_id: str
    name: str
    root: Path
    commander_file: Path
    l1_file: Path
    l2_file: Path
    l3_file: Path


@dataclass
class CommanderResult:
    commander_id: str
    name: str
    success: bool
    error_code: str | None = None
    report: dict[str, Any] | None = None
    coverage: dict[str, Any] | None = None
    phase: str = "not_started"
    coverage_item_count: int = 0
    elapsed_seconds: float = 0.0


@dataclass
class CodexResult:
    success: bool
    error_code: str | None
    message: dict[str, Any] | None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def contains_secret(value: bytes | str) -> bool:
    text = value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value
    return any(pattern.search(text) for pattern in SECRET_PATTERNS)


def write_control_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json(value) + b"\n")


def default_happy_command() -> list[str]:
    configured = os.environ.get("HAPPY_CLI_BIN")
    if configured:
        return [configured]
    installed = shutil.which("happy")
    if installed:
        return [installed]
    source_entrypoint = (
        Path.home()
        / "App/apps/happyherd/server/packages/happy-cli/bin/happy.mjs"
    )
    return ["node", str(source_entrypoint)]


def default_codex_command() -> list[str]:
    configured = os.environ.get("CODEX_BIN")
    if configured:
        return [configured]
    installed = shutil.which("codex")
    if not installed:
        raise LauncherError("codex_not_found")
    return [installed]


def isolated_codex_env(source: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ if source is None else source
    return {key: value for key, value in env.items() if key in CODEX_ENV_ALLOWLIST}


def validate_codex_cli(codex_command: Sequence[str]) -> None:
    try:
        completed = subprocess.run(
            [*codex_command, "exec", "--help"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=isolated_codex_env(),
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LauncherError("codex_cli_canary_failed") from exc
    required = (
        b"--ephemeral",
        b"--json",
        b"--ignore-user-config",
        b"--ignore-rules",
        b"--output-schema",
        b"--output-last-message",
    )
    if completed.returncode != 0 or any(flag not in completed.stdout for flag in required):
        raise LauncherError("codex_cli_canary_failed")


def _safe_child_env(happy_home: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["HAPPY_HOME_DIR"] = str(happy_home)
    return env


def _canonical_real_directory(path: Path, parent: Path | None = None) -> Path:
    try:
        if path.is_symlink() or not path.is_dir():
            raise LauncherError("commander_path_invalid")
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise LauncherError("commander_path_invalid") from exc
    if resolved != path or (parent is not None and resolved.parent != parent):
        raise LauncherError("commander_path_invalid")
    return resolved


def _canonical_real_file(path: Path, root: Path, parent: Path) -> Path:
    try:
        if path.is_symlink() or not path.is_file():
            raise LauncherError("commander_memory_missing")
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise LauncherError("commander_path_invalid") from exc
    if (
        resolved != path
        or resolved.parent != parent
        or not resolved.is_relative_to(root)
    ):
        raise LauncherError("commander_path_invalid")
    return resolved


def _canonical_file_below_real_root(path: Path, root: Path) -> Path:
    if not path.is_absolute():
        raise LauncherError("commander_path_invalid")
    canonical_root = _canonical_real_directory(root)
    try:
        relative = path.relative_to(canonical_root)
    except ValueError as exc:
        raise LauncherError("commander_path_invalid") from exc
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise LauncherError("commander_path_invalid")
    parent = canonical_root
    for part in relative.parts[:-1]:
        parent = _canonical_real_directory(parent / part, parent)
    return _canonical_real_file(parent / relative.name, canonical_root, parent)


def discover_commanders(
    happy_command: Sequence[str], happy_home: Path, timeout_seconds: int = 60
) -> list[Commander]:
    try:
        completed = subprocess.run(
            [*happy_command, "commander", "list", "--json"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_safe_child_env(happy_home),
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LauncherError("commander_discovery_failed") from exc
    if completed.returncode != 0:
        raise LauncherError("commander_discovery_failed")
    try:
        payload = json.loads(completed.stdout)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LauncherError("commander_discovery_invalid_json") from exc
    raw_commanders = payload.get("commanders") if isinstance(payload, dict) else None
    if not isinstance(raw_commanders, list) or not raw_commanders:
        raise LauncherError("commander_roster_empty")

    commanders: list[Commander] = []
    seen: set[str] = set()
    try:
        canonical_happy_home = happy_home.resolve(strict=True)
    except OSError as exc:
        raise LauncherError("commander_path_invalid") from exc
    registry_root = _canonical_real_directory(
        canonical_happy_home / "commanders", canonical_happy_home
    )
    for raw in raw_commanders:
        if not isinstance(raw, dict):
            raise LauncherError("commander_roster_invalid")
        commander_id = raw.get("id")
        name = raw.get("name")
        if (
            not isinstance(commander_id, str)
            or not SAFE_ID_RE.fullmatch(commander_id)
            or not isinstance(name, str)
            or not name.strip()
            or commander_id in seen
        ):
            raise LauncherError("commander_roster_invalid")
        seen.add(commander_id)
        root = _canonical_real_directory(registry_root / commander_id, registry_root)
        agentcontext_root = _canonical_real_directory(root / "agentcontext", root)
        memory_root = _canonical_real_directory(
            agentcontext_root / "memory", agentcontext_root
        )
        commander_file = _canonical_real_file(root / "COMMANDER.md", root, root)
        paths = (
            commander_file,
            _canonical_real_file(memory_root / L1_NAME, root, memory_root),
            _canonical_real_file(memory_root / L2_NAME, root, memory_root),
            _canonical_real_file(memory_root / L3_NAME, root, memory_root),
        )
        advertised = raw.get("commanderPath")
        if not isinstance(advertised, str):
            raise LauncherError("commander_identity_mismatch")
        try:
            raw_advertised_path = Path(advertised)
            advertised_path = raw_advertised_path.resolve(strict=True)
        except OSError as exc:
            raise LauncherError("commander_identity_mismatch") from exc
        if (
            not raw_advertised_path.is_absolute()
            or raw_advertised_path.is_symlink()
            or raw_advertised_path != commander_file
            or advertised_path != commander_file
        ):
            raise LauncherError("commander_identity_mismatch")
        commanders.append(
            Commander(
                commander_id=commander_id,
                name=name.strip(),
                root=root,
                commander_file=commander_file,
                l1_file=paths[1],
                l2_file=paths[2],
                l3_file=paths[3],
            )
        )
    return sorted(commanders, key=lambda item: item.commander_id)


def _inventory_digest(
    files: list[dict[str, Any]], items: list[dict[str, Any]]
) -> str:
    digest = hashlib.sha256()
    for item in sorted(
        files, key=lambda value: (value["source_root"], value["relative_path"])
    ):
        digest.update(item["source_root"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(item["relative_path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(item["bytes"]).encode("ascii"))
        digest.update(b"\0")
        digest.update(item["sha256"].encode("ascii"))
        digest.update(b"\n")
    digest.update(canonical_json(items))
    return digest.hexdigest()


def _opaque_item_id(
    source_root: str,
    relative_path: str,
    origin: str,
    ordinal: int,
    digest: str,
) -> str:
    value = f"{source_root}\0{relative_path}\0{origin}\0{ordinal}\0{digest}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _local_markdown_links(
    text: str, memory_file: Path, source_root: Path
) -> tuple[list[str], list[str]]:
    linked: set[str] = set()
    missing: set[str] = set()
    root = source_root.resolve()
    for match in MARKDOWN_LINK_RE.finditer(text):
        raw_target = match.group(1).strip()
        if raw_target.startswith("<") and ">" in raw_target:
            raw_target = raw_target[1 : raw_target.index(">")]
        else:
            raw_target = raw_target.split(maxsplit=1)[0]
        target_without_fragment = raw_target.split("#", 1)[0].split("?", 1)[0]
        if (
            not target_without_fragment
            or "://" in target_without_fragment
            or Path(target_without_fragment).is_absolute()
            or not target_without_fragment.lower().endswith(".md")
        ):
            continue
        candidate = memory_file.parent / target_without_fragment
        resolved = candidate.resolve()
        try:
            relative = resolved.relative_to(root).as_posix()
        except ValueError:
            continue
        if resolved.is_file() and not resolved.is_symlink():
            linked.add(relative)
        else:
            missing.add(relative)
    return sorted(linked), sorted(missing)


def _memory_index_items(memory_file: Path, source_root: Path) -> list[dict[str, Any]]:
    try:
        raw_lines = memory_file.read_bytes().splitlines(keepends=True)
        decoded_lines = [line.decode("utf-8") for line in raw_lines]
    except (OSError, UnicodeDecodeError) as exc:
        raise LauncherError("source_inventory_invalid") from exc
    spans: list[tuple[int, int]] = []
    current_start: int | None = None
    in_fence = False
    fence_marker: str | None = None

    def close(end: int) -> None:
        nonlocal current_start
        if current_start is not None:
            spans.append((current_start, end))
            current_start = None

    for index, line in enumerate(decoded_lines):
        stripped = line.rstrip("\r\n")
        fence = re.match(r"^\s*(```|~~~)", stripped)
        if fence:
            marker = fence.group(1)
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = None
        if in_fence or fence:
            if current_start is None:
                current_start = index
            continue
        if re.match(r"^#{1,6}\s+", stripped):
            close(index)
            continue
        if TOP_LEVEL_LIST_RE.match(stripped):
            close(index)
            current_start = index
            continue
        if stripped.strip() and current_start is None:
            current_start = index
    close(len(decoded_lines))

    items: list[dict[str, Any]] = []
    memory_relative = memory_file.relative_to(source_root).as_posix()
    for ordinal, (start, end) in enumerate(spans, start=1):
        block = b"".join(raw_lines[start:end]).strip()
        if not block:
            continue
        digest = sha256_bytes(block)
        text = block.decode("utf-8")
        linked, missing = _local_markdown_links(text, memory_file, source_root)
        origin = "indexed" if linked or missing else "inline_only"
        items.append(
            {
                "item_id": _opaque_item_id(
                    str(source_root), memory_relative, origin, ordinal, digest
                ),
                "origin": origin,
                "source_root": str(source_root),
                "relative_path": memory_relative,
                "start_line": start + 1,
                "end_line": end,
                "bytes": len(block),
                "sha256": digest,
                "linked_files": linked,
                "missing_linked_files": missing,
            }
        )
    return items


def build_inventory(source_roots: Iterable[Path]) -> dict[str, Any]:
    roots: list[Path] = []
    seen_roots: set[Path] = set()
    for raw_root in source_roots:
        root = raw_root.expanduser().resolve()
        if root in seen_roots or not root.is_dir():
            raise LauncherError("source_root_invalid")
        seen_roots.add(root)
        roots.append(root)
    if not roots:
        raise LauncherError("source_root_required")

    files: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()
    for root in sorted(roots, key=str):
        for path in sorted(root.rglob("*"), key=lambda value: value.as_posix()):
            if path.is_symlink():
                raise LauncherError("source_symlink_forbidden")
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            key = (str(root), relative)
            if key in seen_keys:
                raise LauncherError("source_inventory_duplicate")
            seen_keys.add(key)
            stat = path.stat()
            files.append(
                {
                    "source_root": str(root),
                    "relative_path": relative,
                    "bytes": stat.st_size,
                    "sha256": sha256_file(path),
                }
            )
    if not files:
        raise LauncherError("source_inventory_empty")
    files.sort(key=lambda value: (value["source_root"], value["relative_path"]))
    items: list[dict[str, Any]] = []
    referenced: dict[str, set[str]] = {str(root): set() for root in roots}
    for root in sorted(roots, key=str):
        memory_file = root / "MEMORY.md"
        if not memory_file.is_file() or memory_file.is_symlink():
            raise LauncherError("source_memory_index_missing")
        root_items = _memory_index_items(memory_file, root)
        if any(item["missing_linked_files"] for item in root_items):
            raise LauncherError("source_inventory_missing_link")
        items.extend(root_items)
        for item in root_items:
            referenced[str(root)].update(item["linked_files"])
    for file_entry in files:
        if file_entry["relative_path"] == "MEMORY.md":
            continue
        if file_entry["relative_path"] in referenced[file_entry["source_root"]]:
            continue
        path = Path(file_entry["source_root"]) / file_entry["relative_path"]
        line_count = len(path.read_bytes().splitlines())
        items.append(
            {
                "item_id": _opaque_item_id(
                    file_entry["source_root"],
                    file_entry["relative_path"],
                    "unindexed",
                    1,
                    file_entry["sha256"],
                ),
                "origin": "unindexed",
                "source_root": file_entry["source_root"],
                "relative_path": file_entry["relative_path"],
                "start_line": 1,
                "end_line": line_count,
                "bytes": file_entry["bytes"],
                "sha256": file_entry["sha256"],
                "linked_files": [],
                "missing_linked_files": [],
            }
        )
    items.sort(key=lambda value: value["item_id"])
    if not items:
        raise LauncherError("source_inventory_empty")
    counts = {
        origin: sum(item["origin"] == origin for item in items)
        for origin in ("indexed", "inline_only", "unindexed")
    }
    return {
        "schema_version": INVENTORY_SCHEMA_VERSION,
        "files": files,
        "items": items,
        "file_count": len(files),
        "byte_count": sum(item["bytes"] for item in files),
        "item_count": len(items),
        "indexed_item_count": counts["indexed"],
        "inline_only_item_count": counts["inline_only"],
        "unindexed_item_count": counts["unindexed"],
        "aggregate_sha256": _inventory_digest(files, items),
    }


def load_inventory(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_bytes())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LauncherError("source_inventory_invalid") from exc
    validate_inventory_shape(payload)
    verify_inventory_files(payload)
    return payload


def validate_inventory_shape(payload: Any) -> None:
    if not isinstance(payload, dict) or set(payload) != {
        "schema_version",
        "files",
        "items",
        "file_count",
        "byte_count",
        "item_count",
        "indexed_item_count",
        "inline_only_item_count",
        "unindexed_item_count",
        "aggregate_sha256",
    }:
        raise LauncherError("source_inventory_invalid")
    files = payload.get("files")
    items = payload.get("items")
    if (
        payload.get("schema_version") != INVENTORY_SCHEMA_VERSION
        or not isinstance(files, list)
        or not isinstance(items, list)
    ):
        raise LauncherError("source_inventory_invalid")
    if (
        not files
        or not items
        or payload.get("file_count") != len(files)
        or payload.get("item_count") != len(items)
    ):
        raise LauncherError("source_inventory_invalid")
    seen: set[tuple[str, str]] = set()
    byte_count = 0
    for item in files:
        if not isinstance(item, dict) or set(item) != {
            "source_root",
            "relative_path",
            "bytes",
            "sha256",
        }:
            raise LauncherError("source_inventory_invalid")
        source_root = item.get("source_root")
        relative_path = item.get("relative_path")
        size = item.get("bytes")
        digest = item.get("sha256")
        if (
            not isinstance(source_root, str)
            or not Path(source_root).is_absolute()
            or not isinstance(relative_path, str)
            or not relative_path
            or Path(relative_path).is_absolute()
            or ".." in Path(relative_path).parts
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or not isinstance(digest, str)
            or not HASH_RE.fullmatch(digest)
        ):
            raise LauncherError("source_inventory_invalid")
        key = (source_root, relative_path)
        if key in seen:
            raise LauncherError("source_inventory_duplicate")
        seen.add(key)
        byte_count += size
    if payload.get("byte_count") != byte_count:
        raise LauncherError("source_inventory_invalid")
    item_keys = {
        "item_id",
        "origin",
        "source_root",
        "relative_path",
        "start_line",
        "end_line",
        "bytes",
        "sha256",
        "linked_files",
        "missing_linked_files",
    }
    seen_item_ids: set[str] = set()
    origin_counts = {"indexed": 0, "inline_only": 0, "unindexed": 0}
    known_files = {(item["source_root"], item["relative_path"]) for item in files}
    for item in items:
        if not isinstance(item, dict) or set(item) != item_keys:
            raise LauncherError("source_inventory_invalid")
        item_id = item.get("item_id")
        origin = item.get("origin")
        if (
            not isinstance(item_id, str)
            or not HASH_RE.fullmatch(item_id)
            or item_id in seen_item_ids
            or origin not in origin_counts
            or (item.get("source_root"), item.get("relative_path")) not in known_files
            or not isinstance(item.get("start_line"), int)
            or not isinstance(item.get("end_line"), int)
            or item["start_line"] < 1
            or item["end_line"] < item["start_line"]
            or not isinstance(item.get("bytes"), int)
            or item["bytes"] < 0
            or not isinstance(item.get("sha256"), str)
            or not HASH_RE.fullmatch(item["sha256"])
            or not isinstance(item.get("linked_files"), list)
            or not isinstance(item.get("missing_linked_files"), list)
            or any(not isinstance(value, str) for value in item["linked_files"])
            or any(not isinstance(value, str) for value in item["missing_linked_files"])
        ):
            raise LauncherError("source_inventory_invalid")
        seen_item_ids.add(item_id)
        origin_counts[origin] += 1
    if (
        payload.get("item_count") != len(items)
        or payload.get("indexed_item_count") != origin_counts["indexed"]
        or payload.get("inline_only_item_count") != origin_counts["inline_only"]
        or payload.get("unindexed_item_count") != origin_counts["unindexed"]
    ):
        raise LauncherError("source_inventory_invalid")
    if payload.get("aggregate_sha256") != _inventory_digest(files, items):
        raise LauncherError("source_inventory_invalid")


def verify_inventory_files(inventory: dict[str, Any]) -> None:
    for item in inventory["files"]:
        root = Path(item["source_root"])
        path = root / item["relative_path"]
        try:
            resolved = path.resolve(strict=True)
        except OSError as exc:
            raise LauncherError("source_inventory_changed") from exc
        try:
            resolved.relative_to(root.resolve(strict=True))
        except (OSError, ValueError) as exc:
            raise LauncherError("source_inventory_changed") from exc
        if (
            path.is_symlink()
            or not resolved.is_file()
            or resolved.stat().st_size != item["bytes"]
            or sha256_file(resolved) != item["sha256"]
        ):
            raise LauncherError("source_inventory_changed")
    roots = sorted({Path(item["source_root"]) for item in inventory["files"]}, key=str)
    current = build_inventory(roots)
    if current != inventory:
        raise LauncherError("source_inventory_changed")


def _hash_snapshot(commander: Commander) -> dict[str, str]:
    return {
        "commander": sha256_file(commander.commander_file),
        "l1": sha256_file(commander.l1_file),
        "l2": sha256_file(commander.l2_file),
        "l3": sha256_file(commander.l3_file),
    }


def _hash_schema(before: dict[str, str], allow_l1_change: bool) -> dict[str, Any]:
    keys = (
        "commander_before",
        "commander_after",
        "l1_before",
        "l1_after",
        "l2_before",
        "l2_after",
        "l3_before",
        "l3_after",
    )
    constants = {
        "commander_before": before["commander"],
        "commander_after": before["commander"],
        "l1_before": before["l1"],
        "l2_before": before["l2"],
        "l3_before": before["l3"],
    }
    if not allow_l1_change:
        constants["l1_after"] = before["l1"]
    properties: dict[str, Any] = {}
    for key in keys:
        properties[key] = (
            {"type": "string", "const": constants[key]}
            if key in constants
            else {"type": "string", "pattern": "^[0-9a-f]{64}$"}
        )
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(keys),
        "properties": properties,
    }


def _safe_summary_schema() -> dict[str, Any]:
    return {
        "type": "string",
        "minLength": 1,
        "maxLength": SAFE_SUMMARY_MAX,
        "pattern": SAFE_SUMMARY_PATTERN,
    }


def _opaque_ref_schema() -> dict[str, Any]:
    return {
        "type": "string",
        "minLength": 1,
        "maxLength": SAFE_REF_MAX,
        "pattern": OPAQUE_REF_PATTERN,
    }


def _candidate_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["summary", "target", "evidence"],
        "properties": {
            "summary": _safe_summary_schema(),
            "target": _opaque_ref_schema(),
            "evidence": {
                "type": "array",
                "items": _opaque_ref_schema(),
                "minItems": 1,
                "maxItems": MAX_REPORT_EVIDENCE_ITEMS,
            },
        },
    }


def build_agent_schema(
    commander: Commander,
    mode: str,
    before: dict[str, str],
    inventory: dict[str, Any] | None,
    run_nonce: str,
) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "schema_version": {"type": "integer", "const": SCHEMA_VERSION},
        "prompt_version": {"type": "string", "const": PROMPT_VERSION},
        "mode": {"type": "string", "const": mode},
        "commander_id": {"type": "string", "const": commander.commander_id},
        "commander_name": {"type": "string", "const": commander.name},
        "status": {"type": "string", "enum": ["success", "blocked"]},
        "changes": {
            "type": "object",
            "additionalProperties": False,
            "required": ["l1_changed", "l2_changed", "l3_changed"],
            "properties": {
                "l1_changed": {"type": "boolean"},
                "l2_changed": {"type": "boolean"},
                "l3_changed": {"type": "boolean"},
            },
        },
        "counts": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "l2_kept_or_added",
                "l3_kept_or_added",
                "dropped",
            ],
            "properties": {
                key: {"type": "integer", "minimum": 0}
                for key in (
                    "l2_kept_or_added",
                    "l3_kept_or_added",
                    "dropped",
                )
            },
        },
        "hashes": _hash_schema(before, mode == "reflector"),
        "files_examined": {
            "type": "array",
            "items": _opaque_ref_schema(),
            "minItems": 1,
            "maxItems": MAX_REPORT_LIST_ITEMS,
        },
        "shared_candidates": {
            "type": "array",
            "items": _candidate_schema(),
            "maxItems": MAX_REPORT_LIST_ITEMS,
        },
        "project_candidates": {
            "type": "array",
            "items": _candidate_schema(),
            "maxItems": MAX_REPORT_LIST_ITEMS,
        },
        "uncertainties": {
            "type": "array",
            "items": _safe_summary_schema(),
            "maxItems": MAX_REPORT_LIST_ITEMS,
        },
        "blockers": {
            "type": "array",
            "items": _safe_summary_schema(),
            "maxItems": MAX_REPORT_LIST_ITEMS,
        },
    }
    required = list(properties)
    if mode == "reflector":
        observation_action = {
            "type": "object",
            "additionalProperties": False,
            "required": ["source_sha256"],
            "properties": {
                "source_sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                }
            },
        }
        properties["l1_retention"] = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "merged_medium",
                "removed_rule_promoted",
                "removed_expired_low",
                "observer_contract_breaches",
            ],
            "properties": {
                "merged_medium": {
                    "type": "array",
                    "maxItems": MAX_REPORT_LIST_ITEMS,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["source_sha256", "result_sha256"],
                        "properties": {
                            "source_sha256": {
                                "type": "array",
                                "minItems": 2,
                                "maxItems": MAX_REPORT_LIST_ITEMS,
                                "items": {
                                    "type": "string",
                                    "pattern": "^[0-9a-f]{64}$",
                                },
                            },
                            "result_sha256": {
                                "type": "string",
                                "pattern": "^[0-9a-f]{64}$",
                            },
                        },
                    },
                },
                "removed_rule_promoted": {
                    "type": "array",
                    "maxItems": MAX_REPORT_LIST_ITEMS,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["source_sha256", "rule_path"],
                        "properties": {
                            "source_sha256": observation_action["properties"]["source_sha256"],
                            "rule_path": {"type": "string", "minLength": 1, "maxLength": SAFE_REF_MAX},
                        },
                    },
                },
                "removed_expired_low": {
                    "type": "array",
                    "maxItems": MAX_REPORT_LIST_ITEMS,
                    "items": observation_action,
                },
                "observer_contract_breaches": {
                    "type": "array",
                    "maxItems": MAX_REPORT_LIST_ITEMS,
                    "items": _safe_summary_schema(),
                },
            },
        }
        required.append("l1_retention")
    if inventory is not None:
        properties["inventory"] = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "aggregate_sha256",
                "files_expected", "bytes_expected", "files_examined",
                "bytes_examined", "items_expected", "items_examined",
                "indexed_items", "inline_only_items", "unindexed_items",
            ],
            "properties": {
                "aggregate_sha256": {
                    "type": "string",
                    "const": inventory["aggregate_sha256"],
                },
                "files_expected": {
                    "type": "integer",
                    "const": inventory["file_count"],
                },
                "bytes_expected": {
                    "type": "integer",
                    "const": inventory["byte_count"],
                },
                "files_examined": {
                    "type": "integer",
                    "const": inventory["file_count"],
                },
                "bytes_examined": {
                    "type": "integer",
                    "const": inventory["byte_count"],
                },
                "items_expected": {
                    "type": "integer",
                    "const": inventory["item_count"],
                },
                "items_examined": {
                    "type": "integer",
                    "const": inventory["item_count"],
                },
                "indexed_items": {
                    "type": "integer",
                    "const": inventory["indexed_item_count"],
                },
                "inline_only_items": {
                    "type": "integer",
                    "const": inventory["inline_only_item_count"],
                },
                "unindexed_items": {
                    "type": "integer",
                    "const": inventory["unindexed_item_count"],
                },
            },
        }
        properties["coverage_attestation"] = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "schema_version",
                "run_nonce",
                "sidecar_sha256",
                "inventory_sha256",
                "items_expected",
                "items_examined",
                "stage_sha256",
            ],
            "properties": {
                "schema_version": {
                    "type": "integer",
                    "const": COVERAGE_SCHEMA_VERSION,
                },
                "run_nonce": {"type": "string", "const": run_nonce},
                "sidecar_sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "inventory_sha256": {
                    "type": "string",
                    "const": inventory["aggregate_sha256"],
                },
                "items_expected": {
                    "type": "integer",
                    "const": inventory["item_count"],
                },
                "items_examined": {
                    "type": "integer",
                    "const": inventory["item_count"],
                },
                "stage_sha256": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["l1", "l2", "l3"],
                    "properties": {
                        key: {
                            "type": "string",
                            "pattern": "^[0-9a-f]{64}$",
                        }
                        for key in ("l1", "l2", "l3")
                    },
                },
            },
        }
        required.extend(("inventory", "coverage_attestation"))
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def build_agent_prompt(
    commander: Commander,
    mode: str,
    skill_path: Path,
    workspace: Path,
    inventory_path: Path | None,
    correction_context_path: Path | None,
    run_nonce: str,
) -> str:
    inventory_instruction = (
        "There is no import inventory. Use only bounded, relevant HappyHerd evidence."
        if inventory_path is None
        else (
            f"Read the immutable inventory at {inventory_path}. Examine every opaque "
            "source item and every linked or unindexed source file semantically. The "
            f"launcher precreated {workspace / SOURCE_COVERAGE_NAME} for run {run_nonce} "
            "with the exact sorted opaque item IDs and empty disposition lists. Do not "
            "change its header, keys, row order, or item IDs. Fill every empty list with "
            "one or more unique dispositions chosen from L2, L3, "
            "REPORT_SHARED, REPORT_PROJECT, EXCLUDE_STALE, EXCLUDE_SENSITIVE, and "
            "NOT_RELEVANT. NOT_RELEVANT cannot be combined with another disposition. "
            "Choose every disposition yourself from the source semantics; a tool may "
            "serialize your choices but must not classify them. Do not leave any list "
            "empty. Hash the exact final sidecar bytes and return only its compact "
            "coverage_attestation, including the final staged L1/L2/L3 hashes, in the "
            "final JSON; do not repeat coverage rows there."
        )
    )
    l1_instruction = (
        f"Staged L1 retention output: {workspace / L1_NAME}\n"
        "You may rewrite staged L1 only to merge same-topic medium observations, "
        "remove observations already represented in an owning rule, and remove "
        "expired low observations. Retain every other high/medium record; L2/L3 "
        "presence is not deletion authority. Report observer noise as a breach "
        "instead of deleting it."
        if mode == "reflector"
        else "Live and staged L1 are immutable in migration mode."
    )
    correction_instruction = (
        "This is an initial pass; there is no prior aggregate audit."
        if correction_context_path is None
        else (
            f"This is an auditor-directed correction pass. Read {correction_context_path}. "
            "It supplies the immutable initial L1/L2/L3 baselines, the exact current "
            "staged/live paths, and the prior audit. Snapshot paths embedded in the prior "
            "audit may have expired; use only the supplied paths. Recover lost relevant "
            "content, address blocking findings naming this Commander, and do not widen scope."
        )
    )
    return f"""You are the sole semantic memory agent for one HappyHerd Commander.

Prompt contract: {PROMPT_VERSION}
Read and follow the complete skill at: {skill_path}
Mode: {mode}
Commander ID: {commander.commander_id}
Commander name: {commander.name}
Commander root (read-only): {commander.root}
{l1_instruction}
Staged L2 output: {workspace / L2_NAME}
Staged L3 output: {workspace / L3_NAME}

The staged memory files and, when supplied, the precreated coverage sidecar are
isolated outputs and are the only files you may edit. Never
edit live HappyHerd memory, COMMANDER.md, an import source, shared/project
context, proposals, task state, or any other file. Use your own judgment to
classify, synthesize, and route evidence; do not ask a deterministic script to
distill prose. Shared/project candidates belong only in your final report.

Use SHA-256 identifiers calculated from each exact JSONL record excluding its
LF or CRLF line terminator for every L1 retention
declaration. Evidence fields contain only opaque source item IDs,
absolute paths, 64-character lowercase SHA-256 IDs, or typed references in the
form `kind:value` with no whitespace in the value. Summaries are one non-empty
bounded line and must paraphrase the judgment without copying source excerpts,
transcript text, secret material, or unnecessary personal detail. Return only
the semantic counts requested by the schema; the launcher mechanically derives
shared/project reported counts from the final candidate-array lengths.

{inventory_instruction}
{correction_instruction}

Before finishing, read back the staged files, calculate the hashes required by
the output schema, and honestly report blockers or uncertainty. A zero-change
result is valid. Return only the JSON object required by the supplied schema.
"""


def codex_exec_command(
    codex_command: Sequence[str],
    workspace: Path,
    schema_path: Path,
    last_message_path: Path,
    sandbox: str,
    model: str,
) -> list[str]:
    command = [
        *codex_command,
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        "--model",
        model,
        "-C",
        str(workspace),
        "--sandbox",
        sandbox,
        "-c",
        "approval_policy=never",
        "-c",
        "model_reasoning_effort=max",
    ]
    if sandbox == "workspace-write":
        command.extend(
            [
                "-c",
                "sandbox_workspace_write.exclude_tmpdir_env_var=true",
                "-c",
                "sandbox_workspace_write.exclude_slash_tmp=true",
            ]
        )
    command.extend(
        [
        "--skip-git-repo-check",
        "--output-schema",
        str(schema_path),
        "-o",
        str(last_message_path),
        "-",
        ]
    )
    return command


def _process_group_exists(process_group_id: int) -> bool:
    try:
        os.killpg(process_group_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _wait_for_process_group_exit(
    process: subprocess.Popen[bytes], grace_seconds: float
) -> bool:
    deadline = time.monotonic() + grace_seconds
    while _process_group_exists(process.pid):
        process.poll()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(PROCESS_POLL_SECONDS, remaining))
    process.poll()
    return True


def _terminate_process_group(
    process: subprocess.Popen[bytes],
    grace_seconds: float = PROCESS_TERMINATION_GRACE_SECONDS,
) -> None:
    process_group_id = process.pid
    if not _process_group_exists(process_group_id):
        process.poll()
        return
    try:
        os.killpg(process_group_id, signal.SIGTERM)
    except ProcessLookupError:
        process.poll()
        return
    if _wait_for_process_group_exit(process, grace_seconds):
        return
    try:
        os.killpg(process_group_id, signal.SIGKILL)
    except ProcessLookupError:
        process.poll()
        return
    _wait_for_process_group_exit(process, grace_seconds)


def _register_active_child(process: subprocess.Popen[bytes]) -> bool:
    with ACTIVE_STATE_LOCK:
        if SHUTDOWN_REQUESTED.is_set():
            return False
        ACTIVE_CHILDREN.add(process)
        return True


def _begin_child_spawn() -> bool:
    global ACTIVE_SPAWNS
    with ACTIVE_STATE_LOCK:
        if SHUTDOWN_REQUESTED.is_set():
            return False
        ACTIVE_SPAWNS += 1
        return True


def _finish_child_spawn() -> None:
    global ACTIVE_SPAWNS
    with ACTIVE_STATE_LOCK:
        ACTIVE_SPAWNS -= 1


def _raise_pending_signal() -> None:
    global PENDING_SIGNAL
    with ACTIVE_STATE_LOCK:
        signum = PENDING_SIGNAL
        PENDING_SIGNAL = None
    if signum is not None:
        raise SystemExit(128 + signum)


def _discard_active_child(process: subprocess.Popen[bytes]) -> None:
    with ACTIVE_STATE_LOCK:
        ACTIVE_CHILDREN.discard(process)


def _release_terminated_child(process: subprocess.Popen[bytes]) -> bool:
    if _process_group_exists(process.pid):
        SHUTDOWN_REQUESTED.set()
        with ACTIVE_STATE_LOCK:
            ACTIVE_CHILDREN.add(process)
        return False
    _discard_active_child(process)
    return True


def _register_active_temp_root(root: Path) -> bool:
    with ACTIVE_STATE_LOCK:
        if SHUTDOWN_REQUESTED.is_set():
            return False
        ACTIVE_TEMP_ROOTS.add(root)
        return True


def _discard_active_temp_root(root: Path) -> None:
    with ACTIVE_STATE_LOCK:
        ACTIVE_TEMP_ROOTS.discard(root)


def cleanup_active_state(*, remove_temp_roots: bool = True) -> None:
    SHUTDOWN_REQUESTED.set()
    with ACTIVE_STATE_LOCK:
        children = list(ACTIVE_CHILDREN)
        roots = list(ACTIVE_TEMP_ROOTS)
    for child in children:
        _terminate_process_group(child)
    if remove_temp_roots:
        for root in roots:
            shutil.rmtree(root, ignore_errors=True)
    with ACTIVE_STATE_LOCK:
        for child in children:
            if not _process_group_exists(child.pid):
                ACTIVE_CHILDREN.discard(child)
        if remove_temp_roots:
            for root in roots:
                ACTIVE_TEMP_ROOTS.discard(root)


def install_signal_handlers() -> None:
    def handle(signum: int, _frame: Any) -> None:
        global PENDING_SIGNAL
        with ACTIVE_STATE_LOCK:
            defer_exit = ACTIVE_SPAWNS > 0
            if defer_exit and PENDING_SIGNAL is None:
                PENDING_SIGNAL = signum
        cleanup_active_state(remove_temp_roots=False)
        if defer_exit:
            return
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)


def _validate_terminal_jsonl(raw: bytes) -> bool:
    completed = 0
    failed = 0
    saw_event = False
    last_event_type: str | None = None
    try:
        for line in raw.splitlines():
            if not line.strip():
                continue
            event = json.loads(line)
            if not isinstance(event, dict) or not isinstance(event.get("type"), str):
                return False
            saw_event = True
            event_type = event["type"]
            last_event_type = event_type
            if event_type == "turn.completed":
                completed += 1
            elif event_type in {"turn.failed", "turn.cancelled", "error"}:
                failed += 1
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    return (
        saw_event
        and completed == 1
        and failed == 0
        and last_event_type == "turn.completed"
    )


def _read_stdout_bounded(
    stream: Any,
    chunks: list[bytes],
    overflow: threading.Event,
    failed: threading.Event,
    finished: threading.Event,
) -> None:
    total = 0
    try:
        while True:
            read = getattr(stream, "read1", stream.read)
            block = read(STDOUT_READ_CHUNK_BYTES)
            if not block:
                return
            total += len(block)
            if total > MAX_CODEX_JSONL_BYTES:
                overflow.set()
                return
            chunks.append(block)
    except Exception:
        failed.set()
    finally:
        finished.set()


def _remove_last_message(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def invoke_codex(
    command: Sequence[str],
    prompt: str,
    last_message_path: Path,
    timeout_seconds: int | None,
) -> CodexResult:
    if not _begin_child_spawn():
        return CodexResult(False, "launcher_shutdown", None)
    process: subprocess.Popen[bytes] | None = None
    try:
        try:
            process = subprocess.Popen(
                list(command),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                env=isolated_codex_env(),
            )
        except OSError:
            return CodexResult(False, "codex_start_failed", None)
        if (
            not _register_active_child(process)
            or SHUTDOWN_REQUESTED.is_set()
        ):
            _terminate_process_group(process)
            _release_terminated_child(process)
            _remove_last_message(last_message_path)
            return CodexResult(False, "launcher_shutdown", None)
    finally:
        _finish_child_spawn()
        _raise_pending_signal()
    assert process is not None
    chunks: list[bytes] = []
    overflow = threading.Event()
    stdout_failed = threading.Event()
    stdout_finished = threading.Event()
    assert process.stdout is not None
    reader = threading.Thread(
        target=_read_stdout_bounded,
        args=(process.stdout, chunks, overflow, stdout_failed, stdout_finished),
        daemon=True,
    )
    try:
        reader.start()
    except RuntimeError:
        _terminate_process_group(process)
        _release_terminated_child(process)
        _remove_last_message(last_message_path)
        return CodexResult(False, "codex_stdout_read_failed", None)
    try:
        try:
            if process.stdin is None:
                raise OSError("stdin unavailable")
            process.stdin.write(prompt.encode("utf-8"))
            process.stdin.close()
        except (BrokenPipeError, OSError, ValueError):
            _terminate_process_group(process)
            reader.join(timeout=1)
            _remove_last_message(last_message_path)
            return CodexResult(False, "codex_prompt_write_failed", None)

        deadline = (
            None
            if timeout_seconds is None
            else time.monotonic() + timeout_seconds
        )
        while process.poll() is None:
            if overflow.is_set():
                _terminate_process_group(process)
                reader.join(timeout=1)
                _remove_last_message(last_message_path)
                return CodexResult(False, "codex_stdout_too_large", None)
            if stdout_failed.is_set():
                _terminate_process_group(process)
                reader.join(timeout=1)
                _remove_last_message(last_message_path)
                return CodexResult(False, "codex_stdout_read_failed", None)
            if deadline is None:
                overflow.wait(PROCESS_POLL_SECONDS)
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _terminate_process_group(process)
                reader.join(timeout=1)
                _remove_last_message(last_message_path)
                return CodexResult(False, "codex_timeout", None)
            overflow.wait(min(PROCESS_POLL_SECONDS, remaining))

        stdout_wait = (
            1.0
            if deadline is None
            else min(1.0, max(0.0, deadline - time.monotonic()))
        )
        stdout_finished.wait(stdout_wait)
        if not stdout_finished.is_set():
            _terminate_process_group(process)
            reader.join(timeout=1)
            _remove_last_message(last_message_path)
            return CodexResult(False, "codex_stdout_incomplete", None)
        reader.join(timeout=1)
        if overflow.is_set():
            _terminate_process_group(process)
            _remove_last_message(last_message_path)
            return CodexResult(False, "codex_stdout_too_large", None)
        if stdout_failed.is_set():
            _remove_last_message(last_message_path)
            return CodexResult(False, "codex_stdout_read_failed", None)
        if _process_group_exists(process.pid):
            _terminate_process_group(process)
            reader.join(timeout=1)
            _remove_last_message(last_message_path)
            if _process_group_exists(process.pid):
                return CodexResult(
                    False, "codex_process_group_cleanup_failed", None
                )
            return CodexResult(False, "codex_process_group_leaked", None)
    finally:
        _release_terminated_child(process)
    raw_stdout = b"".join(chunks)
    if process.returncode != 0:
        del raw_stdout
        _remove_last_message(last_message_path)
        return CodexResult(False, "codex_failed", None)
    terminal_valid = _validate_terminal_jsonl(raw_stdout)
    del raw_stdout
    if not terminal_valid:
        _remove_last_message(last_message_path)
        return CodexResult(False, "codex_terminal_event_invalid", None)
    try:
        if last_message_path.stat().st_size > MAX_LAST_MESSAGE_BYTES:
            return CodexResult(False, "codex_last_message_too_large", None)
        with last_message_path.open("rb") as handle:
            message_bytes = handle.read(MAX_LAST_MESSAGE_BYTES + 1)
        if len(message_bytes) > MAX_LAST_MESSAGE_BYTES:
            return CodexResult(False, "codex_last_message_too_large", None)
        message = json.loads(message_bytes)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return CodexResult(False, "codex_last_message_invalid", None)
    finally:
        _remove_last_message(last_message_path)
    if not isinstance(message, dict):
        return CodexResult(False, "codex_last_message_invalid", None)
    return CodexResult(True, None, message)


def _expect_exact_keys(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise LauncherError(code)
    return value


def _validate_string_list(
    value: Any,
    allow_empty: bool = True,
    code: str = "agent_report_schema_invalid",
    max_items: int = MAX_REPORT_LIST_ITEMS,
) -> None:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or len(value) > max_items
        or any(not isinstance(item, str) for item in value)
    ):
        raise LauncherError(code)


def _validate_safe_summary(
    value: Any, code: str = "agent_report_privacy_invalid"
) -> None:
    if (
        not isinstance(value, str)
        or len(value) > SAFE_SUMMARY_MAX
        or SAFE_SUMMARY_RE.fullmatch(value) is None
    ):
        raise LauncherError(code)


def _validate_opaque_ref(
    value: Any, code: str = "agent_report_privacy_invalid"
) -> None:
    if (
        not isinstance(value, str)
        or len(value) > SAFE_REF_MAX
        or OPAQUE_REF_RE.fullmatch(value) is None
    ):
        raise LauncherError(code)


def _validate_safe_summary_list(
    value: Any,
    schema_code: str = "agent_report_schema_invalid",
    privacy_code: str = "agent_report_privacy_invalid",
) -> None:
    if not isinstance(value, list) or len(value) > MAX_REPORT_LIST_ITEMS:
        raise LauncherError(schema_code)
    for item in value:
        _validate_safe_summary(item, privacy_code)


def _canonicalize_schema_terminal_lf(
    value: Any,
    pattern: re.Pattern[str],
    max_length: int,
) -> Any:
    """Remove only the terminal LF admitted by JSON Schema `$` semantics."""

    if (
        not isinstance(value, str)
        or len(value) > max_length
        or not value.endswith("\n")
        or value.count("\n") != 1
        or "\r" in value
        or re.search(pattern.pattern, value) is None
    ):
        return value
    canonical = value[:-1]
    return canonical if pattern.fullmatch(canonical) is not None else value


def _canonicalize_safe_summary(value: Any) -> Any:
    return _canonicalize_schema_terminal_lf(
        value, SAFE_SUMMARY_RE, SAFE_SUMMARY_MAX
    )


def _canonicalize_opaque_ref(value: Any) -> Any:
    return _canonicalize_schema_terminal_lf(value, OPAQUE_REF_RE, SAFE_REF_MAX)


def _canonicalize_string_list(
    value: Any, canonicalize: Callable[[Any], Any]
) -> Any:
    if not isinstance(value, list):
        return value
    return [canonicalize(item) for item in value]


def _canonicalize_candidate_list(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    canonical: list[Any] = []
    for raw in value:
        if not isinstance(raw, dict):
            canonical.append(raw)
            continue
        item = dict(raw)
        if "summary" in item:
            item["summary"] = _canonicalize_safe_summary(item["summary"])
        if "target" in item:
            item["target"] = _canonicalize_opaque_ref(item["target"])
        if "evidence" in item:
            item["evidence"] = _canonicalize_string_list(
                item["evidence"], _canonicalize_opaque_ref
            )
        canonical.append(item)
    return canonical


def _seal_agent_report(report: dict[str, Any]) -> dict[str, Any]:
    """Canonicalize bounded strings and bind counts to candidate arrays.

    Candidate selection remains the semantic agent's judgment. Counting the
    resulting arrays is deterministic launcher work and must not create a
    second, fallible statement of the same fact in the model output contract.
    """

    sealed = dict(report)
    if "files_examined" in sealed:
        sealed["files_examined"] = _canonicalize_string_list(
            sealed["files_examined"], _canonicalize_opaque_ref
        )
    for key in ("uncertainties", "blockers"):
        if key in sealed:
            sealed[key] = _canonicalize_string_list(
                sealed[key], _canonicalize_safe_summary
            )
    for key in ("shared_candidates", "project_candidates"):
        if key in sealed:
            sealed[key] = _canonicalize_candidate_list(sealed[key])
    retention = sealed.get("l1_retention")
    if isinstance(retention, dict) and "observer_contract_breaches" in retention:
        canonical_retention = dict(retention)
        canonical_retention["observer_contract_breaches"] = (
            _canonicalize_string_list(
                retention["observer_contract_breaches"],
                _canonicalize_safe_summary,
            )
        )
        sealed["l1_retention"] = canonical_retention

    counts = sealed.get("counts")
    shared_candidates = sealed.get("shared_candidates")
    project_candidates = sealed.get("project_candidates")
    semantic_keys = {
        "l2_kept_or_added",
        "l3_kept_or_added",
        "dropped",
    }
    if (
        not isinstance(counts, dict)
        or set(counts) != semantic_keys
        or not isinstance(shared_candidates, list)
        or not isinstance(project_candidates, list)
    ):
        raise LauncherError("agent_report_schema_invalid")
    sealed_counts = dict(counts)
    sealed_counts["shared_reported"] = len(shared_candidates)
    sealed_counts["project_reported"] = len(project_candidates)
    sealed["counts"] = sealed_counts
    return sealed


def _validate_candidates(value: Any) -> None:
    if not isinstance(value, list) or len(value) > MAX_REPORT_LIST_ITEMS:
        raise LauncherError("agent_report_schema_invalid")
    for item in value:
        candidate = _expect_exact_keys(
            item, {"summary", "target", "evidence"}, "agent_report_schema_invalid"
        )
        if not isinstance(candidate["summary"], str) or not isinstance(
            candidate["target"], str
        ):
            raise LauncherError("agent_report_schema_invalid")
        _validate_safe_summary(candidate["summary"])
        _validate_opaque_ref(candidate["target"])
        _validate_string_list(
            candidate["evidence"],
            allow_empty=False,
            max_items=MAX_REPORT_EVIDENCE_ITEMS,
        )
        for evidence in candidate["evidence"]:
            _validate_opaque_ref(evidence)


def _parse_l1_layout(
    data: bytes,
) -> tuple[dict[str, dict[str, Any]], list[tuple[bytes, str | None]]]:
    records: dict[str, dict[str, Any]] = {}
    layout: list[tuple[bytes, str | None]] = []
    seen_content: set[str] = set()
    offset = 0
    while offset < len(data):
        newline = data.find(b"\n", offset)
        if newline < 0:
            physical = data[offset:]
            raw = physical
            offset = len(data)
        else:
            physical = data[offset : newline + 1]
            raw = physical[:-1]
            if raw.endswith(b"\r"):
                raw = raw[:-1]
            offset = newline + 1
        if b"\r" in raw:
            raise LauncherError("stage_l1_jsonl_invalid")
        if not raw.strip():
            layout.append((physical, None))
            continue
        try:
            value = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise LauncherError("stage_l1_jsonl_invalid") from exc
        if (
            not isinstance(value, dict)
            or set(value) != {"ts", "tier", "text", "source", "refs"}
            or value.get("tier") not in {"high", "medium", "low"}
            or any(
                not isinstance(value.get(key), str) or not value[key]
                for key in ("ts", "text", "source")
            )
            or not isinstance(value.get("refs"), list)
            or any(not isinstance(ref, str) for ref in value["refs"])
        ):
            raise LauncherError("stage_l1_jsonl_invalid")
        content_id = sha256_bytes(raw)
        record_id = content_id
        if content_id in seen_content:
            raise LauncherError("stage_l1_jsonl_duplicate")
        seen_content.add(content_id)
        records[record_id] = value
        layout.append((physical, record_id))
    return records, layout


def _parse_l1_records(data: bytes) -> dict[str, dict[str, Any]]:
    records, _layout = _parse_l1_layout(data)
    return records


def _l1_layout_without(
    layout: Sequence[tuple[bytes, str | None]], record_ids: set[str]
) -> bytes:
    return b"".join(
        physical for physical, record_id in layout if record_id not in record_ids
    )


def _validate_l1_retention(
    retention: Any,
    before_data: bytes,
    after_data: bytes,
    commander: Commander,
) -> None:
    value = _expect_exact_keys(
        retention,
        {
            "merged_medium",
            "removed_rule_promoted",
            "removed_expired_low",
            "observer_contract_breaches",
        },
        "agent_report_l1_invalid",
    )
    for key in ("merged_medium", "removed_rule_promoted", "removed_expired_low"):
        if not isinstance(value[key], list) or len(value[key]) > MAX_REPORT_LIST_ITEMS:
            raise LauncherError("agent_report_l1_invalid")
    _validate_safe_summary_list(value["observer_contract_breaches"])
    before, before_layout = _parse_l1_layout(before_data)
    after, after_layout = _parse_l1_layout(after_data)
    declared_removed: set[str] = set()
    declared_added: set[str] = set()
    for merge in value["merged_medium"]:
        action = _expect_exact_keys(
            merge, {"source_sha256", "result_sha256"}, "agent_report_l1_invalid"
        )
        sources = action["source_sha256"]
        result_id = action["result_sha256"]
        if (
            not isinstance(sources, list)
            or len(sources) < 2
            or len(sources) > MAX_REPORT_LIST_ITEMS
            or len(set(sources)) != len(sources)
            or any(source not in before for source in sources)
            or any(before[source]["tier"] != "medium" for source in sources)
            or result_id not in after
            or after[result_id]["tier"] != "medium"
            or any(source in declared_removed for source in sources)
            or result_id in declared_added
        ):
            raise LauncherError("agent_report_l1_invalid")
        declared_removed.update(sources)
        declared_added.add(result_id)
    for removal in value["removed_rule_promoted"]:
        action = _expect_exact_keys(
            removal, {"source_sha256", "rule_path"}, "agent_report_l1_invalid"
        )
        source_id = action["source_sha256"]
        rule_path = action["rule_path"]
        resolved_rule: Path | None = None
        allowed_rule_roots = (
            commander.root / "agentcontext/rules",
            commander.root.parent.parent / "agentcontext/rules",
        )
        if isinstance(rule_path, str) and Path(rule_path).is_absolute():
            candidate = Path(rule_path)
            for raw_root in allowed_rule_roots:
                try:
                    candidate.relative_to(raw_root)
                except ValueError:
                    continue
                try:
                    resolved_rule = _canonical_file_below_real_root(
                        candidate, raw_root
                    )
                except LauncherError:
                    resolved_rule = None
                break
        if (
            source_id not in before
            or source_id in declared_removed
            or resolved_rule is None
            or not any(
                resolved_rule.is_relative_to(root) for root in allowed_rule_roots
            )
        ):
            raise LauncherError("agent_report_l1_invalid")
        declared_removed.add(source_id)
    for removal in value["removed_expired_low"]:
        action = _expect_exact_keys(
            removal, {"source_sha256"}, "agent_report_l1_invalid"
        )
        source_id = action["source_sha256"]
        if (
            source_id not in before
            or before[source_id]["tier"] != "low"
            or source_id in declared_removed
        ):
            raise LauncherError("agent_report_l1_invalid")
        declared_removed.add(source_id)
    actual_removed = set(before) - set(after)
    actual_added = set(after) - set(before)
    retained_before = [item for item in before if item not in actual_removed]
    retained_after = [item for item in after if item not in actual_added]
    if (
        actual_removed != declared_removed
        or actual_added != declared_added
        or retained_before != retained_after
        or _l1_layout_without(before_layout, declared_removed)
        != _l1_layout_without(after_layout, declared_added)
    ):
        raise LauncherError("agent_report_l1_invalid")


def _source_coverage_skeleton(
    commander: Commander,
    inventory: dict[str, Any],
    run_nonce: str,
) -> dict[str, Any]:
    return {
        "schema_version": COVERAGE_SCHEMA_VERSION,
        "prompt_version": PROMPT_VERSION,
        "mode": "claude-import",
        "commander_id": commander.commander_id,
        "run_nonce": run_nonce,
        "inventory_sha256": inventory["aggregate_sha256"],
        "items_expected": inventory["item_count"],
        "coverage": [
            {"item_id": item["item_id"], "dispositions": []}
            for item in sorted(inventory["items"], key=lambda item: item["item_id"])
        ],
    }


def _read_coverage_sidecar(path: Path, code: str) -> tuple[dict[str, Any], str]:
    descriptor: int | None = None
    try:
        before = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size < 1
            or before.st_size > MAX_COVERAGE_SIDECAR_BYTES
        ):
            raise LauncherError(code)
        descriptor = os.open(
            path,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NONBLOCK", 0),
        )
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
            raise LauncherError(code)
        identity_before = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
            before.st_nlink,
        )
        identity_opened = (
            opened.st_dev,
            opened.st_ino,
            opened.st_size,
            opened.st_mtime_ns,
            opened.st_ctime_ns,
            opened.st_nlink,
        )
        if identity_opened != identity_before:
            raise LauncherError(code)
        raw = b""
        while len(raw) <= MAX_COVERAGE_SIDECAR_BYTES:
            block = os.read(
                descriptor,
                min(
                    64 * 1024,
                    MAX_COVERAGE_SIDECAR_BYTES + 1 - len(raw),
                ),
            )
            if not block:
                break
            raw += block
        after = os.fstat(descriptor)
        identity_after = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
            after.st_nlink,
        )
        if (
            identity_after != identity_opened
            or len(raw) != opened.st_size
            or len(raw) > MAX_COVERAGE_SIDECAR_BYTES
        ):
            raise LauncherError(code)
        payload = json.loads(raw.decode("utf-8"))
    except LauncherError:
        raise
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise LauncherError(code) from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
    if not isinstance(payload, dict) or contains_secret(raw):
        raise LauncherError(code)
    return payload, sha256_bytes(raw)


def _valid_coverage_dispositions(value: Any, *, allow_empty: bool) -> bool:
    return bool(
        isinstance(value, list)
        and (allow_empty or value)
        and len(value) <= len(COVERAGE_DISPOSITIONS)
        and all(isinstance(item, str) for item in value)
        and len(set(value)) == len(value)
        and all(item in COVERAGE_DISPOSITIONS for item in value)
        and ("NOT_RELEVANT" not in value or len(value) == 1)
    )


def _validate_source_coverage_sidecar(
    path: Path,
    commander: Commander,
    inventory: dict[str, Any],
    run_nonce: str,
    staged: dict[str, str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload, digest = _read_coverage_sidecar(
        path, "agent_report_coverage_invalid"
    )
    sidecar = _expect_exact_keys(
        payload,
        {
            "schema_version",
            "prompt_version",
            "mode",
            "commander_id",
            "run_nonce",
            "inventory_sha256",
            "items_expected",
            "coverage",
        },
        "agent_report_coverage_invalid",
    )
    coverage = sidecar["coverage"]
    expected_ids = sorted(item["item_id"] for item in inventory["items"])
    if (
        type(sidecar["schema_version"]) is not int
        or sidecar["schema_version"] != COVERAGE_SCHEMA_VERSION
        or sidecar["prompt_version"] != PROMPT_VERSION
        or sidecar["mode"] != "claude-import"
        or sidecar["commander_id"] != commander.commander_id
        or sidecar["run_nonce"] != run_nonce
        or sidecar["inventory_sha256"] != inventory["aggregate_sha256"]
        or type(sidecar["items_expected"]) is not int
        or sidecar["items_expected"] != inventory["item_count"]
        or not isinstance(coverage, list)
        or len(coverage) != len(expected_ids)
    ):
        raise LauncherError("agent_report_coverage_invalid")
    actual_ids: list[str] = []
    for row in coverage:
        item = _expect_exact_keys(
            row,
            {"item_id", "dispositions"},
            "agent_report_coverage_invalid",
        )
        item_id = item["item_id"]
        dispositions = item["dispositions"]
        if (
            not isinstance(item_id, str)
            or not _valid_coverage_dispositions(dispositions, allow_empty=False)
        ):
            raise LauncherError("agent_report_coverage_invalid")
        actual_ids.append(item_id)
    if actual_ids != expected_ids:
        raise LauncherError("agent_report_coverage_invalid")
    attestation = {
        "schema_version": COVERAGE_SCHEMA_VERSION,
        "run_nonce": run_nonce,
        "sidecar_sha256": digest,
        "inventory_sha256": inventory["aggregate_sha256"],
        "items_expected": inventory["item_count"],
        "items_examined": inventory["item_count"],
        "stage_sha256": {key: staged[key] for key in ("l1", "l2", "l3")},
    }
    return sidecar, attestation


def _source_coverage_progress(
    path: Path,
    commander: Commander,
    inventory: dict[str, Any],
    run_nonce: str,
) -> tuple[str, int]:
    try:
        payload, _digest = _read_coverage_sidecar(
            path, "agent_report_coverage_invalid"
        )
        skeleton = _source_coverage_skeleton(commander, inventory, run_nonce)
        if set(payload) != set(skeleton) or any(
            payload[key] != skeleton[key] for key in skeleton if key != "coverage"
        ):
            return "coverage_invalid", 0
        rows = payload.get("coverage")
        expected_rows = skeleton["coverage"]
        if not isinstance(rows, list) or len(rows) != len(expected_rows):
            return "coverage_invalid", 0
        completed = 0
        for row, expected in zip(rows, expected_rows):
            if (
                not isinstance(row, dict)
                or set(row) != {"item_id", "dispositions"}
                or row.get("item_id") != expected["item_id"]
                or not _valid_coverage_dispositions(
                    row.get("dispositions"), allow_empty=True
                )
            ):
                return "coverage_invalid", completed
            completed += bool(row["dispositions"])
        if completed == inventory["item_count"]:
            return "coverage_sealed_final_response_missing", completed
        return "coverage_incomplete", completed
    except LauncherError:
        return "coverage_invalid", 0


def validate_agent_report(
    report: dict[str, Any],
    commander: Commander,
    mode: str,
    before: dict[str, str],
    staged: dict[str, str],
    inventory: dict[str, Any] | None,
    coverage_attestation: dict[str, Any] | None,
    before_l1: bytes,
    staged_l1: bytes,
) -> None:
    keys = {
        "schema_version",
        "prompt_version",
        "mode",
        "commander_id",
        "commander_name",
        "status",
        "changes",
        "counts",
        "hashes",
        "files_examined",
        "shared_candidates",
        "project_candidates",
        "uncertainties",
        "blockers",
    }
    if inventory is not None:
        keys.update(("inventory", "coverage_attestation"))
    if mode == "reflector":
        keys.add("l1_retention")
    _expect_exact_keys(report, keys, "agent_report_schema_invalid")
    if (
        report["schema_version"] != SCHEMA_VERSION
        or report["prompt_version"] != PROMPT_VERSION
        or report["mode"] != mode
        or report["commander_id"] != commander.commander_id
        or report["commander_name"] != commander.name
        or report["status"] not in {"success", "blocked"}
    ):
        raise LauncherError("agent_report_identity_invalid")
    changes = _expect_exact_keys(
        report["changes"],
        {"l1_changed", "l2_changed", "l3_changed"},
        "agent_report_schema_invalid",
    )
    if any(not isinstance(value, bool) for value in changes.values()):
        raise LauncherError("agent_report_schema_invalid")
    expected_changed = {
        "l1_changed": staged["l1"] != before["l1"],
        "l2_changed": staged["l2"] != before["l2"],
        "l3_changed": staged["l3"] != before["l3"],
    }
    if changes != expected_changed:
        raise LauncherError("agent_report_hash_invalid")
    if report["status"] == "blocked" and any(changes.values()):
        raise LauncherError("blocked_agent_changed_memory")

    count_keys = {
        "l2_kept_or_added",
        "l3_kept_or_added",
        "shared_reported",
        "project_reported",
        "dropped",
    }
    counts = _expect_exact_keys(report["counts"], count_keys, "agent_report_schema_invalid")
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in counts.values()
    ):
        raise LauncherError("agent_report_schema_invalid")
    hashes = _expect_exact_keys(
        report["hashes"],
        {
            "commander_before",
            "commander_after",
            "l1_before",
            "l1_after",
            "l2_before",
            "l2_after",
            "l3_before",
            "l3_after",
        },
        "agent_report_schema_invalid",
    )
    expected_hashes = {
        "commander_before": before["commander"],
        "commander_after": before["commander"],
        "l1_before": before["l1"],
        "l1_after": staged["l1"],
        "l2_before": before["l2"],
        "l2_after": staged["l2"],
        "l3_before": before["l3"],
        "l3_after": staged["l3"],
    }
    if hashes != expected_hashes:
        raise LauncherError("agent_report_hash_invalid")
    _validate_string_list(report["files_examined"], allow_empty=False)
    for examined in report["files_examined"]:
        _validate_opaque_ref(examined)
    _validate_candidates(report["shared_candidates"])
    _validate_candidates(report["project_candidates"])
    if counts["shared_reported"] != len(report["shared_candidates"]) or counts[
        "project_reported"
    ] != len(report["project_candidates"]):
        raise LauncherError("agent_report_count_invalid")
    _validate_safe_summary_list(report["uncertainties"])
    _validate_safe_summary_list(report["blockers"])
    if (report["status"] == "success" and report["blockers"]) or (
        report["status"] == "blocked" and not report["blockers"]
    ):
        raise LauncherError("agent_report_status_invalid")
    if mode == "reflector":
        _validate_l1_retention(
            report["l1_retention"], before_l1, staged_l1, commander
        )
    elif staged["l1"] != before["l1"]:
        raise LauncherError("migration_l1_changed")

    if inventory is not None:
        inventory_report = _expect_exact_keys(
            report["inventory"],
            {
                "aggregate_sha256",
                "files_expected",
                "bytes_expected",
                "files_examined",
                "bytes_examined",
                "items_expected",
                "items_examined",
                "indexed_items",
                "inline_only_items",
                "unindexed_items",
            },
            "agent_report_schema_invalid",
        )
        expected_inventory_report = {
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
        if canonical_json(inventory_report) != canonical_json(
            expected_inventory_report
        ):
            raise LauncherError("agent_report_coverage_invalid")
        if (
            coverage_attestation is None
            or canonical_json(report["coverage_attestation"])
            != canonical_json(coverage_attestation)
        ):
            raise LauncherError("agent_report_coverage_invalid")
    elif coverage_attestation is not None:
        raise LauncherError("agent_report_coverage_invalid")

    if contains_secret(canonical_json(report)):
        raise LauncherError("agent_report_secret_detected")


def _validate_stage(
    workspace: Path,
    mode: str,
    max_memory_bytes: int,
    before_l1: bytes,
    expect_source_coverage: bool = False,
) -> tuple[dict[str, str], bytes]:
    entries = list(workspace.iterdir())
    allowed = {L2_NAME, L3_NAME}
    if mode == "reflector":
        allowed.add(L1_NAME)
    if expect_source_coverage:
        allowed.add(SOURCE_COVERAGE_NAME)
    if {entry.name for entry in entries} != allowed:
        raise LauncherError("stage_allowed_paths_invalid")
    hashes: dict[str, str] = {"l1": sha256_bytes(before_l1)}
    for key, name in (("l2", L2_NAME), ("l3", L3_NAME)):
        path = workspace / name
        if path.is_symlink() or not path.is_file():
            raise LauncherError("stage_allowed_paths_invalid")
        data = path.read_bytes()
        if not data or len(data) > max_memory_bytes:
            raise LauncherError("stage_memory_size_invalid")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise LauncherError("stage_memory_encoding_invalid") from exc
        if contains_secret(data):
            raise LauncherError("stage_memory_secret_detected")
        hashes[key] = sha256_bytes(data)
    staged_l1 = before_l1
    if mode == "reflector":
        l1_path = workspace / L1_NAME
        if l1_path.is_symlink() or not l1_path.is_file():
            raise LauncherError("stage_allowed_paths_invalid")
        staged_l1 = l1_path.read_bytes()
        _parse_l1_records(staged_l1)
        if contains_secret(staged_l1):
            raise LauncherError("stage_memory_secret_detected")
        hashes["l1"] = sha256_bytes(staged_l1)
    return hashes, staged_l1


def _atomic_publish(
    commander: Commander,
    workspace: Path,
    before: dict[str, str],
    staged: dict[str, str],
    mode: str,
) -> None:
    if SHUTDOWN_REQUESTED.is_set():
        raise LauncherError("launcher_shutdown")
    targets = [
        (commander.l2_file, workspace / L2_NAME, "l2"),
        (commander.l3_file, workspace / L3_NAME, "l3"),
    ]
    if mode == "reflector":
        targets.insert(0, (commander.l1_file, workspace / L1_NAME, "l1"))
    originals = {key: target.read_bytes() for target, _source, key in targets}
    original_modes = {
        key: target.stat().st_mode & 0o777 for target, _source, key in targets
    }
    replacements: dict[str, Path] = {}
    replaced: list[str] = []
    try:
        for target, source, key in targets:
            if SHUTDOWN_REQUESTED.is_set():
                raise LauncherError("launcher_shutdown")
            if staged[key] == before[key]:
                continue
            fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
            temp_path = Path(temp_name)
            replacements[key] = temp_path
            with os.fdopen(fd, "wb") as handle:
                handle.write(source.read_bytes())
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp_path, target.stat().st_mode & 0o777)
        if _hash_snapshot(commander) != before:
            raise LauncherError("live_memory_changed_at_publish")
        for target, _source, key in targets:
            if SHUTDOWN_REQUESTED.is_set():
                raise LauncherError("launcher_shutdown")
            if key not in replacements:
                continue
            replaced.append(key)
            os.replace(replacements[key], target)
        if SHUTDOWN_REQUESTED.is_set():
            raise LauncherError("launcher_shutdown")
        for target, _source, key in targets:
            if sha256_file(target) != staged[key]:
                raise OSError("post-publish hash mismatch")
        if SHUTDOWN_REQUESTED.is_set():
            raise LauncherError("launcher_shutdown")
    except BaseException as exc:
        rollback_error: BaseException | None = None
        for target, _source, key in reversed(targets):
            if key not in replaced:
                continue
            rollback_path: Path | None = None
            try:
                fd, temp_name = tempfile.mkstemp(
                    prefix=f".{target.name}.rollback.", dir=target.parent
                )
                rollback_path = Path(temp_name)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(originals[key])
                    handle.flush()
                    os.fsync(handle.fileno())
                os.chmod(rollback_path, original_modes[key])
                os.replace(rollback_path, target)
            except BaseException as candidate:
                if rollback_error is None:
                    rollback_error = candidate
            finally:
                try:
                    if rollback_path is not None and rollback_path.exists():
                        rollback_path.unlink()
                except OSError as candidate:
                    if rollback_error is None:
                        rollback_error = candidate
        if rollback_error is not None:
            raise LauncherError("memory_rollback_failed") from rollback_error
        if isinstance(exc, OSError):
            raise LauncherError("memory_publish_failed") from exc
        raise
    finally:
        for temp_path in replacements.values():
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass


def run_commander(
    commander: Commander,
    mode: str,
    inventory: dict[str, Any] | None,
    codex_command: Sequence[str],
    timeout_seconds: int | None,
    max_memory_bytes: int,
    staging_root: Path | None,
    model: str,
    correction_audit: dict[str, Any] | None = None,
    correction_initial_memory: dict[str, bytes] | None = None,
    expected_before: dict[str, str] | None = None,
) -> CommanderResult:
    started = time.monotonic()
    try:
        if SHUTDOWN_REQUESTED.is_set():
            raise LauncherError("launcher_shutdown")
        if (correction_audit is None) != (correction_initial_memory is None):
            raise LauncherError("correction_context_invalid")
        before = _hash_snapshot(commander)
        if expected_before is not None and before != expected_before:
            raise LauncherError("published_memory_drift")
        before_l1 = commander.l1_file.read_bytes()
        skill_path = Path(__file__).resolve().parents[1] / "SKILL.md"
        with tempfile.TemporaryDirectory(
            prefix=f"memory-reflector-{commander.commander_id}-",
            dir=staging_root,
        ) as temporary:
            run_root = Path(temporary)
            if not _register_active_temp_root(run_root):
                raise LauncherError("launcher_shutdown")
            try:
                result = _run_commander_staged(
                    commander,
                    mode,
                    inventory,
                    codex_command,
                    timeout_seconds,
                    max_memory_bytes,
                    model,
                    correction_audit,
                    correction_initial_memory,
                    before,
                    before_l1,
                    skill_path,
                    run_root,
                )
            finally:
                _discard_active_temp_root(run_root)
    except LauncherError as exc:
        result = CommanderResult(
            commander.commander_id,
            commander.name,
            False,
            exc.code,
            phase="launcher_rejected",
        )
    except (OSError, ValueError, TypeError, KeyError):
        result = CommanderResult(
            commander.commander_id,
            commander.name,
            False,
            "commander_run_io_failed",
            phase="launcher_rejected",
        )
    result.elapsed_seconds = round(max(0.0, time.monotonic() - started), 3)
    return result


def _run_commander_staged(
    commander: Commander,
    mode: str,
    inventory: dict[str, Any] | None,
    codex_command: Sequence[str],
    timeout_seconds: int | None,
    max_memory_bytes: int,
    model: str,
    correction_audit: dict[str, Any] | None,
    correction_initial_memory: dict[str, bytes] | None,
    before: dict[str, str],
    before_l1: bytes,
    skill_path: Path,
    run_root: Path,
) -> CommanderResult:
    if inventory is not None and mode != "claude-import":
        raise LauncherError("source_inventory_mode_invalid")
    run_nonce = sha256_bytes(os.urandom(32))
    workspace = run_root / "workspace"
    control = run_root / "control"
    workspace.mkdir()
    control.mkdir()
    if mode == "reflector":
        shutil.copyfile(commander.l1_file, workspace / L1_NAME)
    shutil.copyfile(commander.l2_file, workspace / L2_NAME)
    shutil.copyfile(commander.l3_file, workspace / L3_NAME)
    inventory_path: Path | None = None
    if inventory is not None:
        inventory_path = control / "source-inventory.json"
        write_control_json(inventory_path, inventory)
        write_control_json(
            workspace / SOURCE_COVERAGE_NAME,
            _source_coverage_skeleton(commander, inventory, run_nonce),
        )
    correction_context_path: Path | None = None
    if correction_audit is not None:
        if correction_initial_memory is None or any(
            key not in correction_initial_memory
            or not isinstance(correction_initial_memory[key], bytes)
            for key in ("l1", "l2", "l3")
        ):
            raise LauncherError("correction_context_invalid")
        initial_root = control / "initial-memory"
        initial_root.mkdir()
        initial_paths: dict[str, str] = {}
        for tier, filename in (("l1", L1_NAME), ("l2", L2_NAME), ("l3", L3_NAME)):
            path = initial_root / filename
            path.write_bytes(correction_initial_memory[tier])
            path.chmod(0o444)
            initial_paths[tier] = str(path.resolve())
        correction_audit_path = control / "prior-audit.json"
        write_control_json(correction_audit_path, correction_audit)
        correction_audit_path.chmod(0o444)
        correction_context_path = control / "correction-context.json"
        current_l1 = (
            workspace / L1_NAME if mode == "reflector" else commander.l1_file
        )
        write_control_json(
            correction_context_path,
            {
                "prior_audit_path": str(correction_audit_path.resolve()),
                "initial_memory": initial_paths,
                "current_memory": {
                    "l1": str(current_l1.resolve()),
                    "l2": str((workspace / L2_NAME).resolve()),
                    "l3": str((workspace / L3_NAME).resolve()),
                },
            },
        )
        correction_context_path.chmod(0o444)
    schema_path = control / "report-schema.json"
    last_message_path = control / "last-message.json"
    schema = build_agent_schema(commander, mode, before, inventory, run_nonce)
    write_control_json(schema_path, schema)
    prompt = build_agent_prompt(
        commander,
        mode,
        skill_path,
        workspace,
        inventory_path,
        correction_context_path,
        run_nonce,
    )
    command = codex_exec_command(
        codex_command,
        workspace,
        schema_path,
        last_message_path,
        "workspace-write",
        model,
    )
    codex_result = invoke_codex(command, prompt, last_message_path, timeout_seconds)
    if not codex_result.success or codex_result.message is None:
        phase = "semantic_agent_incomplete"
        coverage_item_count = 0
        if inventory is not None:
            phase, coverage_item_count = _source_coverage_progress(
                workspace / SOURCE_COVERAGE_NAME,
                commander,
                inventory,
                run_nonce,
            )
        return CommanderResult(
            commander.commander_id,
            commander.name,
            False,
            codex_result.error_code,
            phase=phase,
            coverage_item_count=coverage_item_count,
        )
    staged, staged_l1 = _validate_stage(
        workspace,
        mode,
        max_memory_bytes,
        before_l1,
        expect_source_coverage=inventory is not None,
    )
    after_agent = _hash_snapshot(commander)
    if after_agent != before:
        raise LauncherError("live_memory_changed_during_agent")
    coverage: dict[str, Any] | None = None
    coverage_attestation: dict[str, Any] | None = None
    if inventory is not None:
        verify_inventory_files(inventory)
        coverage, coverage_attestation = _validate_source_coverage_sidecar(
            workspace / SOURCE_COVERAGE_NAME,
            commander,
            inventory,
            run_nonce,
            staged,
        )
    try:
        report = _seal_agent_report(codex_result.message)
        validate_agent_report(
            report,
            commander,
            mode,
            before,
            staged,
            inventory,
            coverage_attestation,
            before_l1,
            staged_l1,
        )
    except LauncherError as exc:
        return CommanderResult(
            commander_id=commander.commander_id,
            name=commander.name,
            success=False,
            error_code=exc.code,
            coverage=coverage,
            phase=(
                "coverage_sealed_report_rejected"
                if inventory is not None
                else "agent_report_rejected"
            ),
            coverage_item_count=inventory["item_count"] if inventory else 0,
        )
    if report["status"] != "success":
        return CommanderResult(
            commander_id=commander.commander_id,
            name=commander.name,
            success=False,
            error_code="agent_blocked",
            report=report,
            coverage=coverage,
            phase="validated_blocked",
            coverage_item_count=inventory["item_count"] if inventory else 0,
        )
    _atomic_publish(commander, workspace, before, staged, mode)
    return CommanderResult(
        commander.commander_id,
        commander.name,
        True,
        report=report,
        coverage=coverage,
        phase="published",
        coverage_item_count=inventory["item_count"] if inventory else 0,
    )


def _snapshot_id(commander_id: str, tier: str, phase: str) -> str:
    return sha256_bytes(f"{commander_id}\0{tier}\0{phase}".encode("utf-8"))


def _expected_inventory_attestation(
    inventory: dict[str, Any] | None,
) -> dict[str, Any]:
    source_item_ids = (
        []
        if inventory is None
        else sorted(item["item_id"] for item in inventory["items"])
    )
    if inventory is None:
        return {
            "aggregate_sha256": "",
            "file_count": 0,
            "byte_count": 0,
            "item_count": 0,
            "indexed_item_count": 0,
            "inline_only_item_count": 0,
            "unindexed_item_count": 0,
            "source_item_ids_sha256": sha256_bytes(canonical_json(source_item_ids)),
        }
    return {
        "aggregate_sha256": inventory["aggregate_sha256"],
        "file_count": inventory["file_count"],
        "byte_count": inventory["byte_count"],
        "item_count": inventory["item_count"],
        "indexed_item_count": inventory["indexed_item_count"],
        "inline_only_item_count": inventory["inline_only_item_count"],
        "unindexed_item_count": inventory["unindexed_item_count"],
        "source_item_ids_sha256": sha256_bytes(canonical_json(source_item_ids)),
    }


def build_audit_schema(
    mode: str,
    commanders: list[Commander],
    inventory: dict[str, Any] | None,
    expected_snapshots: list[dict[str, str]],
    run_nonce: str,
) -> dict[str, Any]:
    commander_ids = [commander.commander_id for commander in commanders]
    inventory_attestation = _expected_inventory_attestation(inventory)
    source_item_schema: dict[str, Any] = {
        "type": "array",
        "maxItems": 0 if inventory is None else inventory["item_count"],
        "items": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
    }
    finding = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "severity",
            "kind",
            "summary",
            "source_item_ids",
            "commander_ids",
            "evidence",
        ],
        "properties": {
            "severity": {"type": "string", "enum": ["blocking", "nonblocking"]},
            "kind": {
                "type": "string",
                "enum": [
                    "source_item_gap",
                    "ownership_conflict",
                    "duplication",
                    "stale_inclusion",
                    "sensitive_inclusion",
                    "candidate_write_violation",
                    "protected_file_change",
                    "disallowed_change",
                    "agent_failure",
                    "uncertainty",
                    "candidate",
                ],
            },
            "summary": _safe_summary_schema(),
            "source_item_ids": source_item_schema,
            "commander_ids": {
                "type": "array",
                "minItems": 1,
                "maxItems": len(commanders),
                "items": {"type": "string", "enum": commander_ids},
            },
            "evidence": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_REPORT_EVIDENCE_ITEMS,
                "items": _opaque_ref_schema(),
            },
        },
    }
    inventory_attestation_properties: dict[str, Any] = {}
    for key, value in inventory_attestation.items():
        if isinstance(value, int):
            inventory_attestation_properties[key] = {
                "type": "integer",
                "const": value,
            }
        else:
            inventory_attestation_properties[key] = {
                "type": "string",
                "const": value,
            }
    inventory_attestation_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": list(inventory_attestation),
        "properties": inventory_attestation_properties,
    }
    coverage_attestation_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "schema_version",
            "run_nonce",
            "sidecar_sha256",
            "inventory_sha256",
            "source_items_expected",
            "source_items_examined",
            "snapshots_expected",
            "snapshots_examined",
        ],
        "properties": {
            "schema_version": {
                "type": "integer",
                "const": COVERAGE_SCHEMA_VERSION,
            },
            "run_nonce": {"type": "string", "const": run_nonce},
            "sidecar_sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$",
            },
            "inventory_sha256": {
                "type": "string",
                "const": "" if inventory is None else inventory["aggregate_sha256"],
            },
            "source_items_expected": {
                "type": "integer",
                "const": 0 if inventory is None else inventory["item_count"],
            },
            "source_items_examined": {
                "type": "integer",
                "const": 0 if inventory is None else inventory["item_count"],
            },
            "snapshots_expected": {
                "type": "integer",
                "const": len(expected_snapshots),
            },
            "snapshots_examined": {
                "type": "integer",
                "const": len(expected_snapshots),
            },
        },
    }
    semantic_checks_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": list(AUDIT_SEMANTIC_CHECKS),
        "properties": {
            key: {"type": "boolean"} for key in AUDIT_SEMANTIC_CHECKS
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": [
            "schema_version",
            "prompt_version",
            "mode",
            "status",
            "commanders_expected",
            "commander_ids",
            "inventory_attestation",
            "coverage_attestation",
            "semantic_checks",
            "correction_commander_ids",
            "findings",
        ],
        "properties": {
            "schema_version": {"type": "integer", "const": SCHEMA_VERSION},
            "prompt_version": {"type": "string", "const": PROMPT_VERSION},
            "mode": {"type": "string", "const": mode},
            "status": {"type": "string", "enum": ["pass", "fail"]},
            "commanders_expected": {"type": "integer", "const": len(commanders)},
            "commander_ids": {
                "type": "array",
                "minItems": len(commanders),
                "maxItems": len(commanders),
                "items": {"type": "string", "enum": commander_ids},
            },
            "inventory_attestation": inventory_attestation_schema,
            "coverage_attestation": coverage_attestation_schema,
            "semantic_checks": semantic_checks_schema,
            "correction_commander_ids": {
                "type": "array",
                "maxItems": len(commanders),
                "items": {"type": "string", "enum": commander_ids},
            },
            "findings": {
                "type": "array",
                "maxItems": MAX_REPORT_LIST_ITEMS,
                "items": finding,
            },
        },
    }


def _audit_coverage_skeleton(
    mode: str,
    inventory: dict[str, Any] | None,
    expected_snapshots: list[dict[str, str]],
    run_nonce: str,
) -> dict[str, Any]:
    source_ids = (
        []
        if inventory is None
        else sorted(item["item_id"] for item in inventory["items"])
    )
    return {
        "schema_version": COVERAGE_SCHEMA_VERSION,
        "prompt_version": PROMPT_VERSION,
        "mode": mode,
        "run_nonce": run_nonce,
        "inventory_sha256": (
            "" if inventory is None else inventory["aggregate_sha256"]
        ),
        "source_items": [
            {"item_id": item_id, "examined": False} for item_id in source_ids
        ],
        "snapshots": [
            {**snapshot, "examined": False}
            for snapshot in sorted(
                expected_snapshots, key=lambda item: item["snapshot_id"]
            )
        ],
    }


def _validate_audit_coverage_sidecar(
    path: Path,
    mode: str,
    inventory: dict[str, Any] | None,
    expected_snapshots: list[dict[str, str]],
    run_nonce: str,
) -> dict[str, Any]:
    payload, digest = _read_coverage_sidecar(
        path, "audit_report_attestation_invalid"
    )
    sidecar = _expect_exact_keys(
        payload,
        {
            "schema_version",
            "prompt_version",
            "mode",
            "run_nonce",
            "inventory_sha256",
            "source_items",
            "snapshots",
        },
        "audit_report_attestation_invalid",
    )
    expected_source_ids = (
        []
        if inventory is None
        else sorted(item["item_id"] for item in inventory["items"])
    )
    raw_source_items = sidecar["source_items"]
    raw_snapshots = sidecar["snapshots"]
    if (
        type(sidecar["schema_version"]) is not int
        or sidecar["schema_version"] != COVERAGE_SCHEMA_VERSION
        or sidecar["prompt_version"] != PROMPT_VERSION
        or sidecar["mode"] != mode
        or sidecar["run_nonce"] != run_nonce
        or sidecar["inventory_sha256"]
        != ("" if inventory is None else inventory["aggregate_sha256"])
        or not isinstance(raw_source_items, list)
        or len(raw_source_items) != len(expected_source_ids)
        or not isinstance(raw_snapshots, list)
        or len(raw_snapshots) != len(expected_snapshots)
    ):
        raise LauncherError("audit_report_attestation_invalid")
    for raw, expected_id in zip(raw_source_items, expected_source_ids):
        item = _expect_exact_keys(
            raw,
            {"item_id", "examined"},
            "audit_report_attestation_invalid",
        )
        if item["item_id"] != expected_id or item["examined"] is not True:
            raise LauncherError("audit_report_attestation_invalid")
    actual_snapshots: list[dict[str, str]] = []
    for raw in raw_snapshots:
        snapshot = _expect_exact_keys(
            raw,
            {"snapshot_id", "sha256", "examined"},
            "audit_report_attestation_invalid",
        )
        snapshot_id = snapshot["snapshot_id"]
        snapshot_sha256 = snapshot["sha256"]
        if (
            not isinstance(snapshot_id, str)
            or not isinstance(snapshot_sha256, str)
            or not HASH_RE.fullmatch(snapshot_id)
            or not HASH_RE.fullmatch(snapshot_sha256)
            or snapshot["examined"] is not True
        ):
            raise LauncherError("audit_report_attestation_invalid")
        actual_snapshots.append(
            {"snapshot_id": snapshot_id, "sha256": snapshot_sha256}
        )
    expected_sorted = sorted(expected_snapshots, key=lambda item: item["snapshot_id"])
    if actual_snapshots != expected_sorted:
        raise LauncherError("audit_report_attestation_invalid")
    return {
        "schema_version": COVERAGE_SCHEMA_VERSION,
        "run_nonce": run_nonce,
        "sidecar_sha256": digest,
        "inventory_sha256": (
            "" if inventory is None else inventory["aggregate_sha256"]
        ),
        "source_items_expected": len(expected_source_ids),
        "source_items_examined": len(expected_source_ids),
        "snapshots_expected": len(expected_snapshots),
        "snapshots_examined": len(expected_snapshots),
    }


def _seal_audit_report(report: dict[str, Any]) -> dict[str, Any]:
    sealed = dict(report)
    findings = sealed.get("findings")
    if not isinstance(findings, list):
        return sealed
    canonical: list[Any] = []
    for raw in findings:
        if not isinstance(raw, dict):
            canonical.append(raw)
            continue
        finding = dict(raw)
        if "summary" in finding:
            finding["summary"] = _canonicalize_safe_summary(
                finding["summary"]
            )
        if "evidence" in finding:
            finding["evidence"] = _canonicalize_string_list(
                finding["evidence"], _canonicalize_opaque_ref
            )
        canonical.append(finding)
    sealed["findings"] = canonical
    return sealed


def validate_audit_report(
    report: dict[str, Any],
    mode: str,
    commanders: list[Commander],
    inventory: dict[str, Any] | None,
    expected_snapshots: list[dict[str, str]],
    coverage_attestation: dict[str, Any],
) -> None:
    _expect_exact_keys(
        report,
        {
            "schema_version",
            "prompt_version",
            "mode",
            "status",
            "commanders_expected",
            "commander_ids",
            "inventory_attestation",
            "coverage_attestation",
            "semantic_checks",
            "correction_commander_ids",
            "findings",
        },
        "audit_report_schema_invalid",
    )
    expected_ids = sorted(commander.commander_id for commander in commanders)
    reported_ids = report.get("commander_ids")
    correction_ids = report.get("correction_commander_ids")
    expected_inventory = _expected_inventory_attestation(inventory)
    raw_inventory_attestation = report.get("inventory_attestation")
    if (
        not isinstance(raw_inventory_attestation, dict)
        or canonical_json(raw_inventory_attestation)
        != canonical_json(expected_inventory)
    ):
        raise LauncherError("audit_report_attestation_invalid")
    if (
        not isinstance(coverage_attestation, dict)
        or canonical_json(report.get("coverage_attestation"))
        != canonical_json(coverage_attestation)
        or coverage_attestation.get("snapshots_expected")
        != len(expected_snapshots)
        or coverage_attestation.get("source_items_expected")
        != (0 if inventory is None else inventory["item_count"])
    ):
        raise LauncherError("audit_report_attestation_invalid")
    semantic_checks = _expect_exact_keys(
        report.get("semantic_checks"),
        set(AUDIT_SEMANTIC_CHECKS),
        "audit_report_attestation_invalid",
    )
    if any(not isinstance(value, bool) for value in semantic_checks.values()):
        raise LauncherError("audit_report_attestation_invalid")
    if (
        not isinstance(reported_ids, list)
        or any(not isinstance(item, str) for item in reported_ids)
        or len(set(reported_ids)) != len(reported_ids)
        or not isinstance(correction_ids, list)
        or any(not isinstance(item, str) for item in correction_ids)
        or len(set(correction_ids)) != len(correction_ids)
        or any(item not in expected_ids for item in correction_ids)
    ):
        raise LauncherError("audit_report_identity_invalid")
    if (
        report["schema_version"] != SCHEMA_VERSION
        or report["prompt_version"] != PROMPT_VERSION
        or report["mode"] != mode
        or report["status"] not in {"pass", "fail"}
        or report["commanders_expected"] != len(commanders)
        or sorted(reported_ids) != expected_ids
        or len(reported_ids) != len(expected_ids)
        or not isinstance(report["findings"], list)
        or len(report["findings"]) > MAX_REPORT_LIST_ITEMS
    ):
        raise LauncherError("audit_report_identity_invalid")
    blocking = 0
    blocking_commanders: set[str] = set()
    blocking_kinds: set[str] = set()
    known_items = (
        set() if inventory is None else {item["item_id"] for item in inventory["items"]}
    )
    for raw in report["findings"]:
        finding = _expect_exact_keys(
            raw,
            {
                "severity", "kind", "summary", "source_item_ids",
                "commander_ids", "evidence",
            },
            "audit_report_schema_invalid",
        )
        if finding["severity"] not in {"blocking", "nonblocking"} or finding[
            "kind"
        ] not in {
            "source_item_gap", "ownership_conflict", "duplication",
            "stale_inclusion", "sensitive_inclusion", "candidate_write_violation",
            "protected_file_change", "disallowed_change", "agent_failure",
            "uncertainty", "candidate",
        }:
            raise LauncherError("audit_report_schema_invalid")
        _validate_safe_summary(
            finding["summary"], "audit_report_privacy_invalid"
        )
        source_item_ids = finding["source_item_ids"]
        finding_commanders = finding["commander_ids"]
        if (
            not isinstance(source_item_ids, list)
            or len(set(source_item_ids)) != len(source_item_ids)
            or any(not isinstance(item, str) for item in source_item_ids)
            or (inventory is None and bool(source_item_ids))
            or (inventory is not None and any(item not in known_items for item in source_item_ids))
            or not isinstance(finding_commanders, list)
            or not finding_commanders
            or len(set(finding_commanders)) != len(finding_commanders)
            or any(item not in expected_ids for item in finding_commanders)
        ):
            raise LauncherError("audit_report_schema_invalid")
        _validate_string_list(
            finding["evidence"],
            allow_empty=False,
            code="audit_report_schema_invalid",
            max_items=MAX_REPORT_EVIDENCE_ITEMS,
        )
        for evidence in finding["evidence"]:
            _validate_opaque_ref(evidence, "audit_report_privacy_invalid")
        blocking += finding["severity"] == "blocking"
        if finding["severity"] == "blocking":
            blocking_commanders.update(finding_commanders)
            blocking_kinds.add(finding["kind"])
    false_checks = {
        key for key, value in semantic_checks.items() if value is False
    }
    for check, finding_kind in AUDIT_SEMANTIC_CHECKS.items():
        if (check in false_checks) != (finding_kind in blocking_kinds):
            raise LauncherError("audit_report_attestation_invalid")
    semantic_pass = not false_checks
    if (
        (report["status"] == "pass") != (blocking == 0 and semantic_pass)
        or (report["status"] == "pass" and correction_ids)
        or (report["status"] == "fail" and not correction_ids)
        or blocking_commanders != set(correction_ids)
    ):
        raise LauncherError("audit_report_status_invalid")
    if contains_secret(canonical_json(report)):
        raise LauncherError("audit_report_secret_detected")


def _workspace_digest(root: Path) -> list[tuple[str, str, int, str]]:
    manifest: list[tuple[str, str, int, str]] = []
    for path in sorted(root.rglob("*"), key=lambda value: value.as_posix()):
        if path.is_symlink() or (not path.is_dir() and not path.is_file()):
            raise LauncherError("audit_workspace_invalid")
        relative = path.relative_to(root).as_posix()
        if path.is_file():
            metadata = path.stat()
            manifest.append(
                (relative, "file", metadata.st_size, sha256_file(path))
            )
        else:
            manifest.append((relative, "directory", 0, ""))
    return manifest


def _audit_workspace_has_only_sidecar_output(
    workspace: Path,
) -> bool:
    try:
        entries = list(workspace.iterdir())
        if len(entries) != 1 or entries[0].name != AUDIT_COVERAGE_NAME:
            return False
        metadata = os.lstat(entries[0])
        return bool(
            stat.S_ISREG(metadata.st_mode)
            and metadata.st_nlink == 1
            and 0 < metadata.st_size <= MAX_COVERAGE_SIDECAR_BYTES
        )
    except OSError:
        return False


def run_aggregate_audit(
    mode: str,
    commanders: list[Commander],
    results: list[CommanderResult],
    inventory: dict[str, Any] | None,
    codex_command: Sequence[str],
    timeout_seconds: int | None,
    staging_root: Path | None,
    initial_memory: dict[str, dict[str, bytes]],
    model: str,
) -> CodexResult:
    with tempfile.TemporaryDirectory(prefix="memory-reflector-audit-", dir=staging_root) as temporary:
        run_root = Path(temporary)
        if not _register_active_temp_root(run_root):
            return CodexResult(False, "launcher_shutdown", None)
        try:
            return _run_aggregate_audit_staged(
                mode,
                commanders,
                results,
                inventory,
                codex_command,
                timeout_seconds,
                initial_memory,
                model,
                run_root,
            )
        finally:
            _discard_active_temp_root(run_root)


def _run_aggregate_audit_staged(
    mode: str,
    commanders: list[Commander],
    results: list[CommanderResult],
    inventory: dict[str, Any] | None,
    codex_command: Sequence[str],
    timeout_seconds: int | None,
    initial_memory: dict[str, dict[str, bytes]],
    model: str,
    run_root: Path,
) -> CodexResult:
    run_nonce = sha256_bytes(os.urandom(32))
    workspace = run_root / "workspace"
    evidence = run_root / "evidence"
    control = run_root / "control"
    workspace.mkdir()
    evidence.mkdir()
    control.mkdir()
    snapshots_root = evidence / "memory"
    snapshots_root.mkdir()
    snapshot_manifest: list[dict[str, Any]] = []
    expected_snapshots: list[dict[str, str]] = []
    for commander in commanders:
        commander_root = snapshots_root / commander.commander_id
        before_root = commander_root / "before"
        after_root = commander_root / "after"
        before_root.mkdir(parents=True)
        after_root.mkdir(parents=True)
        current = {
            "l1": commander.l1_file.read_bytes(),
            "l2": commander.l2_file.read_bytes(),
            "l3": commander.l3_file.read_bytes(),
            "commander": commander.commander_file.read_bytes(),
        }
        commander_snapshots: list[dict[str, str]] = []
        for tier, filename in (
            ("l1", L1_NAME),
            ("l2", L2_NAME),
            ("l3", L3_NAME),
        ):
            before_bytes = initial_memory[commander.commander_id][tier]
            after_bytes = current[tier]
            before_path = before_root / filename
            after_path = after_root / filename
            before_path.write_bytes(before_bytes)
            after_path.write_bytes(after_bytes)
            for phase, path, data in (
                ("before", before_path, before_bytes),
                ("after", after_path, after_bytes),
            ):
                attestation = {
                    "snapshot_id": _snapshot_id(
                        commander.commander_id, tier, phase
                    ),
                    "sha256": sha256_bytes(data),
                }
                expected_snapshots.append(attestation)
                commander_snapshots.append(
                    {
                        **attestation,
                        "tier": tier,
                        "phase": phase,
                        "path": str(path),
                    }
                )
        snapshot_manifest.append(
            {
                "commander_id": commander.commander_id,
                "commander_root": str(commander.root),
                "before_root": str(before_root),
                "after_root": str(after_root),
                "snapshots": commander_snapshots,
                "commander_before_sha256": sha256_bytes(
                    initial_memory[commander.commander_id]["commander"]
                ),
                "commander_after_sha256": sha256_bytes(current["commander"]),
                "allowed_changes": (
                    [L1_NAME, L2_NAME, L3_NAME]
                    if mode == "reflector"
                    else [L2_NAME, L3_NAME]
                ),
            }
        )
    inventory_path: Path | None = None
    if inventory is not None:
        inventory_path = evidence / "source-inventory.json"
        write_control_json(inventory_path, inventory)
    audit_input = {
        "schema_version": SCHEMA_VERSION,
        "mode": mode,
        "inventory": (
            None
            if inventory is None
            else {
                "aggregate_sha256": inventory["aggregate_sha256"],
                "path": str(inventory_path),
                "file_count": inventory["file_count"],
                "byte_count": inventory["byte_count"],
                "item_count": inventory["item_count"],
            }
        ),
        "commanders": [
            {
                "commander_id": result.commander_id,
                "name": result.name,
                "commander_root": str(
                    next(
                        commander.root
                        for commander in commanders
                        if commander.commander_id == result.commander_id
                    )
                ),
                "success": result.success,
                "error_code": result.error_code,
                "report": result.report,
                "source_coverage": result.coverage,
            }
            for result in results
        ],
        "memory_snapshots": snapshot_manifest,
    }
    input_path = evidence / "agent-reports.json"
    write_control_json(input_path, audit_input)
    for path in evidence.rglob("*"):
        if path.is_file():
            path.chmod(0o444)
    evidence_before = _workspace_digest(evidence)
    audit_coverage_path = workspace / AUDIT_COVERAGE_NAME
    write_control_json(
        audit_coverage_path,
        _audit_coverage_skeleton(mode, inventory, expected_snapshots, run_nonce),
    )
    schema_path = control / "audit-schema.json"
    last_message_path = control / "last-message.json"
    write_control_json(
        schema_path,
        build_audit_schema(
            mode, commanders, inventory, expected_snapshots, run_nonce
        ),
    )
    corpus_instruction = (
        "There is no import corpus in this weekly run."
        if inventory is None
        else (
            "Independently read every immutable corpus item and every linked or "
            "unindexed file from the source inventory."
        )
    )
    prompt = f"""You are the independent semantic auditor for a fleet memory run.

Prompt contract: {PROMPT_VERSION}
Mode: {mode}
Read the audit manifest and per-Commander outcomes at {input_path}.
{corpus_instruction}
Read every before/after L1/L2/L3 snapshot named in the manifest. Do not trust a
per-Commander source_coverage claim without checking its source item.

Verify exact source-item coverage; one justified semantic owner for each fact;
absence of unjustified duplication; exclusion of stale and sensitive material;
report-only handling of shared/project candidates; the weekly L1 retention
limits when applicable; protected COMMANDER/source files; and the allowed-change
set. Treat failed/missing runs as blocking. Every blocking finding must name the
exact Commander IDs that should receive a correction pass. Use only opaque
source item IDs, absolute paths, 64-character lowercase SHA-256 IDs, or typed
references in the form `kind:value` with no whitespace in the value as
evidence, never excerpts or quotes. Every finding summary must be one
non-empty bounded line with no carriage return or newline.
The launcher precreated {audit_coverage_path} for run {run_nonce} with exact
sorted source-item and snapshot rows whose examined fields are false. Do not
change its header, keys, order, IDs, or hashes. Only after independently
examining each item, change that row's examined field to true. Leave no false
field. Hash the exact final sidecar bytes and return only its compact
coverage_attestation in the final JSON; do not repeat the source IDs or snapshot
pairs there. Set every required semantic boolean
honestly only after examining the corresponding evidence. A
false semantic check requires a blocking finding of its mapped kind for the
affected Commander IDs. Pass only when every semantic check is true and there
are no blocking findings.
The audit evidence is outside the writable output directory and immutable. The
precreated coverage sidecar is the only workspace path you may edit. Return only
the JSON object required by the schema.
"""
    command = codex_exec_command(
        codex_command,
        workspace,
        schema_path,
        last_message_path,
        "workspace-write",
        model,
    )
    result = invoke_codex(command, prompt, last_message_path, timeout_seconds)
    if _workspace_digest(evidence) != evidence_before:
        return CodexResult(False, "audit_evidence_changed", None)
    if not _audit_workspace_has_only_sidecar_output(workspace):
        return CodexResult(False, "audit_workspace_changed", None)
    if not result.success or result.message is None:
        return result
    try:
        coverage_attestation = _validate_audit_coverage_sidecar(
            audit_coverage_path,
            mode,
            inventory,
            expected_snapshots,
            run_nonce,
        )
        report = _seal_audit_report(result.message)
        validate_audit_report(
            report,
            mode,
            commanders,
            inventory,
            expected_snapshots,
            coverage_attestation,
        )
    except LauncherError as exc:
        return CodexResult(False, exc.code, None)
    return CodexResult(True, None, report)


def _public_commander_result(result: CommanderResult) -> dict[str, Any]:
    public: dict[str, Any] = {
        "commander_id": result.commander_id,
        "name": result.name,
        "success": result.success,
        "error_code": result.error_code,
        "phase": result.phase,
        "coverage_item_count": result.coverage_item_count,
        "elapsed_seconds": result.elapsed_seconds,
    }
    if result.report is not None:
        public["report_status"] = result.report["status"]
        public["changes"] = result.report["changes"]
        public["counts"] = result.report["counts"]
    return public


def _public_audit_result(audit: CodexResult) -> dict[str, Any]:
    if not audit.success or audit.message is None:
        return {"success": False, "error_code": audit.error_code}
    findings = audit.message["findings"]
    return {
        "success": True,
        "status": audit.message["status"],
        "commanders_expected": audit.message["commanders_expected"],
        "correction_commander_ids": audit.message["correction_commander_ids"],
        "finding_count": len(findings),
        "blocking_finding_count": sum(
            finding["severity"] == "blocking" for finding in findings
        ),
        "nonblocking_finding_count": sum(
            finding["severity"] == "nonblocking" for finding in findings
        ),
        "finding_kinds": sorted({finding["kind"] for finding in findings}),
    }


def _initial_memory_snapshot(
    commanders: Sequence[Commander],
) -> dict[str, dict[str, bytes]]:
    try:
        return {
            commander.commander_id: {
                "commander": commander.commander_file.read_bytes(),
                "l1": commander.l1_file.read_bytes(),
                "l2": commander.l2_file.read_bytes(),
                "l3": commander.l3_file.read_bytes(),
            }
            for commander in commanders
        }
    except OSError as exc:
        raise LauncherError("initial_memory_snapshot_failed") from exc


def _initial_expected_hashes(
    initial_memory: dict[str, dict[str, bytes]],
) -> dict[str, dict[str, str]]:
    return {
        commander_id: {
            key: sha256_bytes(value) for key, value in snapshot.items()
        }
        for commander_id, snapshot in initial_memory.items()
    }


def _verify_expected_memory(
    commanders: Sequence[Commander], expected: dict[str, dict[str, str]]
) -> None:
    try:
        for commander in commanders:
            if _hash_snapshot(commander) != expected[commander.commander_id]:
                raise LauncherError("published_memory_drift")
    except OSError as exc:
        raise LauncherError("published_memory_unreadable") from exc


def _accept_successful_publish(
    commander: Commander,
    result: CommanderResult,
    expected: dict[str, dict[str, str]],
) -> None:
    if not result.success:
        return
    if result.report is None or not isinstance(result.report.get("hashes"), dict):
        raise LauncherError("successful_publish_attestation_missing")
    hashes = result.report["hashes"]
    expected_before = expected[commander.commander_id]
    declared_before = {
        "commander": hashes.get("commander_before"),
        "l1": hashes.get("l1_before"),
        "l2": hashes.get("l2_before"),
        "l3": hashes.get("l3_before"),
    }
    declared_after = {
        "commander": hashes.get("commander_after"),
        "l1": hashes.get("l1_after"),
        "l2": hashes.get("l2_after"),
        "l3": hashes.get("l3_after"),
    }
    try:
        live = _hash_snapshot(commander)
    except OSError as exc:
        raise LauncherError("successful_publish_unreadable") from exc
    if declared_before != expected_before or declared_after != live:
        raise LauncherError("successful_publish_attestation_invalid")
    expected[commander.commander_id] = declared_after


def _verify_expected_commander(
    commander: Commander, expected: dict[str, str]
) -> None:
    try:
        if _hash_snapshot(commander) != expected:
            raise LauncherError("published_memory_drift")
    except OSError as exc:
        raise LauncherError("published_memory_unreadable") from exc


def _fleet_timeout_result(commander: Commander) -> CommanderResult:
    return CommanderResult(
        commander.commander_id,
        commander.name,
        False,
        "fleet_timeout",
        phase="fleet_timeout_before_start",
    )


def _run_commander_batch(
    commanders: Sequence[Commander],
    mode: str,
    inventory: dict[str, Any] | None,
    codex_command: Sequence[str],
    timeout_seconds: int | None,
    fleet_deadline: float | None,
    reserve_seconds: int,
    max_memory_bytes: int,
    staging_root: Path | None,
    model: str,
    max_concurrency: int,
    expected_memory: dict[str, dict[str, str]],
    correction_audit: dict[str, Any] | None = None,
    correction_initial_memory: dict[str, dict[str, bytes]] | None = None,
) -> list[CommanderResult]:
    if not 1 <= max_concurrency <= MAX_MAX_CONCURRENCY:
        raise LauncherError("max_concurrency_invalid")
    if (correction_audit is None) != (correction_initial_memory is None):
        raise LauncherError("correction_context_invalid")
    batch_expected = {
        commander.commander_id: dict(expected_memory[commander.commander_id])
        for commander in commanders
    }

    def invoke(commander: Commander) -> CommanderResult:
        if SHUTDOWN_REQUESTED.is_set():
            return CommanderResult(
                commander.commander_id,
                commander.name,
                False,
                "launcher_shutdown",
                phase="launcher_rejected",
            )
        if fleet_deadline is None:
            effective_timeout = timeout_seconds
        else:
            if timeout_seconds is None:
                return _fleet_timeout_result(commander)
            effective_timeout = _bounded_timeout(
                timeout_seconds,
                fleet_deadline,
                reserve_seconds=reserve_seconds,
            )
            if effective_timeout is None:
                return _fleet_timeout_result(commander)
        correction_kwargs: dict[str, Any] = {}
        if correction_audit is not None:
            assert correction_initial_memory is not None
            correction_kwargs = {
                "correction_audit": correction_audit,
                "correction_initial_memory": correction_initial_memory[
                    commander.commander_id
                ],
            }
        return run_commander(
            commander,
            mode,
            inventory,
            codex_command,
            effective_timeout,
            max_memory_bytes,
            staging_root,
            model,
            expected_before=batch_expected[commander.commander_id],
            **correction_kwargs,
        )

    results_by_id: dict[str, CommanderResult] = {}
    executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=max_concurrency,
        thread_name_prefix="memory-commander",
    )
    try:
        future_to_commander = {
            executor.submit(invoke, commander): commander for commander in commanders
        }
        for future in concurrent.futures.as_completed(future_to_commander):
            commander = future_to_commander[future]
            try:
                results_by_id[commander.commander_id] = future.result()
            except Exception:
                results_by_id[commander.commander_id] = CommanderResult(
                    commander.commander_id,
                    commander.name,
                    False,
                    "commander_worker_failed",
                    phase="launcher_rejected",
                )
    finally:
        executor.shutdown(
            wait=True,
            cancel_futures=SHUTDOWN_REQUESTED.is_set(),
        )

    results = [results_by_id[commander.commander_id] for commander in commanders]
    for commander, result in zip(commanders, results):
        if result.success:
            _accept_successful_publish(commander, result, expected_memory)
        else:
            _verify_expected_commander(
                commander, batch_expected[commander.commander_id]
            )
    _verify_expected_memory(commanders, expected_memory)
    return results


def _verify_roster(
    happy_command: Sequence[str], happy_home: Path, expected: Sequence[Commander]
) -> None:
    if discover_commanders(happy_command, happy_home) != list(expected):
        raise LauncherError("commander_roster_changed")


def _bounded_timeout(
    configured_seconds: int, deadline: float, reserve_seconds: int = 0
) -> int | None:
    available = int(deadline - time.monotonic() - reserve_seconds)
    if available < 1:
        return None
    return min(configured_seconds, available)


def _verify_protected_inputs(
    commanders: Sequence[Commander],
    initial_memory: dict[str, dict[str, bytes]],
    mode: str,
    inventory: dict[str, Any] | None,
    inventory_input_path: Path | None,
    inventory_input_hash: str | None,
) -> None:
    try:
        for commander in commanders:
            initial = initial_memory[commander.commander_id]
            if commander.commander_file.read_bytes() != initial["commander"]:
                raise LauncherError("protected_commander_changed")
            if mode == "migration" and commander.l1_file.read_bytes() != initial["l1"]:
                raise LauncherError("protected_migration_l1_changed")
    except OSError as exc:
        raise LauncherError("protected_input_unreadable") from exc
    if inventory is not None:
        verify_inventory_files(inventory)
    if inventory_input_path is not None and (
        not inventory_input_path.is_file()
        or _safe_sha256(inventory_input_path) != inventory_input_hash
    ):
        raise LauncherError("source_inventory_changed")


def execute(args: argparse.Namespace) -> tuple[int, dict[str, Any]]:
    deadline = (
        None
        if args.no_timeout
        else time.monotonic() + args.fleet_timeout_seconds
    )
    happy_home = Path(
        os.environ.get("HAPPY_HOME_DIR", str(Path.home() / ".happyherd"))
    ).expanduser().resolve()
    staging_root = (
        Path(args.staging_root).expanduser().resolve() if args.staging_root else None
    )
    if staging_root is not None and not staging_root.is_dir():
        raise LauncherError("staging_root_invalid")
    happy_command = default_happy_command()
    commanders = discover_commanders(happy_command, happy_home)
    if (
        args.mode == "migration"
        and args.expected_count is not None
        and len(commanders) != args.expected_count
    ):
        raise LauncherError("expected_commander_count_mismatch")

    inventory: dict[str, Any] | None = None
    inventory_input_path: Path | None = None
    inventory_input_hash: str | None = None
    if args.mode == "migration":
        if args.inventory:
            raw_inventory_path = Path(args.inventory).expanduser()
            if raw_inventory_path.is_symlink():
                raise LauncherError("source_inventory_invalid")
            try:
                inventory_input_path = raw_inventory_path.resolve(strict=True)
                inventory_input_hash = sha256_file(inventory_input_path)
            except OSError as exc:
                raise LauncherError("source_inventory_invalid") from exc
            inventory = load_inventory(inventory_input_path)
        else:
            inventory = build_inventory(Path(path) for path in args.source_root)
        verify_inventory_files(inventory)
    codex_command = default_codex_command()
    validate_codex_cli(codex_command)
    agent_mode = "claude-import" if args.mode == "migration" else "reflector"
    initial_memory = _initial_memory_snapshot(commanders)
    expected_memory = _initial_expected_hashes(initial_memory)
    reserve_for_audit = args.audit_timeout_seconds
    _verify_roster(happy_command, happy_home, commanders)
    _verify_expected_memory(commanders, expected_memory)
    initial_results = _run_commander_batch(
        commanders,
        agent_mode,
        inventory,
        codex_command,
        None if args.no_timeout else args.timeout_seconds,
        deadline,
        reserve_for_audit,
        args.max_memory_bytes,
        staging_root,
        args.model,
        args.max_concurrency,
        expected_memory,
    )
    results_by_id = {result.commander_id: result for result in initial_results}

    correction_rounds: list[list[str]] = []
    audit = CodexResult(False, "aggregate_audit_not_run", None)
    for audit_round in range(args.max_correction_rounds + 1):
        _verify_roster(happy_command, happy_home, commanders)
        _verify_expected_memory(commanders, expected_memory)
        _verify_protected_inputs(
            commanders,
            initial_memory,
            args.mode,
            inventory,
            inventory_input_path,
            inventory_input_hash,
        )
        if deadline is None:
            audit_timeout = None
        else:
            audit_timeout = _bounded_timeout(
                args.audit_timeout_seconds, deadline
            )
            if audit_timeout is None:
                audit = CodexResult(False, "fleet_timeout", None)
                break
        results = [results_by_id[item.commander_id] for item in commanders]
        try:
            audit = run_aggregate_audit(
                agent_mode,
                commanders,
                results,
                inventory,
                codex_command,
                audit_timeout,
                staging_root,
                initial_memory,
                args.model,
            )
        except (LauncherError, OSError, ValueError, TypeError, KeyError):
            audit = CodexResult(False, "aggregate_audit_failed", None)
        _verify_protected_inputs(
            commanders,
            initial_memory,
            args.mode,
            inventory,
            inventory_input_path,
            inventory_input_hash,
        )
        _verify_expected_memory(commanders, expected_memory)
        _verify_roster(happy_command, happy_home, commanders)
        if (
            not audit.success
            or audit.message is None
            or audit.message["status"] == "pass"
            or audit_round == args.max_correction_rounds
        ):
            break

        requested_corrections = set(
            audit.message["correction_commander_ids"]
        )
        correction_ids = [
            commander.commander_id
            for commander in commanders
            if commander.commander_id in requested_corrections
        ]
        correction_rounds.append(correction_ids)
        by_id = {item.commander_id: item for item in commanders}
        correction_commanders = [by_id[item] for item in correction_ids]
        _verify_roster(happy_command, happy_home, commanders)
        _verify_expected_memory(commanders, expected_memory)
        corrected_results = _run_commander_batch(
            correction_commanders,
            agent_mode,
            inventory,
            codex_command,
            None if args.no_timeout else args.timeout_seconds,
            deadline,
            reserve_for_audit,
            args.max_memory_bytes,
            staging_root,
            args.model,
            args.max_concurrency,
            expected_memory,
            correction_audit=audit.message,
            correction_initial_memory=initial_memory,
        )
        for corrected in corrected_results:
            results_by_id[corrected.commander_id] = corrected
        _verify_expected_memory(commanders, expected_memory)
        _verify_roster(happy_command, happy_home, commanders)

    _verify_roster(happy_command, happy_home, commanders)
    _verify_expected_memory(commanders, expected_memory)
    _verify_protected_inputs(
        commanders,
        initial_memory,
        args.mode,
        inventory,
        inventory_input_path,
        inventory_input_hash,
    )
    results = [results_by_id[item.commander_id] for item in commanders]
    audit_passed = bool(
        audit.success and audit.message is not None and audit.message.get("status") == "pass"
    )
    success = all(result.success for result in results) and audit_passed
    summary = {
        "schema_version": SCHEMA_VERSION,
        "mode": args.mode,
        "success": success,
        "roster_count": len(commanders),
        "inventory": (
            None
            if inventory is None
            else {
                "aggregate_sha256": inventory["aggregate_sha256"],
                "file_count": inventory["file_count"],
                "byte_count": inventory["byte_count"],
                "item_count": inventory["item_count"],
                "indexed_item_count": inventory["indexed_item_count"],
                "inline_only_item_count": inventory["inline_only_item_count"],
                "unindexed_item_count": inventory["unindexed_item_count"],
            }
        ),
        "model": args.model,
        "max_concurrency": args.max_concurrency,
        "no_timeout": args.no_timeout,
        "fleet_timeout_seconds": (
            None if args.no_timeout else args.fleet_timeout_seconds
        ),
        "max_correction_rounds": args.max_correction_rounds,
        "correction_rounds": correction_rounds,
        "commanders": [_public_commander_result(result) for result in results],
        "aggregate_audit": _public_audit_result(audit),
    }
    return (0 if success else 1), summary


def _safe_sha256(path: Path) -> str | None:
    try:
        return sha256_file(path)
    except OSError:
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one isolated semantic memory cleanup agent per HappyHerd Commander."
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument(
            "--timeout-seconds",
            type=int,
            default=1800,
            help="Per-Commander deadline unless --no-timeout is set.",
        )
        subparser.add_argument(
            "--audit-timeout-seconds",
            type=int,
            default=1800,
            help="Aggregate-audit deadline unless --no-timeout is set.",
        )
        subparser.add_argument(
            "--fleet-timeout-seconds",
            type=int,
            default=DEFAULT_FLEET_TIMEOUT_SECONDS,
            help="Whole-run deadline unless --no-timeout is set.",
        )
        subparser.add_argument(
            "--no-timeout",
            action="store_true",
            help=(
                "Disable Commander, correction, aggregate-audit, and fleet "
                "deadlines; children run until completion or a parent signal."
            ),
        )
        subparser.add_argument(
            "--max-concurrency",
            type=int,
            choices=range(1, MAX_MAX_CONCURRENCY + 1),
            default=DEFAULT_MAX_CONCURRENCY,
            metavar="{1,2,3}",
            help="Maximum simultaneous Commander codex exec processes (default: 1).",
        )
        subparser.add_argument(
            "--max-correction-rounds",
            type=int,
            default=DEFAULT_MAX_CORRECTION_ROUNDS,
        )
        subparser.add_argument("--model", default=DEFAULT_MODEL)
        subparser.add_argument("--max-memory-bytes", type=int, default=65536)
        subparser.add_argument("--staging-root")

    weekly = subparsers.add_parser("weekly", help="Run the weekly per-Commander Reflector.")
    add_common(weekly)

    migration = subparsers.add_parser(
        "migration", help="Run a full-corpus Claude memory migration."
    )
    add_common(migration)
    source_group = migration.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--inventory", help="Immutable inventory JSON path.")
    source_group.add_argument(
        "--source-root",
        action="append",
        default=[],
        help="Claude memory root to inventory recursively; repeat for every root.",
    )
    migration.add_argument(
        "--expected-count",
        type=int,
        help="Fail unless the discovered migration roster has this size.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    install_signal_handlers()
    atexit.register(cleanup_active_state)
    parser = build_parser()
    args = parser.parse_args(argv)
    if (
        (
            not args.no_timeout
            and (
                args.timeout_seconds <= 0
                or args.audit_timeout_seconds <= 0
                or args.fleet_timeout_seconds <= args.audit_timeout_seconds
            )
        )
        or args.max_memory_bytes <= 0
        or args.max_correction_rounds < 0
        or not 1 <= args.max_concurrency <= MAX_MAX_CONCURRENCY
        or not isinstance(args.model, str)
        or not SAFE_MODEL_RE.fullmatch(args.model)
    ):
        parser.error(
            "timeouts and max-memory-bytes must be positive; fleet timeout must "
            "exceed audit timeout; concurrency must be 1..3; correction "
            "rounds/model must be valid"
        )
    try:
        exit_code, summary = execute(args)
    except LauncherError as exc:
        exit_code = 2
        summary = {
            "schema_version": SCHEMA_VERSION,
            "mode": args.mode,
            "success": False,
            "error_code": exc.code,
        }
    sys.stdout.buffer.write(canonical_json(summary) + b"\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
