import { Linking, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * File helpers that used to be native bridge modules. Downloads go through
 * react-native-blob-util, which is already a peer dependency.
 */
class FileManager {
  static async openDownloadsFolder() {
    if (Platform.OS === 'android') {
      await Linking.openURL('content://com.android.externalstorage.documents/document/primary%3ADownload');
      return true;
    }
    await Linking.openURL('shareddocuments://');
    return true;
  }

  static async downloadToPublicFolder(sourcePath, fileName, mimeType = 'application/pdf') {
    const source = sourcePath.startsWith('file://') ? sourcePath.replace('file://', '') : sourcePath;
    if (Platform.OS === 'android' && ReactNativeBlobUtil.MediaCollection?.copyToMediaStore) {
      return ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: '', mimeType },
        'Download',
        source
      );
    }
    const dest = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${fileName}`;
    await ReactNativeBlobUtil.fs.cp(source, dest);
    return dest;
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
