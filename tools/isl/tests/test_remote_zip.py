"""Reading a split zip by byte range, without a network.

The offset arithmetic is the whole risk here: a boundary bug reads plausible
bytes from the wrong part, and zipfile would report a corrupt archive rather than
anything that points at the cause. These tests build a real zip, split it the way
iSign ships, and serve it from memory.
"""

from __future__ import annotations

import io
import random
import zipfile

import pytest

from tools.isl.remote_zip import RemotePart, SplitRemoteFile, open_split_zip


class FakeResponse:
    def __init__(self, content: bytes, status: int = 206, headers=None, url=""):
        self.content = content
        self.status_code = status
        self.headers = headers or {}
        self.url = url

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"status {self.status_code}")


class FakeSession:
    """Serves byte ranges out of an in-memory map of url -> bytes."""

    def __init__(self, blobs: dict[str, bytes], *, support_ranges: bool = True):
        self.blobs = blobs
        self.support_ranges = support_ranges
        self.requests: list[tuple[str, str]] = []

    def head(self, url, headers=None, allow_redirects=True, timeout=None):
        return FakeResponse(
            b"", status=200, headers={"Content-Length": str(len(self.blobs[url]))}, url=url
        )

    def get(self, url, headers=None, stream=False, timeout=None):
        rng = headers["Range"]
        self.requests.append((url, rng))
        if not self.support_ranges:
            return FakeResponse(self.blobs[url], status=200, url=url)
        span = rng.split("=")[1]
        start, end = (int(part) for part in span.split("-"))
        return FakeResponse(self.blobs[url][start : end + 1], status=206, url=url)


def build_zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def split(blob: bytes, at: int) -> dict[str, bytes]:
    """What `split -b` produces, and what the dataset card says to concatenate."""
    return {"part_aa": blob[:at], "part_ab": blob[at:]}


class TestOffsetMapping:
    def test_reads_across_the_part_boundary(self):
        blob = bytes(range(256)) * 40
        parts = split(blob, 5000)
        session = FakeSession(parts)
        stream = SplitRemoteFile(
            [RemotePart("part_aa", len(parts["part_aa"])),
             RemotePart("part_ab", len(parts["part_ab"]))],
            session=session,
            window=64,
        )

        stream.seek(4990)
        assert stream.read(20) == blob[4990:5010]

    def test_reads_the_whole_stream_in_order(self):
        blob = bytes(range(256)) * 12
        parts = split(blob, 1000)
        stream = SplitRemoteFile(
            [RemotePart("part_aa", 1000), RemotePart("part_ab", len(blob) - 1000)],
            session=FakeSession(parts),
            window=128,
        )
        assert stream.read() == blob

    def test_seek_from_end_lands_where_the_zip_directory_is(self):
        blob = bytes(range(256)) * 8
        parts = split(blob, 900)
        stream = SplitRemoteFile(
            [RemotePart("part_aa", 900), RemotePart("part_ab", len(blob) - 900)],
            session=FakeSession(parts),
        )
        stream.seek(-10, io.SEEK_END)
        assert stream.read(10) == blob[-10:]

    def test_a_window_serves_repeat_reads_without_refetching(self):
        blob = bytes(range(256)) * 8
        parts = split(blob, 900)
        session = FakeSession(parts)
        stream = SplitRemoteFile(
            [RemotePart("part_aa", 900), RemotePart("part_ab", len(blob) - 900)],
            session=session,
            window=512,
        )
        stream.seek(0)
        for _ in range(20):
            stream.seek(10)
            stream.read(4)
        # zipfile walks the directory in many small reads; without a window this
        # would be one request each.
        assert len(session.requests) <= 2


class TestSelectiveExtraction:
    def test_one_member_is_read_without_fetching_the_archive(self):
        # Incompressible members, so the archive is big enough relative to the
        # read window for selective access to be measurable at all.
        rng = random.Random(20260824)
        members = {
            f"clip_{i}.mp4": bytes(rng.randrange(256) for _ in range(8192)) for i in range(30)
        }
        blob = build_zip(members)
        parts = split(blob, len(blob) // 2)
        session = FakeSession(parts)

        archive = open_split_zip(["part_aa", "part_ab"], session=session, window=8192)
        names = archive.namelist()
        assert len(names) == 30

        data = archive.read("clip_7.mp4")
        assert data == members["clip_7.mp4"]

        fetched = sum(
            int(r[1].split("=")[1].split("-")[1]) - int(r[1].split("=")[1].split("-")[0]) + 1
            for r in session.requests
        )
        # The point of the exercise: a smoke test must not pull the corpus.
        assert fetched < len(blob)

    def test_a_host_that_ignores_ranges_fails_loudly(self):
        from tools.isl.remote_zip import RangeUnsupported

        blob = build_zip({"a.mp4": b"x" * 100})
        parts = split(blob, 50)
        session = FakeSession(parts, support_ranges=False)
        stream = SplitRemoteFile(
            [RemotePart("part_aa", 50), RemotePart("part_ab", len(blob) - 50)],
            session=session,
        )
        # Silently downloading tens of gigabytes instead would be far worse than
        # an error the caller can act on.
        with pytest.raises(RangeUnsupported):
            stream.read(10)
