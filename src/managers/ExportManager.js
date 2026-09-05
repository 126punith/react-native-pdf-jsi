/**
 * ExportManager - PDF Export and Conversion Manager
 * Handles exporting PDFs to various formats and PDF operations
 * 
 * LICENSE:
 * - Export to text: MIT License (Free)
 * - Export to images: Commercial License (Paid)
 * - PDF operations: Commercial License (Paid)
 * 
 * @author Punith M
 * @version 1.0.0
 */

import { NativeModules, Platform, Share } from 'react-native';
import PDFTextExtractor from '../utils/PDFTextExtractor';

const { PDFExporter } = NativeModules;

/**
 * Export formats supported
 */
export const ExportFormat = {
    TEXT: 'text',
    JPEG: 'jpeg',
    PNG: 'png',
    PDF: 'pdf'
};

/**
 * Export quality levels
 */
export const ExportQuality = {
    LOW: 0.5,
    MEDIUM: 0.75,
    HIGH: 0.9,
    BEST: 1.0
};

/**
 * ExportManager Class
 */
export class ExportManager {
    constructor() {
        this.isNativeAvailable = !!PDFExporter;
        
        if (!this.isNativeAvailable) {
            console.warn('📤 ExportManager: Native module not available - using fallback methods');
        } else {
            console.log('📤 ExportManager: Initialized (version ' + PDFExporter.VERSION + ')');
        }
    }

    /**
     * Check if export functionality is available
     * @returns {boolean} True if available
     */
    isAvailable() {
        return this.isNativeAvailable || PDFTextExtractor.isTextExtractionAvailable();
    }

    /**
     * Convert quality string to numeric value
     * @private
     * @param {string|number} quality - Quality as string ('low', 'medium', 'high', 'best') or number (0.5-1.0)
     * @returns {number} Normalized quality as number
     */
    _normalizeQuality(quality) {
        // If already numeric, return as-is
        if (typeof quality === 'number') {
            return quality;
        }
        
        // Convert string to numeric
        const qualityMap = {
            'low': ExportQuality.LOW,        // 0.5
            'medium': ExportQuality.MEDIUM,  // 0.75
            'high': ExportQuality.HIGH,      // 0.9
            'best': ExportQuality.BEST       // 1.0
        };
        
        const normalized = qualityMap[quality?.toLowerCase()];
        return normalized !== undefined ? normalized : ExportQuality.HIGH; // default to HIGH
    }

    // ============================================
    // EXPORT TO TEXT
    // ============================================

    /**
     * Export PDF to plain text
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Export options
     * @returns {Promise<string>} Exported text content
     */
    async exportToText(filePath, options = {}) {
        const {
            pages = null, // null = all pages, or array of page numbers
            includePageNumbers = true,
            separator = '\n\n--- Page {page} ---\n\n',
            encoding = 'utf8'
        } = options;

        console.log('📤 ExportManager: Exporting to text...');

        try {
            // Use text extractor
            let textMap;
            
            if (pages) {
                // Convert to 0-indexed
                const pageIndices = pages.map(p => p - 1);
                textMap = await PDFTextExtractor.extractTextFromPages(filePath, pageIndices);
            } else {
                textMap = await PDFTextExtractor.extractAllText(filePath);
            }

            // Build text document
            let result = '';
            const sortedPages = Array.from(textMap.keys()).sort((a, b) => a - b);

            sortedPages.forEach((pageNum, index) => {
                const text = textMap.get(pageNum);
                
                if (includePageNumbers && index > 0) {
                    const sep = separator.replace('{page}', pageNum + 1);
                    result += sep;
                }
                
                result += text || '';
            });

            console.log(`📤 ExportManager: Exported ${result.length} characters from ${sortedPages.length} pages`);
            return result;

        } catch (error) {
            console.error('📤 ExportManager: Export to text error:', error);
            throw error;
        }
    }

    /**
     * Export page to text (single page)
     * @param {string} filePath - Path to PDF file
     * @param {number} pageNumber - Page number (1-indexed)
     * @returns {Promise<string>} Page text
     */
    async exportPageToText(filePath, pageNumber) {
        try {
            const text = await PDFTextExtractor.extractTextFromPage(filePath, pageNumber - 1);
            console.log(`📤 ExportManager: Exported page ${pageNumber} (${text.length} chars)`);
            return text;
        } catch (error) {
            console.error('📤 ExportManager: Export page error:', error);
            throw error;
        }
    }

    // ============================================
    // EXPORT TO IMAGES
    // ============================================

