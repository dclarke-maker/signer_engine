"""A record of what has been processed, durable across Colab disconnects.

Colab sessions end without warning, so the manifest is the only thing standing
between an interrupted run and starting over. It lives on Drive, is appended to
after each clip, and is the sole authority on what to skip.

Append-only JSONL rather than a rewritten document: an interrupted append costs
at most the last line, whereas an interrupted rewrite can cost the file. A
truncated final line is tolerated on read for the same reason.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterator


#: Failures worth retrying: the network, an expired signature, a busy server.
#: A corrupt file or an unreadable codec will fail again and should not be.
TRANSIENT = (
    "HTTPError", "ConnectionError", "Timeout", "ReadTimeout", "ChunkedEncodingError",
    "SSLError", "IncompleteRead", "RemoteDisconnected", "ProtocolError",
)


def is_transient(error: str | None) -> bool:
    """Whether a recorded failure is worth trying again.

    An expired CDN signature answered 403 to every request after a point, and
    14,052 clips were recorded as failed in one run. Treating those the same as
    a corrupt video would have made the failure permanent for the whole corpus.
    """
    if not error:
        return False
    return any(name in error for name in TRANSIENT)


@dataclass
class Entry:
    uid: str
    status: str  # "done" | "failed"
    path: str | None = None
    error: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def retryable(self) -> bool:
        return self.status == "failed" and is_transient(self.error)


class Manifest:
    """Resumable, idempotent record of processed clips.

    Re-running is expected to be cheap and safe: `pending` filters out anything
    already recorded, so a second pass over the same selection does no work.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._entries: dict[str, Entry] = {}
        self._load()

    # -- reading --------------------------------------------------------------

    def _load(self) -> None:
        if not self.path.exists():
            return
        with open(self.path, "r", encoding="utf8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    # A half-written final line is what a killed session leaves
                    # behind. Everything before it is still good.
                    continue
                self._entries[raw["uid"]] = Entry(**raw)

    def __contains__(self, uid: str) -> bool:
        return uid in self._entries

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, uid: str) -> Entry | None:
        return self._entries.get(uid)

    def done(self) -> list[str]:
        return [uid for uid, e in self._entries.items() if e.status == "done"]

    def failed(self) -> list[Entry]:
        return [e for e in self._entries.values() if e.status == "failed"]

    def pending(self, uids: list[str], *, retry_failed: bool = False) -> list[str]:
        """What still needs work.

        Transient failures - the network, an expired signature - are retried by
        default, because they say nothing about the clip. Structural ones are
        not: a corrupt file or an unreadable codec will fail again, and
        retrying it every run buries the signal in the throughput numbers.
        `retry_failed` forces both.

        Classification is by error text rather than a stored flag, so a manifest
        written before this distinction existed is still read correctly.
        """
        out = []
        for uid in uids:
            entry = self._entries.get(uid)
            if entry is None or entry.retryable or (retry_failed and entry.status == "failed"):
                out.append(uid)
        return out

    def entries(self) -> Iterator[Entry]:
        return iter(self._entries.values())

    # -- writing --------------------------------------------------------------

    def record(self, entry: Entry) -> None:
        """Append one result and flush it. Durability beats throughput here."""
        self._entries[entry.uid] = entry
        with open(self.path, "a", encoding="utf8") as handle:
            handle.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def record_done(self, uid: str, path: str, detail: dict[str, Any] | None = None) -> None:
        self.record(Entry(uid=uid, status="done", path=path, detail=dict(detail or {})))

    def record_failed(
        self, uid: str, error: str, detail: dict[str, Any] | None = None
    ) -> None:
        # Reason, not just the fact: "why did 4% fail" is a question the smoke
        # test has to answer before anyone commits to the full corpus.
        self.record(Entry(uid=uid, status="failed", error=error, detail=dict(detail or {})))

    def compact(self) -> None:
        """Collapse repeated entries for the same uid. Never required, only tidy.

        Written to a sibling and renamed, so a crash mid-compaction leaves the
        original intact.
        """
        directory = self.path.parent
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf8", dir=directory, delete=False
        ) as tmp:
            for entry in self._entries.values():
                tmp.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")
            tmp.flush()
            os.fsync(tmp.fileno())
            temp_name = tmp.name
        os.replace(temp_name, self.path)

    def summary(self) -> dict[str, Any]:
        failures = self.failed()
        reasons: dict[str, int] = {}
        for entry in failures:
            key = (entry.error or "unknown").split(":")[0][:80]
            reasons[key] = reasons.get(key, 0) + 1
        return {
            "total": len(self._entries),
            "done": len(self.done()),
            "failed": len(failures),
            "retryable": sum(1 for e in failures if e.retryable),
            "failure_reasons": reasons,
        }
