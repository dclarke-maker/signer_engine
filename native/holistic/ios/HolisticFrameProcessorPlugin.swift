import Foundation
import MediaPipeTasksVision
import VisionCamera

/**
 * Runs MediaPipe HolisticLandmarker over each camera frame and returns one
 * packed Float32 buffer, base64-encoded.
 *
 * The layout is specified and unit-tested in `lib/extractors/holistic-buffer.ts`,
 * which is the authority for this encoding:
 *   [0]     schema version (1)
 *   [1]     timestamp ms since capture start
 *   [2..5]  face / pose / leftHand / rightHand counts, 0 when undetected
 *   then    each stream in that order, four floats per landmark: x, y, z, visibility
 *
 * A packed buffer is used rather than a dictionary because a holistic result is
 * ~543 landmarks; bridging that as nested objects every frame would dominate the
 * frame budget.
 *
 * It is returned as base64 rather than a SharedArray because the result is
 * handed to JS through Worklets.createRunOnJS, whose shared-value converter
 * rejects ArrayBuffers and wraps arrays element by element. A string crosses
 * as one copy. Bytes are little-endian, matching the reader; every Apple
 * platform this ships to is little-endian, and the conversion below is
 * explicit rather than relying on that.
 *
 * Nothing here retains, encodes, or writes a frame. The sample buffer is read
 * within the call and released by VisionCamera.
 */
@objc(HolisticFrameProcessorPlugin)
public class HolisticFrameProcessorPlugin: FrameProcessorPlugin {
  private static let schemaVersion: Float = 1
  private static let headerFloats = 6
  private static let floatsPerLandmark = 4

  private let landmarker: HolisticLandmarker?

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]? = nil) {
    self.landmarker = Self.makeLandmarker()
    super.init(proxy: proxy, options: options)
  }

  private static func makeLandmarker() -> HolisticLandmarker? {
    guard let modelPath = Bundle.main.path(
      forResource: "holistic_landmarker", ofType: "task"
    ) else {
      NSLog("[holistic] holistic_landmarker.task is missing from the app bundle")
      return nil
    }

    let opts = HolisticLandmarkerOptions()
    opts.baseOptions.modelAssetPath = modelPath
    opts.runningMode = .video
    // Blendshapes and segmentation masks are not part of this pipeline and cost
    // time on every frame, so they stay off.
    opts.outputFaceBlendshapes = false
    opts.outputPoseSegmentationMasks = false

    do {
      return try HolisticLandmarker(options: opts)
    } catch {
      NSLog("[holistic] failed to create HolisticLandmarker: \(error)")
      return nil
    }
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let landmarker = self.landmarker else { return nil }

    let timestampMs = (arguments?["timestampMs"] as? NSNumber)?.doubleValue ?? 0

    guard let image = try? MPImage(sampleBuffer: frame.buffer),
          let result = try? landmarker.detect(
            videoFrame: image,
            timestampInMilliseconds: Int(timestampMs)
          )
    else {
      return nil
    }

    let streams = [
      result.faceLandmarks,
      result.poseLandmarks,
      result.leftHandLandmarks,
      result.rightHandLandmarks,
    ]

    let totalFloats = Self.headerFloats
      + streams.reduce(0) { $0 + $1.count } * Self.floatsPerLandmark

    var packed = [Float](repeating: 0, count: totalFloats)
    packed[0] = Self.schemaVersion
    packed[1] = Float(timestampMs)
    for (i, stream) in streams.enumerated() {
      packed[2 + i] = Float(stream.count)
    }

    var offset = Self.headerFloats
    for stream in streams {
      for point in stream {
        packed[offset] = point.x
        packed[offset + 1] = point.y
        packed[offset + 2] = point.z
        packed[offset + 3] = point.visibility?.floatValue ?? 1
        offset += Self.floatsPerLandmark
      }
    }

    var bytes = Data(capacity: totalFloats * MemoryLayout<UInt32>.size)
    for value in packed {
      // littleEndian is a no-op on Apple silicon and Intel, but stating it
      // keeps the byte order a property of the format rather than the host.
      withUnsafeBytes(of: value.bitPattern.littleEndian) { bytes.append(contentsOf: $0) }
    }
    return bytes.base64EncodedString()
  }
}