    /**
     * Export PDF pages to images
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Export options
     * @returns {Promise<Array>} Array of image paths
     */
    async exportToImages(filePath, options = {}) {
        // All features enabled by default
        const {
            pages = null, // null = all pages
            format = ExportFormat.JPEG,
            quality = ExportQuality.HIGH,
            width = null, // null = original width
            height = null, // null = original height
            scale = 2.0 // Scale factor for rendering
        } = options;

        console.log('📤 ExportManager: Exporting to images...');

        try {
            if (this.isNativeAvailable) {
                // Use native exporter
                const images = await PDFExporter.exportToImages(filePath, {
                    pages: pages || [],
                    format,
                    quality,
                    width,
                    height,
                    scale
                });

                console.log(`📤 ExportManager: Exported ${images.length} images`);
                return images;
            } else {
                // Fallback: Use screenshot-based approach
                console.warn('📤 ExportManager: Native export not available, using fallback');
                return this.exportToImagesFallback(filePath, options);
            }

        } catch (error) {
            console.error('📤 ExportManager: Export to images error:', error);
            throw error;
        }
    }

    /**
     * Export single page to image
     * @param {string} filePath - Path to PDF file
     * @param {number} pageNumber - Page number (1-indexed)
     * @param {Object} options - Export options
     * @returns {Promise<string>} Image file path
     */
    async exportPageToImage(filePath, pageNumber, options = {}) {
        const {
            format = ExportFormat.JPEG,
            quality = ExportQuality.HIGH,
            scale = 2.0
        } = options;

        console.log(`🖼️ [ExportManager] exportPageToImage - START`, {
            filePath,
            pageNumber,
            format,
            quality,
            scale
        });

        try {
            // All features enabled by default
            if (this.isNativeAvailable) {
                console.log('📱 [ExportManager] Calling native PDFExporter.exportPageToImage...');
                console.log('📱 [ExportManager] Parameters:', {
                    pageIndex: pageNumber - 1,
                    format,
                    quality,
                    scale
                });
                
                const imagePath = await PDFExporter.exportPageToImage(filePath, pageNumber - 1, {
                    format,
                    quality: this._normalizeQuality(quality),
                    scale
                });

                console.log('✅ [ExportManager] exportPageToImage - SUCCESS', {
                    outputPath: imagePath
                });
                return imagePath;
            } else {
                console.error('❌ [ExportManager] Native export module not available');
                throw new Error('Native export module not available');
            }

        } catch (error) {
            console.error('❌ [ExportManager] exportPageToImage - ERROR:', error.message);
            console.error('❌ [ExportManager] Error details:', error);
            throw error;
        }
    }

    // ============================================
    // PDF OPERATIONS
    // ============================================

    /**
     * Merge multiple PDFs into one
     * @param {string[]} filePaths - Array of PDF file paths
     * @param {string} outputPath - Output file path
     * @returns {Promise<string>} Path to merged PDF
     */
    async mergePDFs(filePaths, outputPath = null) {
        // All features enabled by default
        console.log(`📤 ExportManager: Merging ${filePaths.length} PDFs...`);

        try {
            if (this.isNativeAvailable) {
                const mergedPath = await PDFExporter.mergePDFs(filePaths, outputPath);
                console.log('📤 ExportManager: Merged to:', mergedPath);
                return mergedPath;
            } else {
                throw new Error('PDF merge requires native module');
            }

        } catch (error) {
            console.error('📤 ExportManager: Merge PDFs error:', error);
            throw error;
        }
    }

    /**
     * Split PDF into multiple files
     * @param {string} filePath - Path to PDF file
     * @param {Array} ranges - Flat array of page range pairs [start1, end1, start2, end2, ...]
     * @param {string} outputDir - Output directory (deprecated, not used)
     * @returns {Promise<Array>} Array of split PDF paths
     */
    async splitPDF(filePath, ranges, outputDir = null) {
        console.log(`✂️ [ExportManager] splitPDF - START`, {
            filePath,
            ranges,
            rangeCount: ranges.length
        });

        try {
            // All features enabled by default
            if (this.isNativeAvailable) {
                console.log('📱 [ExportManager] Calling native PDFExporter.splitPDF...');
                console.log('📱 [ExportManager] Ranges:', JSON.stringify(ranges));
                
                // Android requires 3 arguments (filePath, ranges, outputDir)
                // iOS only requires 2 arguments (filePath, ranges)
                let splitPaths;
                if (Platform.OS === 'android') {
                    splitPaths = await PDFExporter.splitPDF(filePath, ranges, null);
                } else {
                    splitPaths = await PDFExporter.splitPDF(filePath, ranges);
                }
                
                console.log(`✅ [ExportManager] splitPDF - SUCCESS - Split into ${splitPaths.length} files`);
                console.log('📁 [ExportManager] Split files:', splitPaths);
                return splitPaths;
            } else {
                console.error('❌ [ExportManager] PDF split requires native module');
                throw new Error('PDF split requires native module');
            }

        } catch (error) {
            console.error('❌ [ExportManager] splitPDF - ERROR:', error.message);
            console.error('❌ [ExportManager] Error details:', error);
            throw error;
        }
    }

