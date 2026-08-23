package com.app.signlanguagemobile.holistic

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarker
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarkerResult
import android.media.Image
import android.os.SystemClock
import android.util.Base64
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.core.types.Orientation
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Runs MediaPipe HolisticLandmarker over each camera frame and returns one
 * packed Float32 buffer, base64-encoded.
 *
 * The layout is specified and unit-tested in `lib/extractors/holistic-buffer.ts`,
 * which is the authority for this encoding:
 *   [0]     schema version (1)
 *   [1]     timestamp ms, from this plugin's first frame. The plugin is
 *           reused across captures, so the JS extractor rebases it.
 *   [2..5]  face / pose / leftHand / rightHand counts, 0 when undetected
 *   [6]     frame aspect, width / height, measured after rotation
 *   then    each stream in that order, four floats per landmark: x, y, z, visibility
 *
 * A packed buffer is used rather than a map because a holistic result is ~543
 * landmarks; bridging that as nested objects every frame would dominate the
 * frame budget.
 *
 * It is returned as base64 rather than a SharedArray because the result is
 * handed to JS through Worklets.createRunOnJS, whose shared-value converter
 * rejects ArrayBuffers and wraps arrays element by element. A string crosses
 * as one copy. Bytes are little-endian, matching the reader.
 *
 * Nothing here retains, encodes, or writes a frame.
 */
