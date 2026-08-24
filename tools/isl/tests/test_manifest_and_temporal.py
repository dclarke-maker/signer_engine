"""Resumability, and the temporal step that is deliberately outside the contract."""

from __future__ import annotations

import numpy as np
import pytest

from tools.isl.contract import STREAM_ORDER
from tools.isl.manifest import Entry, Manifest
from tools.isl.temporal import (
    DEFAULT_TARGET_FPS,
    effective_fps,
    motion_preserved,
    nearest_indices,
    resample,
    target_timestamps,
)
from tools.isl.tests.test_contract import make_sequence


class TestManifest:
    def test_a_second_run_over_the_same_selection_does_nothing(self, tmp_path):
        # The stated acceptance test for resumability: re-running processes zero
        # clips rather than redoing work after a Colab disconnect.
        manifest = Manifest(tmp_path / "manifest.jsonl")
        uids = ["a", "b", "c"]
        for uid in uids:
            manifest.record_done(uid, f"/drive/{uid}.npz")

        reopened = Manifest(tmp_path / "manifest.jsonl")
        assert reopened.pending(uids) == []

    def test_state_survives_reopening(self, tmp_path):
        path = tmp_path / "manifest.jsonl"
        Manifest(path).record_done("a", "/drive/a.npz", {"frames": 120})

        reopened = Manifest(path)
        assert "a" in reopened
        assert reopened.get("a").detail["frames"] == 120

    def test_a_half_written_final_line_does_not_lose_the_rest(self, tmp_path):
        # What a killed session leaves behind.
        path = tmp_path / "manifest.jsonl"
        manifest = Manifest(path)
        manifest.record_done("a", "/drive/a.npz")
        manifest.record_done("b", "/drive/b.npz")
        with open(path, "a", encoding="utf8") as handle:
            handle.write('{"uid": "c", "stat')

        reopened = Manifest(path)
        assert sorted(reopened.done()) == ["a", "b"]

    def test_failures_are_recorded_with_a_reason_and_not_silently_retried(self, tmp_path):
        manifest = Manifest(tmp_path / "manifest.jsonl")
        manifest.record_failed("bad", "unreadable codec: h265 in a container we cannot open")

        # A structural failure repeats every run; retrying it by default would
        # bury the signal in the throughput numbers.
        assert manifest.pending(["bad"]) == []
        assert manifest.pending(["bad"], retry_failed=True) == ["bad"]
        assert "unreadable codec" in manifest.failed()[0].error

    def test_records_a_measurement_that_carries_its_own_uid(self, tmp_path):
        # The real caller hands over ExtractionReport.as_dict(), which has a
        # `uid` field of its own. Splatting that into **kwargs collided with the
        # method's own parameter and raised TypeError - after the clip had been
        # processed and its .npz written, so the work was done and only the
        # bookkeeping failed. Detail is a dict for exactly this reason.
        manifest = Manifest(tmp_path / "manifest.jsonl")
        measurement = {
            "uid": "clip-1",          # collides with the uid parameter
            "path": "/elsewhere.npz",  # and with path
            "status": "whatever",      # and with status
            "frame_count": 342,
            "source_fps": 25.0,
        }

        manifest.record_done("clip-1", "/drive/clip-1.npz", measurement)

        entry = Manifest(tmp_path / "manifest.jsonl").get("clip-1")
        assert entry.status == "done"
        assert entry.path == "/drive/clip-1.npz"
        assert entry.detail["frame_count"] == 342

    def test_records_a_failure_detail_that_carries_its_own_uid(self, tmp_path):
        manifest = Manifest(tmp_path / "manifest.jsonl")
        manifest.record_failed("clip-2", "RuntimeError: no frames", {"uid": "other", "source": "ISH"})

        entry = manifest.get("clip-2")
        assert entry.status == "failed"
        assert entry.detail["source"] == "ISH"

    def test_summary_groups_failures_by_reason(self, tmp_path):
        manifest = Manifest(tmp_path / "manifest.jsonl")
        manifest.record_done("a", "x")
        manifest.record_failed("b", "unreadable codec: foo")
        manifest.record_failed("c", "unreadable codec: bar")

        summary = manifest.summary()
        assert summary == {
            "total": 3,
            "done": 1,
            "failed": 2,
            "failure_reasons": {"unreadable codec": 2},
        }

    def test_compaction_keeps_the_latest_entry_per_uid(self, tmp_path):
        path = tmp_path / "manifest.jsonl"
        manifest = Manifest(path)
        manifest.record_failed("a", "transient")
        manifest.record_done("a", "/drive/a.npz")
        manifest.compact()

        reopened = Manifest(path)
        assert len(reopened) == 1
        assert reopened.get("a").status == "done"