    /**
     * Extract pages from PDF
     * @param {string} filePath - Path to PDF file
     * @param {number[]} pages - Page numbers to extract (1-indexed)
     * @param {string} outputPath - Output file path
     * @returns {Promise<string>} Path to new PDF with extracted pages
     */
    async extractPages(filePath, pages, outputPath = null) {
        console.log(`✂️ [ExportManager] extractPages - START`, {
            filePath,
            pages,
            pageCount: pages.length,
            outputPath
        });

        try {
            // All features enabled by default
            if (this.isNativeAvailable) {
                // Convert to 0-indexed
                const pageIndices = pages.map(p => p - 1);
                
                console.log('📱 [ExportManager] Calling native PDFExporter.extractPages...');
                console.log('📱 [ExportManager] Parameters:', {
                    pageIndices,
                    outputPath: outputPath || 'auto-generated'
                });
                
                const extractedPath = await PDFExporter.extractPages(filePath, pageIndices, outputPath);
                
                console.log('✅ [ExportManager] extractPages - SUCCESS', {
                    extractedPath
                });
                return extractedPath;
            } else {
                console.error('❌ [ExportManager] PDF page extraction requires native module');
                throw new Error('PDF page extraction requires native module');
            }

        } catch (error) {
            console.error('❌ [ExportManager] extractPages - ERROR:', error.message);
            console.error('❌ [ExportManager] Error details:', error);
            throw error;
        }
    }

    /**
     * Rotate pages in PDF
     * @param {string} filePath - Path to PDF file
     * @param {Object} rotations - Map of page number to rotation degrees
     * @param {string} outputPath - Output file path
     * @returns {Promise<string>} Path to rotated PDF
     */
    async rotatePages(filePath, rotations, outputPath = null) {
        console.log('📤 ExportManager: Rotating pages...');

        try {
            if (this.isNativeAvailable) {
                const rotatedPath = await PDFExporter.rotatePages(filePath, rotations, outputPath);
                console.log('📤 ExportManager: Rotated PDF saved to:', rotatedPath);
                return rotatedPath;
            } else {
                throw new Error('PDF rotation requires native module');
            }

        } catch (error) {
            console.error('📤 ExportManager: Rotate pages error:', error);
            throw error;
        }
    }

    /**
     * Delete pages from PDF
     * @param {string} filePath - Path to PDF file
     * @param {number[]} pages - Page numbers to delete (1-indexed)
     * @param {string} outputPath - Output file path
     * @returns {Promise<string>} Path to new PDF
     */
    async deletePages(filePath, pages, outputPath = null) {
        console.log(`📤 ExportManager: Deleting ${pages.length} pages...`);

        try {
            if (this.isNativeAvailable) {
                // Convert to 0-indexed
                const pageIndices = pages.map(p => p - 1);
                const newPath = await PDFExporter.deletePages(filePath, pageIndices, outputPath);
                console.log('📤 ExportManager: New PDF saved to:', newPath);
                return newPath;
            } else {
                throw new Error('PDF page deletion requires native module');
            }

        } catch (error) {
            console.error('📤 ExportManager: Delete pages error:', error);
            throw error;
        }
    }

    // ============================================
    // SHARE FUNCTIONALITY
    // ============================================

    /**
     * Share exported content
     * @param {string} content - Content to share (file path or text)
     * @param {Object} options - Share options
     * @returns {Promise<Object>} Share result
     */
    async share(content, options = {}) {
        const {
            title = 'Exported from PDF',
            message = null,
            url = null,
            type = 'text' // 'text', 'file'
        } = options;

        try {
            const shareOptions = {
                title
            };

            if (type === 'text') {
                shareOptions.message = content;
            } else if (type === 'file') {
                shareOptions.url = Platform.OS === 'ios' ? content : `file://${content}`;
                shareOptions.message = message;
            }

            const result = await Share.share(shareOptions);
            console.log('📤 ExportManager: Share result:', result);
            return result;

        } catch (error) {
            console.error('📤 ExportManager: Share error:', error);
            throw error;
        }
    }

    /**
     * Export and share text
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Export options
     * @returns {Promise<Object>} Share result
     */
    async exportAndShareText(filePath, options = {}) {
        try {
            const text = await this.exportToText(filePath, options);
            return await this.share(text, {
                title: 'PDF Text Export',
                type: 'text'
            });
        } catch (error) {
            console.error('📤 ExportManager: Export and share text error:', error);
            throw error;
        }
    }

