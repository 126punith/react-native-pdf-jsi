import { ConfigPlugin, withProjectBuildGradle } from 'expo/config-plugins';

/**
 * Android config plugin for react-native-pdf-jsi
 * 
 * Configures the Android project to support the PDF library:
 * - Adds Jitpack repository for AndroidPdfViewer dependency
 */
export const withPdfJsiAndroid: ConfigPlugin = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = addJitpackRepository(config.modResults.contents);
    }
    return config;
  });
};

/**
 * Add Jitpack repository to the project's build.gradle if not already present.
 * This is required for the AndroidPdfViewer dependency.
 */
function addJitpackRepository(buildGradle: string): string {
  const jitpackUrl = "maven { url 'https://jitpack.io' }";
  
  // Check if Jitpack is already added
  if (buildGradle.includes('jitpack.io')) {
    return buildGradle;
  }

  // Find the allprojects { repositories { ... } } block and add Jitpack
  const allProjectsPattern = /allprojects\s*\{[\s\S]*?repositories\s*\{/;
  const match = buildGradle.match(allProjectsPattern);

  if (match) {
    // Add Jitpack after the opening of repositories block
    const insertPosition = match.index! + match[0].length;
    return (
      buildGradle.slice(0, insertPosition) +
      `\n        ${jitpackUrl}` +
      buildGradle.slice(insertPosition)
    );
  }

  // If allprojects block exists but repositories block doesn't have the expected format,
  // try to add it in a different way
  if (buildGradle.includes('allprojects')) {
    // Look for maven { url pattern in allprojects section
    const mavenCentralPattern = /(allprojects\s*\{[\s\S]*?repositories\s*\{[\s\S]*?)(mavenCentral\(\)|google\(\))/;
    const mavenMatch = buildGradle.match(mavenCentralPattern);
    
    if (mavenMatch) {
      return buildGradle.replace(
        mavenCentralPattern,
        `$1$2\n        ${jitpackUrl}`
      );
    }
  }

  // If we couldn't find a good place, add a comment for manual addition
  console.warn(
    '[react-native-pdf-jsi] Could not automatically add Jitpack repository.\n' +
    'Please manually add the following to your android/build.gradle:\n' +
    "maven { url 'https://jitpack.io' }"
  );

  return buildGradle;
}