class TestTemporal:
    def test_effective_fps_counts_intervals(self):
        # 25fps: 5 frames, 40ms apart, span 160ms.
        assert effective_fps(np.arange(5) * 40.0) == pytest.approx(25.0)

    def test_effective_fps_of_a_single_frame_is_zero_not_infinite(self):
        assert effective_fps([0.0]) == 0.0

    def test_downsampling_25_to_20_keeps_real_frames_only(self):
        sequence = make_sequence(frames=25)  # 40ms spacing, 25fps
        sequence.t_ms = (np.arange(25) * 40.0).astype(np.float32)

        out, report = resample(sequence, DEFAULT_TARGET_FPS)

        assert report.source_fps == pytest.approx(25.0)
        assert report.frames_after < report.frames_before
        assert not report.below_target
        # Every landmark in the result was observed; nothing is interpolated.
        for i in range(out.frame_count):
            assert any(
                np.array_equal(out.pose[i], sequence.pose[j]) for j in range(sequence.frame_count)
            )

    def test_a_clip_slower_than_the_target_reports_duplication(self):
        sequence = make_sequence(frames=6)
        sequence.t_ms = (np.arange(6) * 100.0).astype(np.float32)  # 10fps

        _, report = resample(sequence, DEFAULT_TARGET_FPS)

        assert report.below_target
        # Upsampling cannot create motion that was not recorded; saying so is
        # the point, rather than letting repeats pass as real movement.
        assert report.duplicated_frames > 0

    def test_the_target_rate_is_configurable(self):
        sequence = make_sequence(frames=25)
        sequence.t_ms = (np.arange(25) * 40.0).astype(np.float32)

        at_20 = resample(sequence, 20.0)[1].frames_after
        at_10 = resample(sequence, 10.0)[1].frames_after
        assert at_10 < at_20

    def test_nearest_picks_the_closer_frame(self):
        t = np.array([0.0, 40.0, 80.0])
        assert list(nearest_indices(t, np.array([0.0, 30.0, 45.0, 80.0]))) == [0, 1, 1, 2]

    def test_target_timestamps_start_at_zero_and_stay_inside_the_clip(self):
        stamps = target_timestamps(200.0, 20.0)
        assert stamps[0] == 0.0
        assert stamps[-1] <= 200.0

    def test_motion_report_shows_what_resampling_costs(self):
        sequence = make_sequence(frames=25)
        sequence.t_ms = (np.arange(25) * 40.0).astype(np.float32)
        out, _ = resample(sequence, DEFAULT_TARGET_FPS)

        stats = motion_preserved(sequence, out)
        # Fingerspelling and fast transitions are where sign languages carry
        # information, so this number has to be looked at, not assumed.
        assert 0.0 <= stats["path_retained"] <= 2.0
        assert set(stats) >= {"mean_step_before", "mean_step_after", "path_retained"}

    def test_resampling_leaves_stream_order_alone(self):
        sequence = make_sequence(frames=25)
        sequence.t_ms = (np.arange(25) * 40.0).astype(np.float32)
        out, _ = resample(sequence, DEFAULT_TARGET_FPS)

        assert out.present.shape[1] == len(STREAM_ORDER)
        assert out.face.shape[1] == sequence.face.shape[1]
