import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { LandmarkCamera } from "@/components/landmark-camera";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { createFramingGate } from "@/lib/capture/framing";
import {
  createRestDetector,
  type StopReason,
} from "@/lib/capture/rest-detector";
import { TARGET_FPS, getExtractor } from "@/lib/extractors";
import { formatElapsed } from "@/lib/format-elapsed";
import { trpc } from "@/lib/trpc";
import { uploadSequence } from "@/lib/upload-sequence";
import {
  BLOCK_SIZE,
  COUNTDOWN_MS,
  HANDOVER_MS,
} from "@/shared/capture-session";
import type { CorpusCategory } from "@/shared/corpus";
import type {
  LandmarkFrame,
  LandmarkSequencePayload,
} from "@/shared/landmarks";

type Prompt = {
  id: string;
  category: CorpusCategory;
  textEnglish: string;
  textNepali: string;
};

type Coverage = {
  leftHand: number;
  rightHand: number;
  face: number;
  pose: number;
};

type ItemStatus = "waiting" | "recording" | "uploading" | "done" | "failed";

type Item = {
  prompt: Prompt;
  status: ItemStatus;
  frameCount?: number;
  durationMs?: number;
  coverage?: Coverage;
  stopReason?: StopReason | "manual";
  error?: string;
};

/**
 * How many failed uploads may accumulate before the block is cut short.
 *
 * A failed upload has to keep its landmark payload in memory to be retried, and
 * one sentence is several megabytes. If the network is down, recording the rest
 * of the block produces nothing that can be sent and risks exhausting memory on
 * a mid-range phone, so it stops and says so instead.
 */
const MAX_HELD_FAILURES = 2;

type Phase =
  | "warming"
  | "framing"
  | "countdown"
  | "recording"
  | "saved"
  | "review";

