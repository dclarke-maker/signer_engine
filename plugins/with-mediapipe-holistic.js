const fs = require("node:fs");
const path = require("node:path");

const {
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
 * The model file is NOT vendored - it is ~130MB. `scripts/fetch-holistic-model.sh`
 * downloads it into `native/holistic/models/`, and this plugin fails the build
 * with a clear message if it is missing, rather than producing an app that
 * silently detects nothing.
 */
const MODEL_FILE = "holistic_landmarker.task";
const IOS_POD = "MediaPipeTasksVision";
const IOS_POD_VERSION = "~> 0.10.14";
const ANDROID_DEP = "com.google.mediapipe:tasks-vision:0.10.14";

const SOURCE_ROOT = (projectRoot) => path.join(projectRoot, "native", "holistic");

function requireModel(projectRoot) {
  const modelPath = path.join(SOURCE_ROOT(projectRoot), "models", MODEL_FILE);
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `[mediapipe-holistic] ${MODEL_FILE} not found at ${modelPath}.\n` +
        "Run scripts/fetch-holistic-model.sh before prebuilding. The model is not " +
        "committed because of its size.",
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

/** iOS: register the copied sources and the model with the Xcode target. */
const withIosTargets = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const groupName = cfg.modRequest.projectName;

    for (const file of ["HolisticFrameProcessorPlugin.swift", "HolisticFrameProcessorPlugin.m"]) {
      if (!project.hasFile(`${groupName}/${file}`)) {
        project.addSourceFile(`${groupName}/${file}`, {}, project.findPBXGroupKey({ name: groupName }));
      }
    }
    if (!project.hasFile(`${groupName}/${MODEL_FILE}`)) {
      project.addResourceFile(
        `${groupName}/${MODEL_FILE}`,
        {},
        project.findPBXGroupKey({ name: groupName }),
      );
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

      copyInto(
        fs.readdirSync(androidSource).map((f) => path.join(androidSource, f)),
        target,
      );

      const assets = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "assets");
      fs.mkdirSync(assets, { recursive: true });
      fs.copyFileSync(requireModel(projectRoot), path.join(assets, MODEL_FILE));
      return cfg;
    },
  ]);

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
