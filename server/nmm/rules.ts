import type { LandmarkFrame } from "../../shared/landmarks";
import type { NmmType } from "../../shared/workflow";
import {
  FACE_BROW_LEFT,
  FACE_BROW_RIGHT,
  FACE_EAR_LEFT,
  FACE_EAR_RIGHT,
  FACE_EYE_LEFT,
  FACE_EYE_RIGHT,
  FACE_NOSE,
  POSE_HIP_LEFT,
  POSE_HIP_RIGHT,
  POSE_SHOULDER_LEFT,
  POSE_SHOULDER_RIGHT,
  distance2d,
  midpoint,
  type SignerBaseline,
} from "./baseline";
import { BASELINE_RULE_VERSION, getThresholdProfile, type ThresholdProfile } from "./thresholds";

export type NmmDetection = {
  type: NmmType;
  startFrame: number;
  endFrame: number;
  confidence: number;
  ruleVersion: string;
};

export type NmmRule = {
  type: NmmType;
  ruleVersion: string;
  /**
   * Per-frame signal, expressed as a fraction of the rule's threshold.
   * `>= 1` means the condition holds for that frame. `null` means the frame
   * lacks the landmarks this rule needs and must not count either way.
   */
  signal(frames: LandmarkFrame[], index: number, ctx: RuleContext): number | null;
};

type RuleContext = { baseline: SignerBaseline; profile: ThresholdProfile };

function shoulderWidthOf(frame: LandmarkFrame): number | null {
  if (!frame.pose) return null;
  const width = distance2d(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
  return width === 0 ? null : width;
}

const eyebrowRaise: NmmRule = {
  type: "eyebrow_raise",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.face || width === null) return null;
    const eyeMid = midpoint(frame.face[FACE_EYE_LEFT], frame.face[FACE_EYE_RIGHT]);
    const browMid = midpoint(frame.face[FACE_BROW_LEFT], frame.face[FACE_BROW_RIGHT]);
    const gap = (eyeMid.y - browMid.y) / width;
    return (gap - baseline.neutralBrowGap) / profile.values.eyebrow_raise;
  },
};

const shoulderShrug: NmmRule = {
  type: "shoulder_shrug",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.face || !frame.pose || width === null) return null;
    const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
    const earMid = midpoint(frame.face[FACE_EAR_LEFT], frame.face[FACE_EAR_RIGHT]);
    const gap = (shoulderMid.y - earMid.y) / width;
    // Compression: the gap shrinks as the shoulders rise toward the ears.
    return (baseline.neutralShoulderEarGap - gap) / profile.values.shoulder_shrug;
  },
};

const forwardLean: NmmRule = {
  type: "forward_lean",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const frame = frames[i];
    const width = shoulderWidthOf(frame);
    if (!frame.pose || width === null) return null;
    const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
    const hipMid = midpoint(frame.pose[POSE_HIP_LEFT], frame.pose[POSE_HIP_RIGHT]);
    const delta = (shoulderMid.z - hipMid.z) / width;
    // MediaPipe z decreases toward the camera, so leaning in is a negative delta.
    return (baseline.neutralDepthDelta - delta) / profile.values.forward_lean;
  },
};

const bodyTilt: NmmRule = {
  type: "body_tilt",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { profile }) {
    const frame = frames[i];
    if (!frame.pose) return null;
    const left = frame.pose[POSE_SHOULDER_LEFT];
    const right = frame.pose[POSE_SHOULDER_RIGHT];
    const angle = Math.abs(Math.atan2(right.y - left.y, right.x - left.x));
    return angle / profile.values.body_tilt;
  },
};

const headshake: NmmRule = {
  type: "headshake",
  ruleVersion: BASELINE_RULE_VERSION,
  signal(frames, i, { baseline, profile }) {
    const half = Math.floor(profile.headshakeWindowFrames / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(frames.length, i + half);
    const offsets: number[] = [];

    for (let k = start; k < end; k += 1) {
      const frame = frames[k];
      const width = shoulderWidthOf(frame);
      if (!frame.face || !frame.pose || width === null) continue;
      const shoulderMid = midpoint(frame.pose[POSE_SHOULDER_LEFT], frame.pose[POSE_SHOULDER_RIGHT]);
      offsets.push((frame.face[FACE_NOSE].x - shoulderMid.x) / width - baseline.neutralNoseOffset);
    }

    if (offsets.length < 4) return null;

    let reversals = 0;
    let peak = 0;
    let direction = 0;
    for (let k = 1; k < offsets.length; k += 1) {
      const step = offsets[k] - offsets[k - 1];
      if (Math.abs(step) < 1e-6) continue;
      const next = step > 0 ? 1 : -1;
      if (direction !== 0 && next !== direction) reversals += 1;
      direction = next;
      peak = Math.max(peak, Math.abs(offsets[k]));
    }

    if (reversals < profile.headshakeMinReversals) return 0;
    return peak / profile.values.headshake;
  },
};

export const nmmRules: NmmRule[] = [eyebrowRaise, headshake, shoulderShrug, forwardLean, bodyTilt];

/**
 * Maps a peak signal (1 = exactly at threshold) onto (0.5, 1) without ever
 * reaching 1. A hard-saturating score would record an emphatic marker and a
 * marginal one identically, discarding the very signal strength the corpus is
 * meant to preserve. Soft saturation keeps them ordered at every magnitude.
 */
export function confidenceFor(peakSignal: number): number {
  if (peakSignal <= 1) return 0.5;
  return 0.5 + 0.5 * (1 - Math.exp(-(peakSignal - 1)));
}

/**
 * Runs every rule over the sequence and collapses each rule's above-threshold
 * runs into detections. Pure: no I/O, no device, no model.
 */
export function detectNmms(
  frames: LandmarkFrame[],
  options: { baseline: SignerBaseline; ruleVersion?: string },
): NmmDetection[] {
  const profile = getThresholdProfile(options.ruleVersion);
  const ctx: RuleContext = { baseline: options.baseline, profile };
  const detections: NmmDetection[] = [];

  for (const rule of nmmRules) {
    let runStart: number | null = null;
    let runPeak = 0;

    const closeRun = (endExclusive: number) => {
      if (runStart === null) return;
      if (endExclusive - runStart >= profile.minFrames) {
        detections.push({
          type: rule.type,
          startFrame: runStart,
          endFrame: endExclusive - 1,
          confidence: confidenceFor(runPeak),
          ruleVersion: rule.ruleVersion,
        });
      }
      runStart = null;
      runPeak = 0;
    };

    for (let i = 0; i < frames.length; i += 1) {
      const signal = rule.signal(frames, i, ctx);
      if (signal === null || signal < 1) {
        closeRun(i);
        continue;
      }
      if (runStart === null) runStart = i;
      runPeak = Math.max(runPeak, signal);
    }
    closeRun(frames.length);
  }

  return detections.sort((a, b) => a.startFrame - b.startFrame);
}
