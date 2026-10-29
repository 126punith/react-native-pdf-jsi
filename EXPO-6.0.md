# Using 6.0.0 with Expo

This guide covers moving an Expo app to react-native-pdf-jsi 6.0.0, and setting it up from scratch. For the full list of API changes, see [MIGRATION-6.0.md](MIGRATION-6.0.md).

## Who this is for

- Expo SDK 52 or newer.
- A [development build](https://docs.expo.dev/develop/development-builds/introduction/). Expo Go is not supported, because 6.0 ships native code.
- The New Architecture. It is on by default from SDK 52; 6.0 has no Old Architecture fallback.

## 1. Install

```sh
npx expo install react-native-pdf-jsi react-native-nitro-modules
```

6.0 no longer uses these packages. Remove them unless your own code imports them:

```sh
npm uninstall react-native-blob-util crypto-js
```

Keep `@react-native-async-storage/async-storage` only if you persist bookmarks with `BookmarkManager.setStorage(AsyncStorage)`.

## 2. Configure the plugin

Add the plugin to `app.json` (or `app.config.js`):

```json
{
  "expo": {
    "plugins": ["react-native-pdf-jsi"]
  }
}
```

With options:

```json
["react-native-pdf-jsi", { "ocr": true, "iosFileSharing": false }]
```

| Option | Default | Effect |
| --- | --- | --- |
| `ocr` | `false` | Enables Android ML Kit text recognition (`pdfJsiEnableOcr=true`). iOS uses Vision and needs nothing. |
| `iosFileSharing` | `true` | Shows the app's Documents folder in the iOS Files app, where saved and exported files go. |
| `pdfiumDir` | unset | Directory containing `lib/<abi>/libpdfn.so`, for Android builds that cannot reach GitHub. Relative paths are resolved from the project root. Sets `pdfJsiPdfiumDir`. |
| `pdfiumUrl` | unset | Mirror URL of the PDFium release zip. The SHA-256 is still checked. Sets `pdfJsiPdfiumUrl`. |

What prebuild writes:

- `ios/<App>/Info.plist`: `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` set to `true` (unless `iosFileSharing` is `false`).
- `ios/Podfile.properties.json`: `"newArchEnabled": "true"`.
- `android/gradle.properties`: `newArchEnabled=true`, `pdfJsiEnableOcr=true|false`, and `pdfJsiPdfiumDir` / `pdfJsiPdfiumUrl` when those options are set.

The plugin no longer edits `build.gradle` or adds the Jitpack repository. iOS uses PDFKit.

### Android PDFium download

The PDFium libraries are not in the npm package. The first Android build (local or EAS) downloads them from GitHub Releases, checks the SHA-256 and caches them in the Gradle user home. If your build machine cannot reach GitHub, commit the unzipped release asset to your project and point the plugin at it:

```json
["react-native-pdf-jsi", { "pdfiumDir": "./vendor/pdfium" }]
```

`./vendor/pdfium` must contain `lib/arm64-v8a/libpdfn.so` and the other ABIs you build.

## 3. Prebuild and run

```sh
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

The plugin stops prebuild with a clear message in two cases:

| Error | Fix |
| --- | --- |
| `[react-native-pdf-jsi] react-native-nitro-modules is not installed. It is a required peer dependency: npx expo install react-native-nitro-modules` | Run that command, then prebuild again. |
| `[react-native-pdf-jsi] 6.0.0 requires the React Native New Architecture. Remove "newArchEnabled": false from your app config, or stay on react-native-pdf-jsi 4.x.` | Remove `"newArchEnabled": false` from `app.json`, or stay on 4.5.0. |

## 4. Update your code

A typical 5.x screen:

```tsx
import Pdf from 'react-native-pdf-jsi';

<Pdf
  source={{ uri: 'https://example.com/file.pdf', cache: true }}
  fitPolicy={2}
  onLoadComplete={(pages, filePath) => setTotal(pages)}
  onPageChanged={(page, total) => setPage(page)}
  onError={(error) => setError(String(error))}
/>
```

The same screen on 6.0:

```tsx
import { PdfView } from 'react-native-pdf-jsi';

<PdfView
  source={{ uri: 'https://example.com/file.pdf', cache: 'persistent' }}
  fitPolicy="width"
  onLoad={({ pageCount }) => setTotal(pageCount)}
  onPageChange={({ page }) => setPage(page + 1)}
  onError={(error) => setError(`${error.code}: ${error.message}`)}
/>
```

What changed:

- Pages are zero-based everywhere. Add 1 when you show a page number.
- `fitPolicy` takes `'width' | 'height' | 'page'` instead of numbers.
- `cache` is `'none' | 'session' | 'persistent'` instead of a boolean.
- Errors are `PdfError` objects with a stable `code`.
- `onLoadProgress` reports `{ loadedBytes, totalBytes }` instead of a fraction.

The props table, editing, saving and the full list of removed APIs are in [MIGRATION-6.0.md](MIGRATION-6.0.md).

## 5. Bundled PDFs and plain http

`require('./assets/manual.pdf')` works as a source with Expo's default Metro config, because `pdf` is already in the default asset extensions.

`https://` URLs need no setup. Plain `http://` URLs are blocked by both platforms until you allow them:

```sh
npx expo install expo-build-properties
```

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSAppTransportSecurity": { "NSAllowsArbitraryLoads": true }
      }
    },
    "plugins": [
      ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
    ]
  }
}
```

Prefer https in production.

## 6. Troubleshooting

### "Cannot read property '…' of null" after the upgrade

The Expo template turns on the React Compiler (`"experiments": { "reactCompiler": true }`). The compiler can read values used inside render helpers, such as `const renderResults = () => <Text>{results.size}</Text>`, before a `results && renderResults()` check runs. Opt that component out:

```jsx
function ResultsPanel({ results }) {
  'use no memo';
  // ...
}
```

Or read the value with optional chaining (`results?.size`). This is unrelated to the library; it affects any component written this way.

### Android: `undefined symbol: margelo::nitro::…` for one architecture

`npx expo run:android` builds only the connected device's ABI. A later full build (`./gradlew assembleDebug`, EAS, release) can then reuse that partial Nitro build output and fail to link on the other ABIs. Delete the stale output and rebuild:

```sh
rm -rf node_modules/react-native-nitro-modules/android/build \
       node_modules/react-native-nitro-modules/android/.cxx \
       node_modules/react-native-pdf-jsi/android/build \
       node_modules/react-native-pdf-jsi/android/.cxx
