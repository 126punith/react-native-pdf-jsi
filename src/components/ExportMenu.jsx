/**
 * ExportMenu - Export PDF pages to images
 */

import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import BottomSheet from './BottomSheet';
import FileManager from '../managers/FileManager';

const ExportMenu = ({
  visible,
  onClose,
  currentPage,
  totalPages,
  pdfPath,
  onExport,
  onShareFiles,
}) => {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const handleExport = async (format, quality, pages) => {
    try {
      setExporting(true);
      setExportProgress(`Exporting to ${format.toUpperCase()}...`);

      const options = {
        format,
        quality,
      };

      let result;
      if (pages === 'current') {
        setExportProgress(`Exporting page ${currentPage}...`);
        result = await onExport({
          type: 'single',
          page: currentPage,
          ...options,
        });
      } else {
        const pageCount = Math.min(3, totalPages);
        setExportProgress(`Exporting ${pageCount} pages...`);
        result = await onExport({
          type: 'range',
          pages: Array.from({length: pageCount}, (_, i) => i + 1),
          ...options,
        });
      }

      setExportProgress('');
      setExporting(false);

      // Show success and offer share
      if (result) {
        // Handle new result format with download info
        const downloadedFiles = result.downloadedFiles || [];
        const message = result.message || `Exported successfully!`;
        
        Alert.alert(
          '✅ Export Successful',
          message,
          [
            {text: 'Done', style: 'cancel'},
            {
              text: 'Open Folder',
              onPress: async () => {
                try {
                  await FileManager.openDownloadsFolder();
                } catch (e) {
                  Alert.alert('Info', 'Please check Downloads/PDFDemoApp folder in your file manager');
                }
              }
            },
            downloadedFiles.length > 0 && onShareFiles && {
              text: 'Share',
              onPress: () => onShareFiles(downloadedFiles),
            },
          ].filter(Boolean)
        );
      }

      onClose();
    } catch (error) {
      setExporting(false);
      setExportProgress('');
      Alert.alert('Export Failed', error.message);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} height={450}>
      <View style={styles.container}>
        <Text style={styles.title}>Export Pages</Text>

        {exporting ? (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.progressText}>{exportProgress}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Export Current Page</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.exportButton, styles.pngButton]}
                onPress={() => handleExport('png', 'high', 'current')}>
                <Text style={styles.buttonIcon}>🖼️</Text>
                <Text style={styles.buttonText}>PNG (High)</Text>
                <Text style={styles.buttonHint}>Page {currentPage}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exportButton, styles.jpegButton]}
                onPress={() => handleExport('jpeg', 'medium', 'current')}>
                <Text style={styles.buttonIcon}>📸</Text>
                <Text style={styles.buttonText}>JPEG (Med)</Text>
                <Text style={styles.buttonHint}>Page {currentPage}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Export Multiple Pages</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.exportButton, styles.rangeButton]}
                onPress={() => handleExport('png', 'high', 'range')}>
                <Text style={styles.buttonIcon}>📚</Text>
                <Text style={styles.buttonText}>First {Math.min(3, totalPages)} Pages</Text>
                <Text style={styles.buttonHint}>PNG Format</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exportButton, styles.rangeButton]}
                onPress={() => handleExport('jpeg', 'medium', 'range')}>
                <Text style={styles.buttonIcon}>📑</Text>
                <Text style={styles.buttonText}>First {Math.min(3, totalPages)} Pages</Text>
                <Text style={styles.buttonHint}>JPEG Format</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 12,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  exportButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
  },
  pngButton: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  jpegButton: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  rangeButton: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  buttonIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  buttonHint: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    marginTop: 16,
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
});

export default ExportMenu;
