"""Read individual members out of iSign's split zip without downloading it.

iSign ships its videos as `iSign-videos_v1.1_part_aa` and `_part_ab`, which the
dataset card says to concatenate into one zip. Concatenation is the obvious
approach and the wrong one here: it needs the whole corpus on disk - of the order
of tens of gigabytes - before a thirty-clip smoke test can read its first frame.

A zip's directory lives at the end of the file and every member is independently
addressable, so the archive can be read at random if the transport supports byte
ranges. This module presents the parts as one seekable stream, translating global
offsets onto (part, local offset) and fetching only what is asked for. `zipfile`
then works unmodified.

Falls back loudly rather than silently downloading everything: if the host will
not serve ranges, the caller decides.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from typing import Iterable, Sequence

import requests

#: zipfile issues many small reads while walking the central directory. Serving
#: them from a local window turns hundreds of requests into a handful.
DEFAULT_WINDOW = 1 << 20


class RangeUnsupported(RuntimeError):
    """The host ignored a Range header, so selective reads are impossible."""


@dataclass
class RemotePart:
    """One part of the split archive.

    `url` is where bytes are currently fetched from and `origin` is the stable
    address it was resolved from. Hugging Face redirects to a CDN URL carrying a
    time-limited signature, so pinning the resolved URL works until the
    signature expires and then fails every request with 403 - which on the first
    corpus run happened partway through and cost 14,052 clips.
    """

    url: str
    size: int
    origin: str | None = None


class SplitRemoteFile(io.RawIOBase):
    """A read-only, seekable file over an ordered list of remote parts.

    The parts are treated as one contiguous byte stream, which is what
    `cat part_aa part_ab > whole.zip` would have produced.
    """

    def __init__(
        self,
        parts: Sequence[RemotePart],
        *,
        session: requests.Session | None = None,
        headers: dict[str, str] | None = None,
        window: int = DEFAULT_WINDOW,
    ) -> None:
        if not parts:
            raise ValueError("no parts given")
        self._parts = list(parts)
        self._session = session or requests.Session()
        self._headers = dict(headers or {})
        self._window = window
        self._pos = 0
        self._size = sum(p.size for p in self._parts)
        # Cumulative start offset of each part in the joined stream.
        self._starts: list[int] = []
        running = 0
        for part in self._parts:
            self._starts.append(running)
            running += part.size
        self._cache_at = -1
        self._cache = b""

    # -- io.RawIOBase ---------------------------------------------------------

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self._pos = offset
        elif whence == io.SEEK_CUR:
            self._pos += offset
        elif whence == io.SEEK_END:
            self._pos = self._size + offset
        else:
            raise ValueError(f"bad whence {whence}")
        self._pos = max(0, min(self._pos, self._size))
        return self._pos

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = self._size - self._pos
        size = min(size, self._size - self._pos)
        if size <= 0:
            return b""
        out = self._read_at(self._pos, size)
        self._pos += len(out)
        return out

    def readinto(self, buffer) -> int:
        """Required by BufferedReader, which never calls `read`.

        Without this, RawIOBase's default raises NotImplementedError and zipfile
        fails while looking for the ZIP64 end-of-directory record - a long way
        from anything that names the cause.
        """
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    # -- transport ------------------------------------------------------------

    def _read_at(self, offset: int, size: int) -> bytes:
        if self._cache_at <= offset and offset + size <= self._cache_at + len(self._cache):
            start = offset - self._cache_at
            return self._cache[start : start + size]

        want = max(size, self._window)
        want = min(want, self._size - offset)
        self._cache = self._fetch(offset, want)
        self._cache_at = offset
        return self._cache[:size]

    def _fetch(self, offset: int, size: int) -> bytes:
        """Gather `size` bytes from `offset`, crossing part boundaries as needed."""
        chunks: list[bytes] = []
        remaining = size
        cursor = offset
        while remaining > 0:
            index = self._part_for(cursor)
            part = self._parts[index]
            local = cursor - self._starts[index]
            take = min(remaining, part.size - local)
            chunks.append(self._fetch_range(part, local, take))
            cursor += take
            remaining -= take
        return b"".join(chunks)

    def _part_for(self, offset: int) -> int:
        for i in range(len(self._parts) - 1, -1, -1):
            if offset >= self._starts[i]:
                return i
        return 0

    def _fetch_range(self, part: RemotePart, offset: int, size: int) -> bytes:
        response = self._range_request(part, offset, size)

        # A signed CDN URL that has expired answers 403 to a request that was
        # valid minutes ago. Re-resolve from the stable address and try once
        # more before treating it as a real failure.
        if response.status_code in (401, 403) and part.origin:
            part.url = self._resolve(part.origin)
            response = self._range_request(part, offset, size)

        response.raise_for_status()
        if response.status_code != 206:
            raise RangeUnsupported(
                f"{part.url} returned {response.status_code} for a Range request; "
                "selective extraction is not possible against this host"
            )
        return response.content

    def _range_request(self, part: RemotePart, offset: int, size: int):
        headers = dict(self._headers)
        headers["Range"] = f"bytes={offset}-{offset + size - 1}"
        return self._session.get(part.url, headers=headers, stream=True, timeout=60)

    def _resolve(self, origin: str) -> str:
        response = self._session.head(
            origin, headers=self._headers, allow_redirects=True, timeout=60
        )
        response.raise_for_status()
        return response.url


def part_sizes(
    urls: Iterable[str],
    *,
    session: requests.Session | None = None,
    headers: dict[str, str] | None = None,
) -> list[RemotePart]:
    """Size each part, following redirects, without downloading it."""
    session = session or requests.Session()
    parts: list[RemotePart] = []
    for url in urls:
        response = session.head(url, headers=headers, allow_redirects=True, timeout=60)
        response.raise_for_status()
        length = response.headers.get("Content-Length")
        if length is None:
            raise RangeUnsupported(f"{url} did not report Content-Length")
        # Keep the stable address alongside the resolved one so an expired
        # signature can be renewed rather than ending the run.
        parts.append(RemotePart(url=response.url, size=int(length), origin=url))
    return parts


def open_split_zip(
    urls: Sequence[str],
    *,
    session: requests.Session | None = None,
    headers: dict[str, str] | None = None,
    window: int = DEFAULT_WINDOW,
) -> zipfile.ZipFile:
    """A ZipFile over the joined parts, reading only what is asked for.

    `window` trades requests against bytes: larger fetches fewer times but
    over-reads around each seek. The default suits an archive of tens of
    gigabytes; a small archive wants a small window or it simply fetches the
    whole thing.
    """
    parts = part_sizes(urls, session=session, headers=headers)
    stream = SplitRemoteFile(parts, session=session, headers=headers, window=window)
    return zipfile.ZipFile(io.BufferedReader(stream, buffer_size=window))


def hf_urls(repo_id: str, filenames: Sequence[str], revision: str = "main") -> list[str]:
    """Resolve URLs for a gated Hugging Face dataset repo."""
    return [
        f"https://huggingface.co/datasets/{repo_id}/resolve/{revision}/{name}"
        for name in filenames
    ]
