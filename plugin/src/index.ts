import {
  ConfigPlugin,
  createRunOncePlugin,
  withGradleProperties,
} from '@expo/config-plugins';
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

/**
 * Ensure pdfJsiEnableOcr is set in android/gradle.properties
 */
const withPdfJsiOcrGradle: ConfigPlugin<boolean> = (config, enabled) => {
  return withGradleProperties(config, (config) => {
    const key = 'pdfJsiEnableOcr';
    const value = enabled ? 'true' : 'false';
    const props = config.modResults;
    const existing = props.find((p) => p.type === 'property' && p.key === key);
    if (existing && existing.type === 'property') {
      existing.value = value;
    } else {
      props.push({ type: 'property', key, value });
    }
    return config;
  });
};

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

  console.log(
    '[react-native-pdf-jsi] Remember to install peer dependencies:\n' +
      '  - react-native-blob-util\n' +
      '  - @react-native-async-storage/async-storage' +
      (enableOcr
        ? '\n[react-native-pdf-jsi] OCR enabled (Android ML Kit; iOS uses Vision)'
        : '')
  );

  config = withPdfJsiAndroid(config);
  config = withPdfJsiIos(config);
  config = withPdfJsiOcrGradle(config, enableOcr);

  return config;
};

export default createRunOncePlugin(withPdfJsi, pkg.name, pkg.version);
