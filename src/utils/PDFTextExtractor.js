/**
 * PDFTextExtractor - Text Extraction from PDF Files
 *
 * Thin wrapper around PDFText (native Pdfium / PDFKit extraction).
 * Prefer PDFText.extract() for OCR / auto modes and custom engines.
 *
 * @author Punith M
 * @version 2.0.0
 */

import PDFText from '../PDFText';

/**
 * PDFTextExtractor Class
 */
class PDFTextExtractor {
    /**
     * Check if text extraction is available
     * @returns {boolean} True if text extraction is available
     */
    static isTextExtractionAvailable() {
        return PDFText.isAvailable();
    }

    /**
     * Extract text from a specific page
     * @param {string} filePath - Path to PDF file
     * @param {number} pageNumber - Page number (0-indexed)
     * @returns {Promise<string>} Extracted text content
     */
    static async extractTextFromPage(filePath, pageNumber) {
        if (!this.isTextExtractionAvailable()) {
            throw new Error('Native text extraction is not available');
        }
        return PDFText.extractTextFromPage(filePath, pageNumber);
    }

    /**
     * Extract text from multiple pages
     * @param {string} filePath - Path to PDF file
     * @param {Array<number>} pageIndices - Array of page indices (0-indexed)
     * @returns {Promise<Map<number, string>>} Map of page index to extracted text
     */
    static async extractTextFromPages(filePath, pageIndices) {
        if (!this.isTextExtractionAvailable()) {
            throw new Error('Native text extraction is not available');
        }
        return PDFText.extractTextFromPages(filePath, pageIndices);
    }

    /**
     * Extract text from all pages
     * @param {string} filePath - Path to PDF file
     * @returns {Promise<Map<number, string>>} Map of page index to extracted text
     */
    static async extractAllText(filePath) {
        if (!this.isTextExtractionAvailable()) {
            throw new Error('Native text extraction is not available');
        }
        return PDFText.extractAllText(filePath);
    }

    /**
     * Get page count
     * @param {string} filePath - Path to PDF file
     * @returns {Promise<number>} Number of pages
     */
    static async getPageCount(filePath) {
        if (!this.isTextExtractionAvailable()) {
            throw new Error('Native text extraction is not available');
        }
        return PDFText.getPageCount(filePath);
    }
}

export default PDFTextExtractor;
