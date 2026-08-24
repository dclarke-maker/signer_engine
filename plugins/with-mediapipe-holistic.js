const fs = require("node:fs");
const path = require("node:path");

const {
  IOSConfig,
  withDangerousMod,
  withAppBuildGradle,
  withMainApplication,
  withXcodeProject,
} = require("expo/config-plugins");

/**
 * Wires the MediaPipe holistic frame processor into the projects `expo prebuild`
 * generates. Native sources live in `native/holistic/` so they survive a
 * `--clean` prebuild; this plugin copies them in and adds the dependencies.
 *
 * The model is committed at `native/holistic/models/` (13 MB) so EAS, which
 * prebuilds on its own machines, receives it. This plugin still fails with a
 * clear message if it is absent, rather than producing an app that builds and
 * then silently detects nothing.
 */
const MODEL_FILE = "holistic_landmarker.task";
/**
 * Frames for the cross-runtime equivalence test. Generated locally by
 * tools/isl/make_frames.py and never committed: an iSign clip is CC-BY-NC-SA,
 * and the frames show a person. Absent is the normal state - the instrumented
 * test is simply not runnable until someone generates them.
 */
const FIXTURE_DIR = ["tools", "isl", "fixtures", "frames"];
const IOS_POD = "MediaPipeTasksVision";
const IOS_POD_VERSION = "~> 0.10.14";
const ANDROID_DEP = "com.google.mediapipe:tasks-vision:0.10.14";
const ANDROID_TEST_RUNNER = "androidx.test:runner:1.5.2";
const ANDROID_TEST_JUNIT = "androidx.test.ext:junit:1.1.5";

const SOURCE_ROOT = (projectRoot) => path.join(projectRoot, "native", "holistic");

function requireModel(projectRoot) {
  const modelPath = path.join(SOURCE_ROOT(projectRoot), "models", MODEL_FILE);
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `[mediapipe-holistic] ${MODEL_FILE} not found at ${modelPath}.\n` +
        "It should be committed. If it is missing, run scripts/fetch-holistic-model.sh " +
        "and verify the checksum in native/holistic/models/README.md.",
    );
  }
  return modelPath;
}

function copyInto(files, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(file, path.join(destDir, path.basename(file)));
  }
}

/** iOS: copy the Swift/ObjC sources and the model into the app target directory. */
const withIosSources = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const iosSource = path.join(SOURCE_ROOT(projectRoot), "ios");
      const target = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);

      copyInto(
        fs.readdirSync(iosSource).map((f) => path.join(iosSource, f)),
        target,
      );
      fs.copyFileSync(requireModel(projectRoot), path.join(target, MODEL_FILE));
      return cfg;
    },
  ]);

/** iOS: add the MediaPipe pod. */
const withIosPod = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (contents.includes(IOS_POD)) return cfg;

      contents = contents.replace(
        /(use_expo_modules!)/,
        `$1\n  pod '${IOS_POD}', '${IOS_POD_VERSION}'`,
      );
      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);

/**
 * iOS: register the copied sources and the model with the Xcode target.
 *
 * Uses the config-plugins helpers rather than xcode's raw addSourceFile and
 * addResourceFile: those take a group key that must already exist, and passing
 * the null returned by findPBXGroupKey fails deep inside the library with
 * "Cannot read properties of null". The helpers create the group when missing.
 */
const withIosTargets = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const groupName = cfg.modRequest.projectName;

    for (const file of ["HolisticFrameProcessorPlugin.swift", "HolisticFrameProcessorPlugin.m"]) {
      const filepath = `${groupName}/${file}`;
      if (project.hasFile(filepath)) continue;
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName, project });
    }

    const modelPath = `${groupName}/${MODEL_FILE}`;
    if (!project.hasFile(modelPath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: modelPath,
        groupName,
        project,
        isBuildFile: true,
      });
    }
    return cfg;
  });

