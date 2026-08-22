//  Registers the Swift plugin with VisionCamera's frame-processor registry
//  under the name the JS side looks up (HOLISTIC_PLUGIN_NAME).

#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

#if __has_include("SignBridge-Swift.h")
#import "SignBridge-Swift.h"
#else
#import <SignBridge-Swift.h>
#endif

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(HolisticFrameProcessorPlugin, holisticLandmarks)
