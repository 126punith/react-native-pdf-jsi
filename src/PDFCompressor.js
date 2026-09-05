/**
 * PDFCompressor - PDF Compression Manager
 * Handles PDF file compression with streaming support for large files
 * 
 * Uses native StreamingPDFProcessor for page-at-a-time PDF-aware recompression
 * (downsample + JPEG rebuild). Processes one page at a time to bound memory.
 * 
 * @author Punith M
 * @version 1.0.0
 */

import { NativeModules, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

const { PDFExporter, StreamingPDFProcessor } = NativeModules;

/**
 * Compression presets for different use cases
 */
export const CompressionPreset = {
    /** Optimized for email attachments (high compression, smaller file) */
    EMAIL: 'email',
    /** Optimized for web viewing (balanced compression) */
    WEB: 'web',
    /** Optimized for mobile devices (good compression, fast decompression) */
    MOBILE: 'mobile',
    /** Optimized for printing (low compression, high quality) */
    PRINT: 'print',
    /** Optimized for long-term archival (maximum compression) */
    ARCHIVE: 'archive',
    /** Custom compression settings */
    CUSTOM: 'custom'
};

/**
 * Compression levels (0-9, higher = more compression but slower)
 */
export const CompressionLevel = {
    NONE: 0,
    FASTEST: 1,
    FAST: 3,
    BALANCED: 5,
    DEFAULT: 6,
    GOOD: 7,
    BETTER: 8,
    BEST: 9
};

/**
 * Preset configurations
 */
const PRESET_CONFIGS = {
    [CompressionPreset.EMAIL]: {
        level: CompressionLevel.BEST,
        targetSizeKB: 10000, // 10MB target
        description: 'Maximum compression for email attachments'
    },
    [CompressionPreset.WEB]: {
        level: CompressionLevel.GOOD,
        targetSizeKB: 50000, // 50MB target
        description: 'Balanced compression for web delivery'
    },
    [CompressionPreset.MOBILE]: {
        level: CompressionLevel.BALANCED,
        targetSizeKB: 25000, // 25MB target
        description: 'Optimized for mobile viewing'
    },
    [CompressionPreset.PRINT]: {
        level: CompressionLevel.FAST,
        targetSizeKB: null, // No size limit
        description: 'Low compression for print quality'
    },
    [CompressionPreset.ARCHIVE]: {
        level: CompressionLevel.BEST,
        targetSizeKB: null, // No size limit, just maximum compression
        description: 'Maximum compression for archival'
    }
};

/**
 * PDFCompressor Class
 * Provides PDF compression functionality with streaming support
 */
export class PDFCompressor {
    constructor() {
        this.isNativeAvailable = this._checkNativeAvailability();
        
        if (this.isNativeAvailable) {
            console.log('📦 PDFCompressor: Native streaming compression available');
        } else {
            console.warn('📦 PDFCompressor: Native module not available - compression may be limited');
        }
    }

    /**
     * Check if native compression module is available
     * @private
     * @returns {boolean} True if native module is available
     */
    _checkNativeAvailability() {
        // Check if PDFExporter module exists and has the compressPDF method
        const hasCompressPDF = PDFExporter && typeof PDFExporter.compressPDF === 'function';
        console.log('📦 PDFCompressor: Checking native availability...');
        console.log('📦 PDFCompressor: PDFExporter exists:', !!PDFExporter);
        console.log('📦 PDFCompressor: PDFExporter.compressPDF exists:', hasCompressPDF);
        return hasCompressPDF;
    }

    /**
     * Check if compression is available
     * @returns {boolean} True if compression functionality is available
     */
    isAvailable() {
        return this.isNativeAvailable;
    }

    /**
     * Get compression capabilities
     * @returns {Object} Capabilities object
     */
    getCapabilities() {
        return {
            streamingCompression: this.isNativeAvailable,
            pdfAwareRecompression: this.isNativeAvailable,
            presets: Object.values(CompressionPreset),
            maxFileSizeMB: this.isNativeAvailable ? 1024 : 100, // large files OK with page-at-a-time processing
            supportedPlatforms: ['ios', 'android'],
            currentPlatform: Platform.OS,
            nativeModuleAvailable: this.isNativeAvailable,
            note: 'Recompression rasterizes pages (text becomes image). Level controls scale + JPEG quality.'
        };
    }

    /**
     * Get preset configuration
     * @param {string} preset - Preset name from CompressionPreset
     * @returns {Object} Preset configuration
     */
    getPresetConfig(preset) {
        return PRESET_CONFIGS[preset] || PRESET_CONFIGS[CompressionPreset.WEB];
    }

    /**
     * Compress a PDF file
     * @param {string} inputPath - Path to input PDF file
     * @param {Object} options - Compression options
     * @param {string} options.preset - Compression preset (from CompressionPreset)
     * @param {number} options.level - Compression level (0-9), overrides preset
     * @param {string} options.outputPath - Output file path (optional, auto-generated if not provided)
     * @param {Function} options.onProgress - Progress callback function
     * @returns {Promise<Object>} Compression result
     */
    async compress(inputPath, options = {}) {
        const {
            preset = CompressionPreset.WEB,
            level = null,
            outputPath = null,
            onProgress = null
        } = options;

        console.log(`📦 PDFCompressor: Starting compression with preset '${preset}'`);

        // Validate input file exists
        const fileExists = await this._fileExists(inputPath);
        if (!fileExists) {
            throw new Error(`Input file not found: ${inputPath}`);
        }

        // Get file size
        const inputStats = await this._getFileStats(inputPath);
        const inputSizeMB = inputStats.size / (1024 * 1024);
        
        console.log(`📦 PDFCompressor: Input file size: ${inputSizeMB.toFixed(2)} MB`);

        // Determine compression level
        const presetConfig = this.getPresetConfig(preset);
        const compressionLevel = level !== null ? level : presetConfig.level;

        // Generate output path if not provided
        const finalOutputPath = outputPath || this._generateOutputPath(inputPath);

        // Perform compression
        const startTime = Date.now();
        let result;

        if (this.isNativeAvailable) {
            result = await this._compressNative(inputPath, finalOutputPath, compressionLevel, onProgress);
        } else {
            result = await this._compressFallback(inputPath, finalOutputPath, compressionLevel, onProgress);
        }

        const duration = Date.now() - startTime;

        // Get output file stats
        const outputStats = await this._getFileStats(finalOutputPath);
        const outputSizeMB = outputStats.size / (1024 * 1024);
        const compressionRatio = inputStats.size > 0 ? outputStats.size / inputStats.size : 1;
        const spaceSavedPercent = (1 - compressionRatio) * 100;
        const throughputMBps = duration > 0 ? (inputSizeMB / (duration / 1000)) : 0;

        const compressionResult = {
            success: true,
            inputPath,
            outputPath: finalOutputPath,
            originalSize: inputStats.size,
            compressedSize: outputStats.size,
            originalSizeMB: inputSizeMB,
            compressedSizeMB: outputSizeMB,
            compressionRatio,
            spaceSavedPercent,
            durationMs: duration,
            throughputMBps,
            preset,
            compressionLevel,
            method: this.isNativeAvailable ? 'native_pdf_recompress' : 'fallback'
        };

        console.log(`📦 PDFCompressor: Compression complete!`);
        console.log(`   📊 ${inputSizeMB.toFixed(2)} MB → ${outputSizeMB.toFixed(2)} MB (${spaceSavedPercent.toFixed(1)}% saved)`);
        console.log(`   ⏱️ ${duration}ms (${throughputMBps.toFixed(1)} MB/s)`);

        return compressionResult;
    }

    /**
     * Compress PDF with a specific preset
     * @param {string} inputPath - Path to input PDF file
     * @param {string} preset - Compression preset
     * @param {string} outputPath - Output file path (optional)
     * @returns {Promise<Object>} Compression result
     */
    async compressWithPreset(inputPath, preset, outputPath = null) {
        return this.compress(inputPath, { preset, outputPath });
    }

    /**
     * Compress PDF for email (maximum compression)
     * @param {string} inputPath - Path to input PDF file
     * @param {string} outputPath - Output file path (optional)
     * @returns {Promise<Object>} Compression result
     */
    async compressForEmail(inputPath, outputPath = null) {
        return this.compress(inputPath, { 
            preset: CompressionPreset.EMAIL, 
            outputPath 
        });
    }

    /**
     * Compress PDF for web viewing
     * @param {string} inputPath - Path to input PDF file
     * @param {string} outputPath - Output file path (optional)
     * @returns {Promise<Object>} Compression result
     */
    async compressForWeb(inputPath, outputPath = null) {
        return this.compress(inputPath, { 
            preset: CompressionPreset.WEB, 
            outputPath 
        });
    }

    /**
     * Compress PDF for mobile viewing
     * @param {string} inputPath - Path to input PDF file
     * @param {string} outputPath - Output file path (optional)
     * @returns {Promise<Object>} Compression result
     */
    async compressForMobile(inputPath, outputPath = null) {
        return this.compress(inputPath, { 
            preset: CompressionPreset.MOBILE, 
            outputPath 
        });
    }

    /**
     * Compress PDF for archival (maximum compression)
     * @param {string} inputPath - Path to input PDF file
     * @param {string} outputPath - Output file path (optional)
     * @returns {Promise<Object>} Compression result
     */
    async compressForArchive(inputPath, outputPath = null) {
        return this.compress(inputPath, { 
            preset: CompressionPreset.ARCHIVE, 
            outputPath 
        });
    }

    /**
     * Estimate compression result without actually compressing
     * @param {string} inputPath - Path to input PDF file
     * @param {string} preset - Compression preset
     * @returns {Promise<Object>} Estimated compression result
     */
    async estimateCompression(inputPath, preset = CompressionPreset.WEB) {
        const fileExists = await this._fileExists(inputPath);
        if (!fileExists) {
            throw new Error(`Input file not found: ${inputPath}`);
        }

        const inputStats = await this._getFileStats(inputPath);
        const inputSizeMB = inputStats.size / (1024 * 1024);
        const presetConfig = this.getPresetConfig(preset);

        // Native recompresses pages (downsample + JPEG). Savings depend on content:
        // image-heavy PDFs often see large reductions; text/vector PDFs may see little
        // and keep the original if recompression is not smaller.
        const level = presetConfig.level;
        const estimatedRatio = Math.max(0.35, 1 - (level / 9) * 0.55);
        const estimatedSize = inputStats.size * estimatedRatio;
        const estimatedSizeMB = estimatedSize / (1024 * 1024);
        const estimatedSavingsPercent = (1 - estimatedRatio) * 100;

        // Page rasterization is slower than a byte copy
        const msPerMB = this.isNativeAvailable ? 180 : 100;
        const estimatedTimeMs = inputSizeMB * msPerMB;

        return {
            inputPath,
            originalSize: inputStats.size,
            originalSizeMB: inputSizeMB,
            estimatedCompressedSize: estimatedSize,
            estimatedCompressedSizeMB: estimatedSizeMB,
            estimatedCompressionRatio: estimatedRatio,
            estimatedSavingsPercent,
            estimatedDurationMs: estimatedTimeMs,
            preset,
            presetDescription: presetConfig.description,
            confidence: 'medium',
            note: 'Estimates assume image-heavy PDFs. Higher presets downsample and JPEG-encode pages; text-only PDFs may save little. Output remains a valid PDF.'
        };
    }

    /**
     * Native compression using PDFExporter.compressPDF
     * @private
     */
    async _compressNative(inputPath, outputPath, compressionLevel, onProgress) {
        console.log(`📦 PDFCompressor: Using native PDF recompression (level: ${compressionLevel})`);

        try {
            // Use PDFExporter.compressPDF - the main native compression method
            if (PDFExporter && typeof PDFExporter.compressPDF === 'function') {
                console.log('📦 PDFCompressor: Calling PDFExporter.compressPDF...');
                const result = await PDFExporter.compressPDF(
                    inputPath, 
                    outputPath, 
                    compressionLevel
                );
                console.log('📦 PDFCompressor: Native compression result:', result);
                return result;
            } else {
                // Native module not available - use fallback
                console.warn('📦 PDFCompressor: PDFExporter.compressPDF not available, using fallback');
                console.warn('📦 PDFCompressor: PDFExporter available:', !!PDFExporter);
                console.warn('📦 PDFCompressor: PDFExporter.compressPDF:', PDFExporter ? typeof PDFExporter.compressPDF : 'N/A');
                return this._compressFallback(inputPath, outputPath, compressionLevel, onProgress);
            }
        } catch (error) {
            console.error('📦 PDFCompressor: Native compression failed:', error);
            throw error;
        }
    }

    /**
     * Fallback compression (file copy with potential optimization)
     * @private
     */
    async _compressFallback(inputPath, outputPath, compressionLevel, onProgress) {
        console.log('📦 PDFCompressor: Using fallback compression (limited functionality)');

        try {
            // For fallback, we simply copy the file
            // Real compression requires native code
            await ReactNativeBlobUtil.fs.cp(inputPath, outputPath);

            if (onProgress) {
                onProgress({
                    progress: 1.0,
                    bytesProcessed: 0,
                    totalBytes: 0
                });
            }

            console.warn('📦 PDFCompressor: Fallback mode - file copied without compression');
            console.warn('📦 PDFCompressor: For actual compression, ensure native module is properly linked');

            return {
                success: true,
                method: 'fallback_copy',
                note: 'Native compression not available - file was copied without compression'
            };
        } catch (error) {
            console.error('📦 PDFCompressor: Fallback compression failed:', error);
            throw error;
        }
    }

    /**
     * Check if file exists
     * @private
     */
    async _fileExists(filePath) {
        try {
            return await ReactNativeBlobUtil.fs.exists(filePath);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get file statistics
     * @private
     */
    async _getFileStats(filePath) {
        try {
            const stats = await ReactNativeBlobUtil.fs.stat(filePath);
            return {
                size: parseInt(stats.size, 10),
                lastModified: stats.lastModified,
                path: stats.path
            };
        } catch (error) {
            console.error('📦 PDFCompressor: Failed to get file stats:', error);
            return { size: 0, lastModified: 0, path: filePath };
        }
    }

    /**
     * Generate output path based on input path
     * @private
     */
    _generateOutputPath(inputPath) {
        const timestamp = Date.now();
        const baseName = inputPath.replace(/\.pdf$/i, '');
        return `${baseName}_compressed_${timestamp}.pdf`;
    }

    /**
     * Delete a compressed file
     * @param {string} filePath - Path to file to delete
     * @returns {Promise<boolean>} Success status
     */
    async deleteCompressedFile(filePath) {
        try {
            const exists = await this._fileExists(filePath);
            if (exists) {
                await ReactNativeBlobUtil.fs.unlink(filePath);
                console.log(`📦 PDFCompressor: Deleted file: ${filePath}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('📦 PDFCompressor: Failed to delete file:', error);
            return false;
        }
    }

    /**
     * Get module information
     * @returns {Object} Module info
     */
    getModuleInfo() {
        return {
            name: 'PDFCompressor',
            version: '1.0.0',
            platform: Platform.OS,
            nativeAvailable: this.isNativeAvailable,
            presets: Object.keys(CompressionPreset),
            compressionLevels: Object.keys(CompressionLevel),
            capabilities: this.getCapabilities()
        };
    }
}

// Create singleton instance
const pdfCompressor = new PDFCompressor();

export default pdfCompressor;