export default function CaptureBlockScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const utils = trpc.useUtils();
  const [explicitIds, setExplicitIds] = useState<string[] | null>(null);
  const blockQuery = trpc.capture.block.useQuery(
    { size: BLOCK_SIZE, ...(explicitIds ? { promptIds: explicitIds } : {}) },
    // A background refetch that replaced the sentence list mid-block would
    // swap the prompt out from under a signer already recording it.
    { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
  );
  const startSession = trpc.capture.startSession.useMutation();

  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("warming");
  const [previewLive, setPreviewLive] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(Math.ceil(COUNTDOWN_MS / 1000));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [framingProgress, setFramingProgress] = useState(0);
  const [redo, setRedo] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const extractorRef = useRef(getExtractor());
  const framesRef = useRef<LandmarkFrame[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const heldFailuresRef = useRef(0);

  const current = items[index]?.prompt;
  const total = items.length;

  useEffect(() => {
    if (!blockQuery.data) return;
    // Only between blocks. `items` is emptied on restart, which is what holds
    // the framing transition until the replacement block has actually arrived.
    if (phase !== "warming") return;
    setItems(
      blockQuery.data.prompts.map((p) => ({
        prompt: {
          id: p.id,
          category: p.category,
          textEnglish: p.textEnglish,
          textNepali: p.textNepali,
        },
        status: "waiting" as const,
      })),
    );
  }, [blockQuery.data, phase]);

  const patch = useCallback((at: number, change: Partial<Item>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === at ? { ...item, ...change } : item)),
    );
  }, []);

  const handleUnavailable = useCallback(
    (reason: string) => setBlocked(reason),
    [],
  );
  const handlePreviewState = useCallback(
    (streaming: boolean) => setPreviewLive(streaming),
    [],
  );

  // The camera opens once for the whole block rather than once per sentence,
  // which is the single largest saving here: the one to two second warm-up that
  // used to sit in front of every capture now happens ten times less often.
  useEffect(() => {
    if (phase === "warming" && previewLive && total > 0) setPhase("framing");
  }, [phase, previewLive, total]);

  // -- framing: hold until the signer is actually back in shot ---------------

  useEffect(() => {
    if (phase !== "framing" || blocked) return;
    const extractor = extractorRef.current;
    const gate = createFramingGate();
    let cancelled = false;

    void extractor.start({ targetFps: TARGET_FPS }).then(() => {
      if (cancelled) return;
      extractor.subscribe((frame) => {
        if (cancelled) return;
        const open = gate.accept(frame);
        setFramingProgress(gate.progress);
        if (open) {
          cancelled = true;
          void extractor.stop().then(() => setPhase("countdown"));
        }
      });
    });

    return () => {
      cancelled = true;
      void extractor.stop();
    };
  }, [phase, index, blocked]);

  // -- countdown, with the session row opened alongside it -------------------

  useEffect(() => {
    if (phase !== "countdown" || !current) return;
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000));
    sessionIdRef.current = null;
    let cancelled = false;

    const opened = startSession
      .mutateAsync({ promptId: current.id })
      .then((session) => {
        if (!cancelled) sessionIdRef.current = session.id;
      })
      .catch(() => {
        if (!cancelled)
          setNotice("The session could not be started. Stopping this block.");
      });

    const tick = setInterval(
      () => setCountdown((n) => Math.max(0, n - 1)),
      1000,
    );
    const done = setTimeout(() => {
      void opened.then(() => {
        if (cancelled) return;
        // The count is over but the row may not exist yet. Recording without
        // one would produce landmarks with nowhere to be stored, so the count
        // holds at zero rather than starting a capture that cannot be saved.
        if (sessionIdRef.current) setPhase("recording");
        else setPhase("review");
      });
    }, COUNTDOWN_MS);

    return () => {
      cancelled = true;
      clearInterval(tick);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, current?.id]);

  // -- recording, ended by the signer coming to rest -------------------------

  const finish = useCallback(
    async (reason: StopReason | "manual") => {
      const extractor = extractorRef.current;
      const at = index;
      const sessionId = sessionIdRef.current;
      const frames = framesRef.current;
      framesRef.current = [];

      const summary = await extractor.stop();
      if (Platform.OS !== "web")
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );

      patch(at, {
        status: "uploading",
        frameCount: summary.frameCount,
        durationMs: summary.durationMs,
        coverage: summary.coverage,
        stopReason: reason,
      });
      setPhase("saved");

      if (!sessionId || frames.length === 0) {
        patch(at, {
          status: "failed",
          error: "Nothing was captured for this sentence.",
        });
        return;
      }

      const payload: LandmarkSequencePayload = {
        schemaVersion: 1,
        sessionId,
        promptId: items[at].prompt.id,
        category: items[at].prompt.category,
        extractorId: extractor.id,
        targetFps: TARGET_FPS,
        achievedFps: summary.achievedFps,
        frameCount: summary.frameCount,
        durationMs: summary.durationMs,
        frames,
      };

      // Deliberately not awaited. Several megabytes over a Kathmandu connection
      // is seconds the signer would otherwise spend standing still watching a
      // spinner; the next countdown runs while it goes. Failures surface at the
      // block review, where there is someone standing at the phone to see them.
      uploadSequence(payload)
        .then(() => patch(at, { status: "done" }))
        .catch((error: unknown) => {
          heldFailuresRef.current += 1;
          patch(at, {
            status: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
          if (heldFailuresRef.current >= MAX_HELD_FAILURES) {
            setNotice(
              "Uploads are failing. Check the connection before recording more.",
            );
            setPhase("review");
          }
        });
    },
    [index, items, patch],
  );

  useEffect(() => {
    if (phase !== "recording") return;
    const extractor = extractorRef.current;
    const detector = createRestDetector();
    framesRef.current = [];
    setElapsedMs(0);
    let stopping = false;

    void extractor.start({ targetFps: TARGET_FPS }).then(() => {
      if (stopping) return;
      if (Platform.OS !== "web")
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      extractor.subscribe((frame) => {
        if (stopping) return;
        framesRef.current.push(frame);
        setElapsedMs(frame.t);
        const verdict = detector.accept(frame);
        if (verdict.stop && verdict.reason) {
          stopping = true;
          void finish(verdict.reason);
        }
      });
    });

    return () => {
      stopping = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  // -- handover to the next sentence ----------------------------------------

  useEffect(() => {
    if (phase !== "saved") return;
    const id = setTimeout(() => {
      if (index + 1 >= total) setPhase("review");
      else {
        setIndex((n) => n + 1);
        setPhase("framing");
      }
    }, HANDOVER_MS);
    return () => clearTimeout(id);
  }, [phase, index, total]);

  useEffect(() => {
    if (phase === "review") void utils.capture.progress.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const leave = useCallback(() => {
    void extractorRef.current.stop();
    router.replace("/prompt-session");
  }, []);

  /**
   * Starts a fresh block in place rather than by navigating.
   *
   * Re-entering the route would remount the camera and pay the warm-up again,
   * which is the cost session mode exists to avoid. Emptying `items` first is
   * what stops the framing effect from running the new block against the old
   * sentence list before the replacement arrives.
   */
  const restart = useCallback(
    async (promptIds: string[] | null) => {
      setItems([]);
      setIndex(0);
      setRedo(new Set());
      setNotice(null);
      heldFailuresRef.current = 0;
      setPhase("warming");
      setExplicitIds(promptIds);
      if (promptIds === null) {
        // Same query input as the block just finished, so nothing would refetch
        // on its own - but those sentences are now recorded and the server will
        // answer with the next ten.
        await utils.capture.block.invalidate();
      }
    },
    [utils],
  );

  if (!permission?.granted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.permission}>
          <Text style={styles.permissionTitle}>Camera access</Text>
          <Text style={styles.permissionText}>
            SignBridge reads motion points from the camera. No video is recorded
            or saved — camera images stay on this device and are discarded
            immediately.
          </Text>
          <Pressable onPress={requestPermission} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (phase === "review") {
    return (
      <BlockReview
        items={items}
        notice={notice}
        redo={redo}
        busy={blockQuery.isFetching}
        corpusFinished={blockQuery.data?.prompts.length === 0}
        onToggleRedo={(id) =>
          setRedo((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onRecordAgain={() => void restart([...redo])}
        onNextBlock={() => void restart(null)}
        onDone={leave}
      />
    );
  }

  return (
    <View style={styles.fullScreen}>
      <LandmarkCamera
        extractor={extractorRef.current}
        active={phase === "framing" || phase === "recording"}
        onUnavailable={handleUnavailable}
        onPreviewStateChange={handlePreviewState}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.scrim,
          phase === "recording" && styles.scrimRecording,
        ]}
        pointerEvents="none"
      />
      <ScreenContainer
        edges={["top", "bottom", "left", "right"]}
        containerClassName="bg-transparent"
        safeAreaClassName="bg-transparent"
        pointerEvents="none"
      >
        <View style={styles.overlay}>
          <View style={styles.header}>
            <View style={styles.topBar}>
              <View style={styles.exitSpacer} />
              <Text style={styles.blockCounter}>
                {Math.min(index + 1, total)} of {total} in this block
              </Text>
              <View style={styles.exitSpacer} />
            </View>

            {current ? (
              <View style={styles.promptBlock}>
                <Text style={styles.promptNepali}>{current.textNepali}</Text>
                <Text style={styles.promptEnglish}>{current.textEnglish}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.stage}>
            {blocked ? (
              <Text style={styles.stageNote}>{blocked}</Text>
            ) : phase === "warming" ? (
              <Text style={styles.stageNote}>Opening the camera…</Text>
            ) : phase === "framing" ? (
              <>
                <Text style={styles.stageBig}>Step into frame</Text>
                <Text style={styles.stageNote}>
                  The count starts on its own once your head and shoulders are
                  in view.
                </Text>
                <View style={styles.framingTrack}>
                  <View
                    style={[
                      styles.framingFill,
                      { width: `${framingProgress * 100}%` },
                    ]}
                  />
                </View>
              </>
            ) : phase === "countdown" ? (
              <Text style={styles.countdown}>
                {countdown > 0 ? countdown : "•"}
              </Text>
            ) : phase === "recording" ? (
              <>
                <View style={styles.recordingDot} />
                <Text style={styles.stageBig}>{formatElapsed(elapsedMs)}</Text>
                <Text style={styles.stageNote}>
                  Sign the sentence. Lower your hands when you finish — it stops
                  on its own.
                </Text>
              </>
            ) : (
              <Text style={styles.saved}>✓ Saved</Text>
            )}
          </View>
        </View>
      </ScreenContainer>

      {/* Above the visual overlay: during recording the whole screen is a stop
          target, so a signer who does walk up can end a sentence without
          hunting for a small button. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        disabled={phase !== "recording"}
        onPress={() => void finish("manual")}
      />

      {/* Above the stop target, so leaving stays possible mid-recording. */}
      <SafeAreaView style={styles.exitLayer} pointerEvents="box-none">
        <Pressable onPress={leave} style={styles.exitButton}>
          <Text style={styles.exitButtonText}>×</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

function BlockReview({
  items,
  notice,
  redo,
  busy,
  corpusFinished,
  onToggleRedo,
  onRecordAgain,
  onNextBlock,
  onDone,
}: {
  items: Item[];
  notice: string | null;
  redo: Set<string>;
  busy: boolean;
  corpusFinished: boolean;
  onToggleRedo: (id: string) => void;
  onRecordAgain: () => void;
  onNextBlock: () => void;
  onDone: () => void;
}) {
  const weakest = (item: Item) =>
    item.coverage
      ? Math.min(
          item.coverage.leftHand,
          item.coverage.rightHand,
          item.coverage.pose,
        )
      : 0;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.reviewWrap}>
        <ScrollView contentContainerStyle={styles.reviewContent}>
          <Text style={styles.reviewTitle}>Block finished</Text>
          <Text style={styles.reviewSubtitle}>
            {items.filter((i) => i.status === "done").length} of {items.length}{" "}
            sentences sent. Mark any that look wrong and record them again.
          </Text>
          {notice ? <Text style={styles.reviewNotice}>{notice}</Text> : null}

          {items.map((item) => {
            const low = weakest(item) < 0.5;
            const marked = redo.has(item.prompt.id);
            return (
              <Pressable
                key={item.prompt.id}
                onPress={() => onToggleRedo(item.prompt.id)}
                style={[styles.reviewRow, marked && styles.reviewRowMarked]}
              >
                <Text style={styles.reviewRowText}>
                  {item.prompt.textNepali}
                </Text>
                <Text style={styles.reviewRowMeta}>
                  {item.status === "failed"
                    ? (item.error ?? "Not sent")
                    : item.status === "uploading"
                      ? "Sending…"
                      : `${item.frameCount ?? 0} frames · ${Math.round(weakest(item) * 100)}% in frame${
                          item.stopReason === "max-duration"
                            ? " · reached the time limit"
                            : ""
                        }`}
                </Text>
                {low && item.status !== "failed" ? (
                  <Text style={styles.reviewRowWarn}>
                    Part of you drifted out of the frame
                  </Text>
                ) : null}
                <Text style={styles.reviewRowAction}>
                  {marked ? "✓ Will record again" : "Tap to record again"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.reviewActions}>
          {redo.size > 0 ? (
            <Pressable
              disabled={busy}
              onPress={onRecordAgain}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                Record {redo.size} again
              </Text>
            </Pressable>
          ) : null}
          {corpusFinished ? (
            <Text style={styles.reviewSubtitle}>
              That was the last sentence. Thank you — there is nothing left to
              record.
            </Text>
          ) : (
            <Pressable
              disabled={busy}
              onPress={onNextBlock}
              style={
                redo.size > 0 ? styles.secondaryButton : styles.primaryButton
              }
            >
              <Text
                style={
                  redo.size > 0
                    ? styles.secondaryButtonText
                    : styles.primaryButtonText
                }
              >
                Next {BLOCK_SIZE} sentences
              </Text>
            </Pressable>
          )}
          <Pressable onPress={onDone} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Done for now</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: "#000000" },
  scrim: { backgroundColor: "rgba(16,42,67,0.35)" },
  exitLayer: { position: "absolute", top: 0, left: 0, padding: 20 },
  scrimRecording: { borderWidth: 6, borderColor: "#E12D39" },
  overlay: { flex: 1, justifyContent: "space-between", padding: 20 },
  header: { gap: 18 },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  exitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  exitButtonText: { color: "#FFFFFF", fontSize: 26, lineHeight: 30 },
  exitSpacer: { width: 44 },
  blockCounter: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },

  // Sized to be read from about 1.5m, which is where the signer has to stand
  // for both extended arms to stay in frame.
  promptBlock: { gap: 8, paddingHorizontal: 4 },
  promptNepali: {
    color: "#FFFFFF",
    fontSize: 38,
    lineHeight: 54,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 8,
  },
  promptEnglish: {
    color: "#E6EEF5",
    fontSize: 20,
    lineHeight: 28,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },

  stage: { alignItems: "center", gap: 12, paddingBottom: 12 },
  stageBig: { color: "#FFFFFF", fontSize: 40, fontWeight: "700" },
  stageNote: {
    color: "#E6EEF5",
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  countdown: {
    color: "#FFFFFF",
    fontSize: 132,
    lineHeight: 148,
    fontWeight: "800",
  },
  saved: { color: "#3EBD93", fontSize: 46, fontWeight: "800" },
  recordingDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#E12D39",
  },
  framingTrack: {
    width: "70%",
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  framingFill: { height: 8, backgroundColor: "#FFFFFF" },

  reviewWrap: { flex: 1 },
  reviewContent: { padding: 20, gap: 12 },
  reviewTitle: { color: "#102A43", fontSize: 28, fontWeight: "700" },
  reviewSubtitle: { color: "#486581", fontSize: 15, lineHeight: 22 },
  reviewNotice: {
    color: "#AB091E",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  reviewRow: {
    borderRadius: 18,
    padding: 16,
    gap: 6,
    backgroundColor: "#F0F4F8",
    borderWidth: 2,
    borderColor: "transparent",
  },
  reviewRowMarked: { borderColor: "#2186EB", backgroundColor: "#E6F6FF" },
  reviewRowText: { color: "#102A43", fontSize: 18, fontWeight: "600" },
  reviewRowMeta: { color: "#627D98", fontSize: 14 },
  reviewRowWarn: { color: "#AB091E", fontSize: 14, fontWeight: "600" },
  reviewRowAction: { color: "#2186EB", fontSize: 14, fontWeight: "700" },
  reviewActions: { padding: 20, gap: 12 },

  permission: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  permissionTitle: { color: "#102A43", fontSize: 26, fontWeight: "700" },
  permissionText: { color: "#486581", fontSize: 15, lineHeight: 22 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: "#102A43",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { color: "#486581", fontSize: 16, fontWeight: "600" },
});
