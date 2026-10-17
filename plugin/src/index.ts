import {
  ConfigPlugin,
  createRunOncePlugin,
  withGradleProperties,
  withPodfileProperties,
} from 'expo/config-plugins';
import { withPdfJsiAndroid } from './withPdfJsiAndroid';
import { withPdfJsiIos } from './withPdfJsiIos';

const pkg = require('../../package.json');

export type PdfJsiPluginProps = {
  /**
   * Enable optional on-device OCR (Android ML Kit).
   * Sets gradle property pdfJsiEnableOcr=true.
   * iOS Vision OCR is always available on iOS 13+ (system framework).
   * @default false
   */
  ocr?: boolean;
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

/**
 * 5.x has no old-architecture fallback, so force newArchEnabled on both platforms.
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
 * Configures native projects for Expo development builds.
 * Optional `{ ocr: true }` enables Android ML Kit text recognition.
 *
 * Note: This package requires development builds and won't work with Expo Go.
 */
const withPdfJsi: ConfigPlugin<PdfJsiPluginProps | void> = (config, props) => {
  const options = props ?? {};
  const enableOcr = !!options.ocr;

  assertNitroModulesInstalled(config._internal?.projectRoot);

  console.log(
    '[react-native-pdf-jsi] Requires the New Architecture and these peer dependencies:\n' +
      '  - react-native-nitro-modules\n' +
      '  - react-native-blob-util\n' +
      '  - @react-native-async-storage/async-storage' +
      (enableOcr
        ? '\n[react-native-pdf-jsi] OCR enabled (Android ML Kit; iOS uses Vision)'
        : '')
  );

  config = withNewArchitecture(config);
  config = withPdfJsiAndroid(config);
  config = withPdfJsiIos(config);
  config = withPdfJsiOcrGradle(config, enableOcr);

  return config;
};

export default createRunOncePlugin(withPdfJsi, pkg.name, pkg.version);
