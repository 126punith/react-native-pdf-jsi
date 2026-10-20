import {
  ConfigPlugin,
  createRunOncePlugin,
  withGradleProperties,
  withInfoPlist,
  withPodfileProperties,
} from 'expo/config-plugins';

const pkg = require('../../package.json');

export type PdfJsiPluginProps = {
  /**
   * Enable optional on-device OCR (Android ML Kit).
   * Sets gradle property pdfJsiEnableOcr=true.
   * iOS Vision OCR is always available on iOS 13+ (system framework).
   * @default false
   */
  ocr?: boolean;
  /**
   * Show the app's Documents folder in the iOS Files app, where
   * PdfFiles.saveToDownloads and the export helpers write.
   * Sets UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace.
   * @default true
   */
  iosFileSharing?: boolean;
};

const setGradleProperty: (key: string, value: string) => ConfigPlugin =
  (key, value) => (config) =>
    withGradleProperties(config, (config) => {
      const props = config.modResults;
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing && existing.type === 'property') {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
      return config;
    });

/**
 * Ensure pdfJsiEnableOcr is set in android/gradle.properties
 */
const withPdfJsiOcrGradle: ConfigPlugin<boolean> = (config, enabled) =>
  setGradleProperty('pdfJsiEnableOcr', enabled ? 'true' : 'false')(config);

const withIosFileSharing: ConfigPlugin = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.UIFileSharingEnabled = true;
    config.modResults.LSSupportsOpeningDocumentsInPlace = true;
    return config;
  });

/**
 * There is no old-architecture fallback, so force newArchEnabled on both platforms.
 */
const withNewArchitecture: ConfigPlugin = (config) => {
  if ((config as { newArchEnabled?: boolean }).newArchEnabled === false) {
    throw new Error(
      `[${pkg.name}] ${pkg.version} requires the React Native New Architecture. ` +
        'Remove "newArchEnabled": false from your app config, or stay on react-native-pdf-jsi 4.x.'
    );
  }

  config = setGradleProperty('newArchEnabled', 'true')(config);
  config = withPodfileProperties(config, (config) => {
    config.modResults.newArchEnabled = 'true';
    return config;
  });
  return config;
};

function assertNitroModulesInstalled(projectRoot: string | undefined) {
  try {
    require.resolve('react-native-nitro-modules/package.json', {
      paths: projectRoot ? [projectRoot] : undefined,
    });
  } catch {
    throw new Error(
      `[${pkg.name}] react-native-nitro-modules is not installed. ` +
        'It is a required peer dependency: npx expo install react-native-nitro-modules'
    );
  }
}

/**
 * Expo config plugin for react-native-pdf-jsi
 *
 * Turns on the New Architecture and checks that react-native-nitro-modules is
 * installed. Optional `{ ocr: true }` enables Android ML Kit text recognition.
 * On iOS the app's Documents folder is shown in the Files app unless
 * `{ iosFileSharing: false }` is passed.
 * Nothing else is needed: PDFium ships with the package and iOS uses PDFKit.
 *
 * Note: This package requires development builds and won't work with Expo Go.
 */
const withPdfJsi: ConfigPlugin<PdfJsiPluginProps | void> = (config, props) => {
  const options = props ?? {};
  const enableOcr = !!options.ocr;

  assertNitroModulesInstalled(config._internal?.projectRoot);

  config = withNewArchitecture(config);
  config = withPdfJsiOcrGradle(config, enableOcr);
  if (options.iosFileSharing !== false) {
    config = withIosFileSharing(config);
  }

  return config;
};

export default createRunOncePlugin(withPdfJsi, pkg.name, pkg.version);