/** Android: copy the Kotlin sources into the package directory and the model into assets. */
const withAndroidSources = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidSource = path.join(SOURCE_ROOT(projectRoot), "android");
      const pkgPath = (cfg.android?.package ?? "com.app.signlanguagemobile").split(".");
      const target = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...pkgPath,
        "holistic",
      );

      // Test sources must not land in the main source set: they import
      // androidx.test and junit, which are not on the main classpath, and the
      // app would stop compiling.
      const sources = fs
        .readdirSync(androidSource)
        .filter((f) => !f.endsWith("Test.kt"))
        .map((f) => path.join(androidSource, f));
      copyInto(sources, target);

      const assets = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets");
      fs.mkdirSync(assets, { recursive: true });
      fs.copyFileSync(requireModel(projectRoot), path.join(assets, MODEL_FILE));

      copyInstrumentedTest(cfg, projectRoot, pkgPath);
      return cfg;
    },
  ]);

/**
 * Android: place the cross-runtime equivalence test and its frames.
 *
 * The test goes in androidTest, and the frames go in the *test* APK's assets -
 * a separate asset manager from the app's, which is why the test reads them
 * through the instrumentation context rather than the target context.
 */
function copyInstrumentedTest(cfg, projectRoot, pkgPath) {
  const androidSource = path.join(SOURCE_ROOT(projectRoot), "android");
  const tests = fs
    .readdirSync(androidSource)
    .filter((f) => f.endsWith("Test.kt"))
    .map((f) => path.join(androidSource, f));
  if (tests.length === 0) return;

  const testRoot = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "androidTest");
  copyInto(tests, path.join(testRoot, "java", ...pkgPath, "holistic"));

  const frames = path.join(projectRoot, ...FIXTURE_DIR);
  if (!fs.existsSync(frames)) return;
  const pngs = fs
    .readdirSync(frames)
    .filter((f) => f.endsWith(".png"))
    .map((f) => path.join(frames, f));
  if (pngs.length > 0) {
    copyInto(pngs, path.join(testRoot, "assets", "holistic-fixtures"));
  }
}

/** Android: add the MediaPipe dependency and stop the model being compressed. */
const withAndroidGradle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes(ANDROID_DEP)) {
      contents = contents.replace(
        /dependencies\s?{/,
        `dependencies {\n    implementation '${ANDROID_DEP}'`,
      );
    }
    // Only needed to run the equivalence harness; they add nothing to the
    // shipped APK.
    if (!contents.includes(ANDROID_TEST_RUNNER)) {
      contents = contents.replace(
        /dependencies\s?{/,
        `dependencies {\n    androidTestImplementation '${ANDROID_TEST_RUNNER}'` +
          `\n    androidTestImplementation '${ANDROID_TEST_JUNIT}'`,
      );
    }
    if (!contents.includes("testInstrumentationRunner")) {
      contents = contents.replace(
        /defaultConfig\s?{/,
        'defaultConfig {\n        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"',
      );
    }
    // MediaPipe memory-maps the model; a compressed asset cannot be mapped.
    if (!contents.includes("noCompress")) {
      contents = contents.replace(
        /android\s?{/,
        "android {\n    androidResources {\n        noCompress += ['.task']\n    }",
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

/** Android: register the package so the plugin reaches the registry. */
const withAndroidPackage = (config) =>
  withMainApplication(config, (cfg) => {
    const pkg = cfg.android?.package ?? "com.app.signlanguagemobile";
    const importLine = `import ${pkg}.holistic.HolisticFrameProcessorPackage`;
    let contents = cfg.modResults.contents;

    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package .+)$/m, `$1\n\n${importLine}`);
    }
    if (!contents.includes("HolisticFrameProcessorPackage()")) {
      contents = contents.replace(
        /(PackageList\(this\)\.packages)/,
        "$1.apply { add(HolisticFrameProcessorPackage()) }",
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = function withMediaPipeHolistic(config) {
  config = withIosSources(config);
  config = withIosPod(config);
  config = withIosTargets(config);
  config = withAndroidSources(config);
  config = withAndroidGradle(config);
  config = withAndroidPackage(config);
  return config;
};
