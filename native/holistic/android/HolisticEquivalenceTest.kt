package com.app.signlanguagemobile.holistic

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test

/**
 * Puts fixture frames through the device extractor and writes the landmarks out,
 * so the same frames can be put through the offline Python extractor and the two
 * compared.
 *
 * Loading the same `holistic_landmarker.task` in both runtimes proves the weights
 * match. It proves nothing about image conversion, rotation handling, MediaPipe
 * version behaviour, delegate differences or handedness - and those are exactly
 * what move landmarks without failing. ISL pre-training and NSL fine-tuning
 * happen in two different runtimes, so an unmeasured difference between them is
 * a silent degradation in RQ4's result.
 *
 * This asserts almost nothing on its own. It is a measurement harness: the
 * comparison and its tolerance live in `tools/isl/cross_runtime.py`, because a
 * threshold picked before seeing the divergence would be a guess.
 *
 * Run:
 *   npx expo prebuild --platform android
 *   cd android && ./gradlew connectedAndroidTest
 *   adb pull /sdcard/Android/data/<pkg>/files/holistic-equivalence.json
 */
class HolisticEquivalenceTest {

  @Test
  fun writesLandmarksForEveryFixtureFrame() {
    // The plugin resolves holistic_landmarker.task from the app under test's
    // assets, so it needs the target context.
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val plugin = HolisticFrameProcessorPlugin(context, null)

    // The fixtures ship in the *test* APK, which is a different asset manager.
    val assets = InstrumentationRegistry.getInstrumentation().context.assets
    val names = assets.list("holistic-fixtures")
      ?.filter { it.endsWith(".png") }
      ?.sorted()
      ?: emptyList()
    check(names.isNotEmpty()) { "no fixture frames in assets/holistic-fixtures" }

    val frames = JSONArray()
    var timestamp = 0L

    for (name in names) {
      val bitmap: Bitmap = assets.open("holistic-fixtures/$name").use {
        BitmapFactory.decodeStream(it)
      }
      // The fixture set carries an upright case and a 90-degree landscape case.
      // Rotation and post-rotation aspect are the paths that broke on NSL, and
      // upright-only inputs would leave both untested.
      val rotation = if (name.contains("rot90")) 90 else 0

      timestamp += 40
      val packed = plugin.detectAndPack(
        bitmap,
        rotationDegrees = rotation,
        timestampMs = timestamp,
        mirrored = false,
      )
      frames.put(describe(name, rotation, packed))
    }

    val out = File(context.getExternalFilesDir(null), "holistic-equivalence.json")
    out.writeText(
      JSONObject()
        .put("runtime", "android")
        .put("device", android.os.Build.MODEL)
        .put("frames", frames)
        .toString()
    )
  }

  /** Unpacks the base64 float32 buffer the plugin returns, per holistic-buffer.ts. */
  private fun describe(name: String, rotation: Int, packed: String?): JSONObject {
    val frame = JSONObject().put("fixture", name).put("rotationDegrees", rotation)
    if (packed == null) {
      // Not a failure of the harness: a fixture in which MediaPipe finds nothing
      // is itself a comparable result.
      return frame.put("detected", false)
    }

    val bytes = Base64.decode(packed, Base64.NO_WRAP)
    val floats = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()

    val counts = intArrayOf(
      floats.get(2).toInt(), floats.get(3).toInt(),
      floats.get(4).toInt(), floats.get(5).toInt(),
    )
    frame.put("detected", true)
      .put("schemaVersion", floats.get(0))
      .put("timestampMs", floats.get(1))
      .put("aspect", floats.get(6))
      .put("mirrored", floats.get(7) != 0f)
      .put("counts", JSONArray(counts.toTypedArray()))

    var offset = 8
    val names = arrayOf("face", "pose", "leftHand", "rightHand")
    for (i in names.indices) {
      val points = JSONArray()
      for (p in 0 until counts[i]) {
        points.put(
          JSONArray(
            arrayOf(floats.get(offset), floats.get(offset + 1), floats.get(offset + 2))
          )
        )
        offset += 4
      }
      frame.put(names[i], points)
    }
    return frame
  }
}