class HolisticFrameProcessorPlugin(
  private val proxy: VisionCameraProxy,
  options: Map<String, Any>?,
) : FrameProcessorPlugin() {

  private companion object {
    const val TAG = "HolisticPlugin"
    const val SCHEMA_VERSION = 2f
    const val HEADER_FLOATS = 7
    const val FLOATS_PER_LANDMARK = 4
    const val BYTES_PER_FLOAT = 4
    const val MODEL_ASSET = "holistic_landmarker.task"
    const val BYTES_PER_PIXEL = 4
  }

  /**
   * GPU delegation is faster but not universally available - drivers vary, and
   * devices outside the mainstream Android ecosystem (Huawei/Kirin, HarmonyOS)
   * are the likeliest to reject it. A failed delegate would leave the
   * landmarker null and every frame silently returning nothing, so CPU is tried
   * before giving up, and whichever succeeded is logged.
   */
  private val landmarker: HolisticLandmarker? = createLandmarker(proxy)

  private fun createLandmarker(proxy: VisionCameraProxy): HolisticLandmarker? {
    for (delegate in listOf(Delegate.GPU, Delegate.CPU)) {
      try {
        val base = BaseOptions.builder()
          .setModelAssetPath(MODEL_ASSET)
          .setDelegate(delegate)
          .build()
        val opts = HolisticLandmarker.HolisticLandmarkerOptions.builder()
          .setBaseOptions(base)
          .setRunningMode(RunningMode.VIDEO)
          // Not part of this pipeline, and both cost time on every frame.
          .setOutputFaceBlendshapes(false)
          .setOutputPoseSegmentationMasks(false)
          .build()
        val created = HolisticLandmarker.createFromOptions(proxy.context, opts)
        Log.i(TAG, "HolisticLandmarker ready on $delegate")
        return created
      } catch (e: Throwable) {
        Log.w(TAG, "HolisticLandmarker could not start on $delegate", e)
      }
    }
    Log.e(
      TAG,
      "HolisticLandmarker failed on every delegate. Captures will contain no frames.",
    )
    return null
  }

  /**
   * Milliseconds from a monotonic clock.
   *
   * Deliberately not Frame.timestamp: that is nanoseconds on Android
   * (CameraX ImageInfo) but milliseconds on iOS (CMTime presentation time), so
   * a frame stamped with it means different things on the two platforms and
   * the duration and fps derived from it are wrong by a factor of a million on
   * one of them. MediaPipe also requires strictly increasing timestamps, hence
   * the guard.
   *
   * Measured from this plugin's first frame rather than from boot: the value is
   * carried in the buffer as a float32, which represents integers exactly only
   * up to 2^24 - about 4.6 hours of milliseconds. A device that has been awake
   * longer than that would start quantising its frame times.
   */
  private var baseTimestampMs = -1L
  private var lastTimestampMs = -1L

  /**
   * Frames seen, used only to rate-limit the diagnostic log below. Landmark
   * counts are the fastest way to tell a framing problem from a broken frame -
   * a pose but no face means the image reached MediaPipe the wrong way up.
   */
  private var framesSeen = 0L

  /** Width / height of the last upright bitmap; travels in the packed header. */
  private var uprightAspect = 1f

  private fun nextTimestampMs(): Long {
    val now = SystemClock.elapsedRealtime()
    if (baseTimestampMs < 0) baseTimestampMs = now
    val elapsed = now - baseTimestampMs
    lastTimestampMs = if (elapsed > lastTimestampMs) elapsed else lastTimestampMs + 1
    return lastTimestampMs
  }

  override fun callback(frame: Frame, arguments: Map<String, Any>?): Any? {
    val detector = landmarker ?: return null
    val timestampMs = nextTimestampMs()

    val result: HolisticLandmarkerResult = try {
      // frame.imageProxy is a CameraX type this module does not have on its
      // compile classpath, and ImageProxy.toBitmap() is not available in every
      // CameraX version. frame.image is android.media.Image - a framework class
      // - so it needs no extra dependency. The camera is configured for RGBA
      // output (pixelFormat="rgb" in LandmarkCamera), so plane 0 can be copied
      // straight into a bitmap without a YUV conversion.
      val bitmap = frame.image.toArgbBitmap(frame.uprightRotationDegrees()) ?: return null
      // Measured on the upright bitmap, not the sensor frame: rotating swaps
      // width and height, and the landmarks are normalised against this one.
      uprightAspect = bitmap.width.toFloat() / bitmap.height.toFloat()
      detector.detectForVideo(BitmapImageBuilder(bitmap).build(), timestampMs)
    } catch (e: Throwable) {
      Log.w(TAG, "holistic detection failed for one frame", e)
      return null
    }

    val streams = listOf(
      result.faceLandmarks(),
      result.poseLandmarks(),
      result.leftHandLandmarks(),
      result.rightHandLandmarks(),
    )

    framesSeen += 1
    if (framesSeen == 1L || framesSeen % 30 == 0L) {
      Log.i(
        TAG,
        "frame $framesSeen: ${frame.image.width}x${frame.image.height} " +
          "rot=${frame.uprightRotationDegrees()} aspect=$uprightAspect " +
          "mirrored=${frame.isMirrored} " +
          "face=${streams[0].size} pose=${streams[1].size} " +
          "left=${streams[2].size} right=${streams[3].size}",
      )
    }

    val totalFloats = HEADER_FLOATS + streams.sumOf { it.size } * FLOATS_PER_LANDMARK
    val byteCount = totalFloats * BYTES_PER_FLOAT

    val bytes = ByteArray(byteCount)
    val buffer: ByteBuffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val floats = buffer.asFloatBuffer()

    floats.put(0, SCHEMA_VERSION)
    floats.put(1, timestampMs.toFloat())
    streams.forEachIndexed { i, stream -> floats.put(2 + i, stream.size.toFloat()) }
    floats.put(6, uprightAspect)

    var offset = HEADER_FLOATS
    for (stream in streams) {
      for (point in stream) {
        floats.put(offset, point.x())
        floats.put(offset + 1, point.y())
        floats.put(offset + 2, point.z())
        floats.put(offset + 3, point.visibility().orElse(1f))
        offset += FLOATS_PER_LANDMARK
      }
    }

    // NO_WRAP: the default inserts newlines, which would inflate every frame
    // and force the reader to strip them.
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  /**
   * How far the sensor image must be turned to stand upright.
   *
   * A phone's sensor is mounted at an angle to the display, so a frame captured
   * while holding the device in portrait arrives on its side. MediaPipe is not
   * rotation invariant: it locates a pose first and then crops the face and
   * hand regions from it, so a sideways frame yields a pose of some kind and
   * then no face and no hands at all - which is what this pipeline produced
   * before the rotation was applied.
   *
   * Frame.orientation is derived from CameraX's rotationDegrees and then
   * reversed, so reversing it again recovers the original bucket. The raw value
   * is not read from frame.imageProxy because that is a CameraX type this
   * module does not have on its compile classpath.
   */
  private fun Frame.uprightRotationDegrees(): Int =
    when (orientation.reversed()) {
      Orientation.PORTRAIT -> 0
      Orientation.LANDSCAPE_LEFT -> 90
      Orientation.PORTRAIT_UPSIDE_DOWN -> 180
      Orientation.LANDSCAPE_RIGHT -> 270
    }

  /**
   * Copies an RGBA frame into an ARGB_8888 bitmap, turned upright.
   *
   * Rows can be padded, so a plane whose stride exceeds width * 4 is copied row
   * by row rather than in one block - copying the padding straight through
   * would shear the image and produce landmarks that are subtly wrong rather
   * than obviously broken.
   *
   * The frame is not un-mirrored here. A front camera mirrors the image, which
   * swaps which hand MediaPipe calls left; decodeHolisticBuffer already undoes
   * that when reading the buffer, and flipping the pixels too would put it
   * back.
   */
  private fun Image.toArgbBitmap(rotationDegrees: Int): Bitmap? {
    val plane = planes.firstOrNull() ?: return null
    val buffer = plane.buffer.also { it.rewind() }
    val rowStride = plane.rowStride
    val tightStride = width * BYTES_PER_PIXEL

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    if (rowStride == tightStride) {
      bitmap.copyPixelsFromBuffer(buffer)
      return bitmap.rotated(rotationDegrees)
    }

    val packed = ByteBuffer.allocateDirect(tightStride * height).order(ByteOrder.nativeOrder())
    val row = ByteArray(tightStride)
    for (y in 0 until height) {
      buffer.position(y * rowStride)
      buffer.get(row, 0, tightStride)
      packed.put(row)
    }
    packed.rewind()
    bitmap.copyPixelsFromBuffer(packed)
    return bitmap.rotated(rotationDegrees)
  }

  private fun Bitmap.rotated(degrees: Int): Bitmap {
    if (degrees == 0) return this
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
  }
}
