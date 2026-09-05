import { ConfigPlugin, withXcodeProject } from '@expo/config-plugins';

/**
 * iOS config plugin for react-native-pdf-jsi
 * 
 * Configures the iOS project to support the PDF library:
 * - PDFKit for viewing / text extraction (podspec)
 * - Vision for optional on-device OCR (podspec, iOS 13+)
 * 
 * Note: Most iOS configuration is handled by the podspec file.
 * This plugin exists for any additional Xcode project modifications if needed.
 */
export const withPdfJsiIos: ConfigPlugin = (config) => {
  return withXcodeProject(config, async (config) => {
    const xcodeProject = config.modResults;
    
    // PDFKit + Vision are linked through the podspec frameworks list.
    const frameworks = xcodeProject.pbxFrameworksBuildPhaseObj(
      xcodeProject.getFirstTarget().uuid
    );
    
    if (frameworks) {
      const pdfKitLinked = Object.values(frameworks.files || {}).some(
        (file: any) => file?.comment?.includes('PDFKit')
      );
      
      if (!pdfKitLinked) {
        console.log('[react-native-pdf-jsi] iOS: PDFKit / Vision will be linked via CocoaPods');
      }
    }
    
    return config;
  });
};
