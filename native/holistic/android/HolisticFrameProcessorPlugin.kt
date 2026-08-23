package com.app.signlanguagemobile.holistic

import android.graphics.Bitmap
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarker
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarkerResult
import android.media.Image
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.SharedArray
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Runs MediaPipe HolisticLandmarker over each camera frame and returns one
 * packed Float32 buffer.
 *
 * The layout is specified and unit-tested in `lib/extractors/holistic-buffer.ts`,
 * which is the authority for this encoding:
 *   [0]     schema version (1)
 *   [1]     timestamp ms since capture start
 *   [2..5]  face / pose / leftHand / rightHand counts, 0 when undetected
 *   then    each stream in that order, four floats per landmark: x, y, z, visibility
 *
 * A packed buffer is used rather than a map because a holistic result is ~543
 * landmarks; bridging that as nested objects every frame would dominate the
 * frame budget.
 *
 * Nothing here retains, encodes, or writes a frame.
 */
class HolisticFrameProcessorPlugin(
  private val proxy: VisionCameraProxy,
  options: Map<String, Any>?,
) : FrameProcessorPlugin() {

  private companion object {
    const val TAG = "HolisticPlugin"
    const val SCHEMA_VERSION = 1f
    const val HEADER_FLOATS = 6
    const val FLOATS_PER_LANDMARK = 4
    const val MODEL_ASSET = "holistic_landmarker.task"
    const val BYTES_PER_PIXEL = 4
  }

  private val landmarker: HolisticLandmarker? = try {
    val base = BaseOptions.builder()
      .setModelAssetPath(MODEL_ASSET)
      .setDelegate(Delegate.GPU)
      .build()
    val opts = HolisticLandmarker.HolisticLandmarkerOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.VIDEO)
      // Not part of this pipeline, and both cost time on every frame.
      .setOutputFaceBlendshapes(false)
      .setOutputPoseSegmentationMasks(false)
      .build()
    HolisticLandmarker.createFromOptions(proxy.context, opts)
  } catch (e: Throwable) {
    Log.e(TAG, "failed to create HolisticLandmarker", e)
    null
  }

  override fun callback(frame: Frame, arguments: Map<String, Any>?): Any? {
    val detector = landmarker ?: return null
    val timestampMs = (arguments?.get("timestampMs") as? Number)?.toLong() ?: 0L

    val result: HolisticLandmarkerResult = try {
      // frame.imageProxy is a CameraX type this module does not have on its
      // compile classpath, and ImageProxy.toBitmap() is not available in every
      // CameraX version. frame.image is android.media.Image - a framework class
      // - so it needs no extra dependency. The camera is configured for RGBA
      // output (pixelFormat="rgb" in LandmarkCamera), so plane 0 can be copied
      // straight into a bitmap without a YUV conversion.
      val bitmap = frame.image.toArgbBitmap() ?: return null
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

    val totalFloats = HEADER_FLOATS + streams.sumOf { it.size } * FLOATS_PER_LANDMARK
    val byteCount = totalFloats * 4

    val shared = SharedArray(proxy, byteCount)
    val buffer: ByteBuffer = shared.byteBuffer.order(ByteOrder.nativeOrder())
    val floats = buffer.asFloatBuffer()

    floats.put(0, SCHEMA_VERSION)
    floats.put(1, timestampMs.toFloat())
    streams.forEachIndexed { i, stream -> floats.put(2 + i, stream.size.toFloat()) }

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

    return shared
  }

  /**
   * Copies an RGBA frame into an ARGB_8888 bitmap.
   *
   * Rows can be padded, so a plane whose stride exceeds width * 4 is copied row
   * by row rather than in one block - copying the padding straight through
   * would shear the image and produce landmarks that are subtly wrong rather
   * than obviously broken.
   */
  private fun Image.toArgbBitmap(): Bitmap? {
    val plane = planes.firstOrNull() ?: return null
    val buffer = plane.buffer.also { it.rewind() }
    val rowStride = plane.rowStride
    val tightStride = width * BYTES_PER_PIXEL

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    if (rowStride == tightStride) {
      bitmap.copyPixelsFromBuffer(buffer)
      return bitmap
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
    return bitmap
  }
}