    /**
     * Export and share image
     * @param {string} filePath - Path to PDF file
     * @param {number} pageNumber - Page number (1-indexed)
     * @param {Object} options - Export options
     * @returns {Promise<Object>} Share result
     */
    async exportAndShareImage(filePath, pageNumber, options = {}) {
        try {
            const imagePath = await this.exportPageToImage(filePath, pageNumber, options);
            return await this.share(imagePath, {
                title: `PDF Page ${pageNumber}`,
                type: 'file'
            });
        } catch (error) {
            console.error('📤 ExportManager: Export and share image error:', error);
            throw error;
        }
    }

    // ============================================
    // BATCH OPERATIONS
    // ============================================

    /**
     * Export multiple pages to images with progress
     * @param {string} filePath - Path to PDF file
     * @param {number[]} pages - Page numbers (1-indexed)
     * @param {Object} options - Export options
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Array>} Array of image paths
     */
    async exportPagesToImages(filePath, pages, options = {}, onProgress = null) {
        console.log(`🖼️ [ExportManager] exportPagesToImages - START`, {
            filePath,
            pages,
            pageCount: pages.length,
            options
        });

        const imagePaths = [];
        
        try {
            for (let i = 0; i < pages.length; i++) {
                const pageNum = pages[i];
                
                console.log(`📊 [ExportManager] Exporting page ${i + 1}/${pages.length} (page number: ${pageNum})`);
                
                const imagePath = await this.exportPageToImage(filePath, pageNum, options);
                imagePaths.push(imagePath);

                console.log(`✅ [ExportManager] Page ${pageNum} exported to: ${imagePath}`);

                if (onProgress) {
                    onProgress(i + 1, pages.length, imagePath);
                }
            }

            console.log(`✅ [ExportManager] exportPagesToImages - SUCCESS - Batch export complete: ${imagePaths.length} images`);
            return imagePaths;

        } catch (error) {
            console.error('❌ [ExportManager] exportPagesToImages - ERROR:', error.message);
            console.error('❌ [ExportManager] Error details:', error);
            throw error;
        }
    }

    /**
     * Export pages to text with progress
     * @param {string} filePath - Path to PDF file
     * @param {number[]} pages - Page numbers (1-indexed)
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Map>} Map of page to text
     */
    async exportPagesToText(filePath, pages, onProgress = null) {
        console.log(`📤 ExportManager: Batch exporting ${pages.length} pages to text...`);

        try {
            // Convert to 0-indexed
            const pageIndices = pages.map(p => p - 1);
            
            const textMap = await PDFTextExtractor.extractTextFromPages(filePath, pageIndices);

            if (onProgress) {
                onProgress(textMap.size, pages.length);
            }

            return textMap;

        } catch (error) {
            console.error('📤 ExportManager: Batch text export error:', error);
            throw error;
        }
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Get export capabilities
     * @returns {Object} Capabilities object
     */
    getCapabilities() {
        return {
            exportToText: PDFTextExtractor.isTextExtractionAvailable(),
            exportToImages: this.isNativeAvailable,
            mergePDFs: this.isNativeAvailable,
            splitPDF: this.isNativeAvailable,
            extractPages: this.isNativeAvailable,
            rotatePages: this.isNativeAvailable,
            deletePages: this.isNativeAvailable,
            ocrViaPDFText: true,
            share: true // Share API is always available
        };
    }

    /**
     * Get module information
     * @returns {Object} Module info
     */
    getModuleInfo() {
        return {
            isAvailable: this.isNativeAvailable,
            platform: Platform.OS,
            version: PDFExporter?.VERSION || 'N/A',
            capabilities: this.getCapabilities()
        };
    }

    /**
     * Estimate export time
     * @param {number} pageCount - Number of pages to export
     * @param {string} format - Export format
     * @returns {Object} Time estimate
     */
    estimateExportTime(pageCount, format = ExportFormat.TEXT) {
        let msPerPage;

        switch (format) {
            case ExportFormat.TEXT:
                msPerPage = 80; // Text extraction avg
                break;
            case ExportFormat.JPEG:
            case ExportFormat.PNG:
                msPerPage = 200; // Image rendering avg
                break;
            default:
                msPerPage = 100;
        }

        const totalMs = pageCount * msPerPage;
        const seconds = Math.round(totalMs / 1000);

        return {
            milliseconds: totalMs,
            seconds,
            formatted: seconds < 60 
                ? `${seconds} seconds`
                : `${Math.round(seconds / 60)} minutes`
        };
    }

    // ============================================
    // FALLBACK METHODS
    // ============================================

    /**
     * Fallback image export (if native not available)
     */
    async exportToImagesFallback(filePath, options) {
        console.warn('📤 ExportManager: Using fallback image export');
        console.warn('📤 Note: Fallback export has limitations');
        
        // In a real implementation, this could use:
        // 1. Screenshot-based export
        // 2. Canvas-based rendering
        // 3. Server-side conversion
        
        throw new Error('Native export module required for image export');
    }
}

// Create singleton instance
const exportManager = new ExportManager();

export default exportManager;

