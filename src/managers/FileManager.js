import { Linking, Platform } from 'react-native';
import { PdfFiles } from '../PdfCache';

/** File helpers backed by the native PdfCache module (no react-native-blob-util). */
class FileManager {
  static async openDownloadsFolder() {
    if (Platform.OS === 'android') {
      await Linking.openURL('content://com.android.externalstorage.documents/document/primary%3ADownload');
      return true;
    }
    const documents = PdfFiles.documentDirectory.replace(/^file:\/\//i, '');
    try {
      await Linking.openURL(`shareddocuments://${encodeURI(documents)}`);
    } catch {
      await Linking.openURL('shareddocuments://');
    }
    return true;
  }

  /**
   * Android: copies into the public Downloads folder through MediaStore and
   * returns its content:// URI. iOS: copies into the app's Documents folder
   * and returns the path. The folder only shows in the Files app when the
   * app's Info.plist sets UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace.
   */
  static async downloadToPublicFolder(sourcePath, fileName, mimeType = 'application/pdf') {
    const target = await PdfFiles.saveToDownloads(sourcePath, fileName, mimeType);
    return target.uri;
  }

  static async downloadMultipleFiles(files) {
    const results = [];
    for (const file of files) {
      const { sourcePath, fileName, mimeType = 'application/pdf' } = file;
      results.push(await this.downloadToPublicFolder(sourcePath, fileName, mimeType));
    }
    return results;
  }
}

export default FileManager;
