"""Choosing which iSign rows are continuous, reproducibly.

RQ4 targets continuous sentence-level translation, so isolated-sign material must
stay out of the pre-training corpus. iSign keeps them apart already - CISLR is
Task 3 and ships separately from the Task 1 translation release - but that has to
be demonstrated from the data rather than assumed.

**Translation word count is deliberately not a criterion.** An isolated sign can
carry a multi-word English gloss and a continuous utterance can translate to a
single word, so a length threshold would misclassify in both directions and leave
no defensible statement about what was excluded.

The criterion is the **release**: `iSign_v1.1.csv` is the Task 1 translation set
and CISLR ships separately, so membership is what marks a row as continuous.
Source attribution is stratification metadata only - it decides which clips to
sample, never which are eligible. Audited by hand before anything scales up.

The aim is to be able to write "excluded according to reproducible corpus
identifiers", not "excluded samples that looked isolated".
"""

from __future__ import annotations

import csv
import random
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

#: iSign UIDs are documented as `[video_id]-[sequence_number]`. A row carrying a
#: sequence number is a segment cut from a longer recording, which is the shape
#: of continuous material; an isolated-sign entry has no such position.
UID_PATTERN = re.compile(r"^(?P<video>.+)-(?P<sequence>\d+)$")

#: Column names iSign might use, in preference order. Resolved against the real
#: header at run time rather than guessed, because the release is not documented
#: field by field.
SOURCE_COLUMNS = ("source", "corpus", "channel", "origin", "dataset")
UID_COLUMNS = ("uid", "id", "video_id", "name", "file")
TEXT_COLUMNS = ("text", "translation", "sentence", "english", "caption", "label")

KNOWN_SOURCES = ("ISLRTC", "ISH", "DEAF")


@dataclass
class Row:
    uid: str
    text: str
    source: str
    raw: dict[str, str] = field(default_factory=dict)

    @property
    def video_id(self) -> str:
        match = UID_PATTERN.match(self.uid)
        return match.group("video") if match else self.uid

    @property
    def has_sequence_number(self) -> bool:
        return UID_PATTERN.match(self.uid) is not None


@dataclass
class TriageReport:
    """What evidence was actually available, so the decision is inspectable."""

    header: list[str]
    uid_column: str | None
    text_column: str | None
    source_column: str | None
    total_rows: int
    with_sequence_number: int
    by_source: dict[str, int]
    unambiguous: bool
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {**self.__dict__}


def _pick(header: Sequence[str], candidates: Sequence[str]) -> str | None:
    lowered = {name.lower().strip(): name for name in header}
    for candidate in candidates:
        if candidate in lowered:
            return lowered[candidate]
    for name_lower, name in lowered.items():
        if any(candidate in name_lower for candidate in candidates):
            return name
    return None


def _source_of(raw: dict[str, str], source_column: str | None, uid: str) -> str:
    """The origin channel, only when the release actually states it.

    Never inferred from the UID. iSign UIDs are opaque YouTube video ids, and
    substring-matching a channel name into one produces false positives: on the
    first real run `3EJxfiSHeIY` matched "ISH" because those three letters
    appear inside it, and the whole smoke test was then drawn from two videos
    labelled with a channel neither of them came from.
    """
    if source_column and raw.get(source_column):
        return str(raw[source_column]).strip()
    return "unknown"


def load_rows(csv_path: Path) -> tuple[list[Row], TriageReport]:
    """Read the release CSV and report what identifiers it actually carries."""
    with open(csv_path, "r", encoding="utf8", newline="") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        uid_column = _pick(header, UID_COLUMNS)
        text_column = _pick(header, TEXT_COLUMNS)
        source_column = _pick(header, SOURCE_COLUMNS)
        if uid_column is None:
            raise ValueError(f"no UID-like column in {header}")

        rows: list[Row] = []
        for raw in reader:
            uid = str(raw.get(uid_column, "")).strip()
            if not uid:
                continue
            rows.append(
                Row(
                    uid=uid,
                    text=str(raw.get(text_column, "") if text_column else "").strip(),
                    source=_source_of(raw, source_column, uid),
                    raw=dict(raw),
                )
            )

    by_source = Counter(row.source for row in rows)
    with_sequence = sum(1 for row in rows if row.has_sequence_number)
    notes: list[str] = []
    if source_column is None:
        notes.append(
            "No explicit source column; origin inferred from the UID. "
            "Confirm against the manual audit before scaling."
        )
    if with_sequence == 0:
        notes.append(
            "No UID carries a sequence number, so segment position gives no "
            "evidence of continuity on this release."
        )
    if by_source.get("unknown", 0):
        notes.append(
            f"{by_source['unknown']} of {len(rows)} rows have no identifiable "
            "source channel. This does not affect eligibility - the release is "
            "the corpus identifier - but it does mean the sample is stratified "
            "over one group, so the manual audit carries the whole argument."
        )

    report = TriageReport(
        header=header,
        uid_column=uid_column,
        text_column=text_column,
        source_column=source_column,
        total_rows=len(rows),
        with_sequence_number=with_sequence,
        by_source=dict(by_source),
        # Whether the release told us the channel, rather than us inferring it.
        # Eligibility does not depend on this; stratification does.
        unambiguous=source_column is not None and with_sequence > 0,
        notes=notes,
    )
    return rows, report


