package com.app.signlanguagemobile.holistic

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

/**
 * Registers the holistic plugin under the name the JS side looks up
 * (HOLISTIC_PLUGIN_NAME in lib/extractors/mediapipe-native-extractor.ts).
 */
class HolisticFrameProcessorPackage : ReactPackage {
  companion object {
    init {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("holisticLandmarks") { proxy, options ->
        HolisticFrameProcessorPlugin(proxy, options)
      }
    }
  }

  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = emptyList()

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