```

The next two issues come from Xcode 27 and iOS 27, and hit any Expo SDK 54 app regardless of this library. Because `expo prebuild` regenerates `ios/`, the fixes are local config plugins.

### Xcode 27: "IPHONEOS_DEPLOYMENT_TARGET is set to 9.0, but the range of supported deployment target versions is 15.0 to …"

Older pods (for example `SDWebImage`, or the resource bundle of `RNCAsyncStorage`) still declare iOS targets below 15, which Xcode 27 rejects. Save this as `plugins/withXcode27Podfile.js`:

```js
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# @xcode27-fixes';

const FIXES = `
    ${MARKER}
    # Swift explicit modules cannot build glog's module map (it includes headers
    # inside a namespace). React Native turns them off only for prebuilt cores.
    ReactNativePodsUtils.set_build_setting(installer, build_setting: 'SWIFT_ENABLE_EXPLICIT_MODULES', value: 'NO')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'
        # fmt 11 turns on a consteval path under C++20 that newer Apple Clang rejects.
        build_config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if target.name == 'fmt'
        # Xcode 27 rejects deployment targets below iOS 15 (old resource-bundle targets).
        if build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end

    # Swift targets (Nitro) import fmt as a C++20 Clang module, where the target
    # setting above does not apply, so consteval is switched off in the header.
    fmt_base = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base)
      source = File.read(fmt_base)
      patched = source.sub('defined(__apple_build_version__) && __apple_build_version__ < 14000029L',
                           'defined(__apple_build_version__)')
      if patched != source
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
      end
    end

    # glog's logging.h includes its other headers inside namespace google, which
    # Clang rejects as module imports; textual headers keep them plain includes.
    glog_modulemap = <<~MODULEMAP
      module glog {
        textual header "glog-umbrella.h"
        textual header "glog/logging.h"
        textual header "glog/log_severity.h"
        textual header "glog/raw_logging.h"
        textual header "glog/stl_logging.h"
        textual header "glog/vlog_is_on.h"
        export *
      }
    MODULEMAP
    Dir.glob(File.join(installer.sandbox.root, '**/glog.modulemap')).each do |path|
      File.chmod(0644, path)
      File.write(path, glog_modulemap)
    end
`;