def select_continuous(rows: Iterable[Row]) -> tuple[list[Row], list[tuple[Row, str]]]:
    """Split rows into continuous and excluded-with-a-reason.

    **The corpus identifier is the release itself.** CISLR - the isolated-sign
    set - is iSign's Task 3 and ships as a separate download; `iSign_v1.1.csv`
    is the Task 1 translation release, so membership in this file is what marks
    a row as continuous sentence or phrase material. That is the reproducible
    criterion, and it is why translation word count is not used.

    Rows are dropped only for being unusable: no translation to pair the video
    with, or no segment position in the UID.

    Source attribution is **not** a criterion. An earlier version excluded rows
    whose channel could not be identified, which threw away 127,200 of 127,237
    rows on the first real run - the release carries no source column, so
    "unknown" is the normal case, not a defect. Source is stratification
    metadata; it decides which clips to sample, never which clips are eligible.
    """
    keep: list[Row] = []
    dropped: list[tuple[Row, str]] = []
    for row in rows:
        if not row.text:
            dropped.append((row, "no translation text"))
            continue
        if not row.has_sequence_number:
            dropped.append((row, "UID carries no segment position"))
            continue
        keep.append(row)
    return keep, dropped


def stratified_sample(
    rows: Sequence[Row], count: int, *, seed: int = 20260824, by: str = "auto"
) -> list[Row]:
    """A sample spread across the corpus, not the first N rows.

    Taking the head of the file would sample one recording, one signer and one
    setup, and every throughput and detection-rate number measured from it would
    generalise to nothing. That is not hypothetical: the first real run drew all
    thirty clips from **two** source videos.

    Stratifies by source channel when the release states one, and otherwise by
    **source video**, which is always available and is the closest proxy for a
    distinct signer and recording setup. Channel-based stratification over a
    single "unknown" group is stratification in name only.
    """
    key = by
    if key == "auto":
        key = "source" if len({r.source for r in rows}) > 1 else "video"
    pick = (lambda r: r.source) if key == "source" else (lambda r: r.video_id)

    groups: dict[str, list[Row]] = {}
    for row in rows:
        groups.setdefault(pick(row), []).append(row)

    rng = random.Random(seed)
    for group in groups.values():
        rng.shuffle(group)

    out: list[Row] = []
    names = sorted(groups)
    index = 0
    while len(out) < count and any(groups[name] for name in names):
        name = names[index % len(names)]
        if groups[name]:
            out.append(groups[name].pop())
        index += 1
    return out


def audit_sample(
    rows: Sequence[Row], per_group: int = 20, *, seed: int = 20260824, groups_max: int = 5
) -> list[Row]:
    """Rows for a human to label, spread across the corpus.

    Grouped the same way as `stratified_sample`, so the audit covers what the
    corpus actually contains rather than one recording. With no channel column
    there are tens of thousands of source videos, so a bounded number of them is
    sampled rather than every one.
    """
    key = "source" if len({r.source for r in rows}) > 1 else "video"
    pick = (lambda r: r.source) if key == "source" else (lambda r: r.video_id)

    groups: dict[str, list[Row]] = {}
    for row in rows:
        groups.setdefault(pick(row), []).append(row)

    rng = random.Random(seed)
    names = sorted(groups)
    rng.shuffle(names)
    out: list[Row] = []
    for name in names[:groups_max]:
        group = list(groups[name])
        rng.shuffle(group)
        out.extend(group[:per_group])
    return out


def classification_accuracy(
    inferred: dict[str, bool], manual: dict[str, bool]
) -> dict[str, Any]:
    """Compare the automatic selection against hand labels.

    `manual` maps uid to "is this continuous", filled in by a person. Anything
    below near-perfect agreement means the identifiers are not carrying the
    decision and the criterion has to change before the corpus is built.
    """
    shared = sorted(set(inferred) & set(manual))
    if not shared:
        return {"compared": 0, "accuracy": None, "disagreements": []}

    disagreements = [uid for uid in shared if inferred[uid] != manual[uid]]
    false_continuous = [uid for uid in shared if inferred[uid] and not manual[uid]]
    false_isolated = [uid for uid in shared if not inferred[uid] and manual[uid]]
    return {
        "compared": len(shared),
        "accuracy": (len(shared) - len(disagreements)) / len(shared),
        "kept_but_isolated": false_continuous,
        "dropped_but_continuous": false_isolated,
        "disagreements": disagreements,
    }


def write_audit_csv(rows: Sequence[Row], path: Path) -> None:
    """Emit the audit sheet with an empty column for the human verdict."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["uid", "source", "text", "inferred_continuous", "manual_continuous"])
        for row in rows:
            writer.writerow([row.uid, row.source, row.text, "TRUE", ""])
