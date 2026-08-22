import type { NmmType } from "../../shared/workflow";

export const BASELINE_RULE_VERSION = "baseline-v1";

export type ThresholdProfile = {
  ruleVersion: string;
  /** Minimum consecutive frames a condition must hold before it is a detection. */
  minFrames: number;
  values: Record<NmmType, number>;
  /** Minimum direction reversals for the headshake oscillation window. */
  headshakeMinReversals: number;
  /** Sliding window, in frames, used for the headshake oscillation test. */
  headshakeWindowFrames: number;
};

/**
 * Thresholds are configuration, not constants: the NDFN Linguistic Validation
 * Workshop retunes them without a code change, and every stored tag records the
 * profile that produced it. See design.md §5.3 and §5.4.
 */
export const thresholdProfiles: Record<string, ThresholdProfile> = {
  [BASELINE_RULE_VERSION]: {
    ruleVersion: BASELINE_RULE_VERSION,
    minFrames: 4,
    values: {
      // All values are fractions of shoulder width, past the signer's neutral.
      eyebrow_raise: 0.12,
      headshake: 0.15,
      shoulder_shrug: 0.15,
      forward_lean: 0.35,
      body_tilt: 0.12, // radians of shoulder-line rotation
    },
    headshakeMinReversals: 3,
    headshakeWindowFrames: 20,
  },
};

export function getThresholdProfile(ruleVersion = BASELINE_RULE_VERSION): ThresholdProfile {
  const profile = thresholdProfiles[ruleVersion];
  if (!profile) throw new Error(`Unknown NMM threshold profile: ${ruleVersion}`);
  return profile;
}