module.exports = function withXcode27Podfile(config) {
  return withPodfile(config, (config) => {
    const podfile = config.modResults.contents;
    if (podfile.includes(MARKER)) return config;

    const anchor = /(react_native_post_install\([\s\S]*?\n\s*\)\n)/;
    if (!anchor.test(podfile)) {
      throw new Error('withXcode27Podfile: react_native_post_install(...) not found in Podfile');
    }
    config.modResults.contents = podfile.replace(anchor, `$1${FIXES}`);
    return config;
  });
};
```

With React Native's prebuilt core (the Expo default) there is no `fmt` or `glog` pod, so only the deployment-target part does anything; the rest covers apps that build React Native from source.

### iOS 27: "UIScene life cycle is required for apps built with this SDK"

Apps built with the iOS 27 SDK do not launch on iOS 27 unless they use a scene delegate, and the Expo SDK 54 template does not. The log shows react-native-pdf-jsi registering (`PdfLibrary`, `PdfDocument`, `PdfCache`) just before the failure, but the cause is the app delegate. Save this as `plugins/withUIScene.js`. It adds a scene manifest to `Info.plist`, generates `SceneDelegate.swift`, and moves window creation out of `AppDelegate.swift`:

```js
const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

// Apps built with the iOS 27 SDK must adopt the UIScene life cycle or they fail to launch.

const SCENE_DELEGATE = `import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    var launchOptions = appDelegate.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

const withSceneManifest = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

const withSceneAppDelegate = (config) =>
  withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('withUIScene: only Swift AppDelegates are supported');
    }
    let src = config.modResults.contents;
    if (src.includes('var launchOptions:')) return config;

    src = src.replace(
      'var reactNativeFactory: RCTReactNativeFactory?',
      'var reactNativeFactory: RCTReactNativeFactory?\n' +
        '  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?'
    );
    const windowBlock = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n/;
    if (!windowBlock.test(src)) {
      throw new Error('withUIScene: window setup block not found in AppDelegate.swift');
    }
    src = src.replace(windowBlock, '    self.launchOptions = launchOptions\n');
    config.modResults.contents = src;
    return config;
  });

const withSceneDelegateFile = (config) =>
  withDangerousMod(config, [
    'ios',
    (config) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
      const file = path.join(config.modRequest.platformProjectRoot, projectName, 'SceneDelegate.swift');
      fs.writeFileSync(file, SCENE_DELEGATE);
      return config;
    },
  ]);

const withSceneDelegateInProject = (config) =>
  withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });

module.exports = function withUIScene(config) {
  config = withSceneManifest(config);
  config = withSceneAppDelegate(config);
  config = withSceneDelegateFile(config);
  config = withSceneDelegateInProject(config);
  return config;
};
```

The plugin expects the default Expo SDK 54 `AppDelegate.swift`. If you have customised the window setup, apply the same change by hand.

Register both plugins after `react-native-pdf-jsi`, then run `npx expo prebuild --clean`:

```json
{
  "expo": {
    "plugins": [
      "react-native-pdf-jsi",
      "./plugins/withXcode27Podfile",
      "./plugins/withUIScene"
    ]
  }
}
```

## Checklist

- [ ] `react-native-pdf-jsi` (6.1.0 or newer) and `react-native-nitro-modules` installed with `npx expo install`
- [ ] `react-native-blob-util` and `crypto-js` removed, unless your own code uses them
- [ ] `"react-native-pdf-jsi"` in `plugins`; `newArchEnabled` not set to `false`
- [ ] `npx expo prebuild --clean` finishes without plugin errors
- [ ] Viewer props moved to `onLoad`, `onPageChange`, string `fitPolicy`, string `cache`
- [ ] Page numbers shown to users are `page + 1`
- [ ] Error handling reads `error.code`
- [ ] On Xcode 27 / iOS 27: `withXcode27Podfile` and `withUIScene` added
- [ ] Development build installed on a device or simulator (not Expo Go)
