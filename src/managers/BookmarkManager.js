/**
 * BookmarkManager - Smart Bookmark Management System
 * Handles bookmark CRUD operations and reading progress tracking
 * 
 * LICENSE:
 * - Basic bookmarks (CRUD): MIT License (Free)
 * - Enhanced features (colors, analytics): Commercial License (Paid)
 * 
 * @author Punith M
 * @version 1.0.0
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@react-native-pdf-jsi/bookmarks';
const PROGRESS_KEY = '@react-native-pdf-jsi/progress';

/**
 * BookmarkManager Class
 */
export class BookmarkManager {
    constructor() {
        this.bookmarks = new Map();
        this.progress = new Map();
        this.initialized = false;
    }

    /**
     * Initialize bookmark manager
     * Load bookmarks and progress from AsyncStorage
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Load bookmarks
            const bookmarksData = await AsyncStorage.getItem(STORAGE_KEY);
            if (bookmarksData) {
                const parsed = JSON.parse(bookmarksData);
                this.bookmarks = new Map(Object.entries(parsed));
                console.log(`📚 BookmarkManager: Loaded ${this.bookmarks.size} PDF bookmarks`);
            }

            // Load progress
            const progressData = await AsyncStorage.getItem(PROGRESS_KEY);
            if (progressData) {
                const parsed = JSON.parse(progressData);
                this.progress = new Map(Object.entries(parsed));
                console.log(`📊 BookmarkManager: Loaded progress for ${this.progress.size} PDFs`);
            }

            this.initialized = true;
        } catch (error) {
            console.error('📚 BookmarkManager: Initialization error:', error);
            throw error;
        }
    }

    /**
     * Save bookmarks to AsyncStorage
     */
    async saveBookmarks() {
        try {
            const data = Object.fromEntries(this.bookmarks);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('📚 BookmarkManager: Bookmarks saved');
        } catch (error) {
            console.error('📚 BookmarkManager: Save error:', error);
            throw error;
        }
    }

    /**
     * Save progress to AsyncStorage
     */
    async saveProgress() {
        try {
            const data = Object.fromEntries(this.progress);
            await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
            console.log('📊 BookmarkManager: Progress saved');
        } catch (error) {
            console.error('📊 BookmarkManager: Progress save error:', error);
            throw error;
        }
    }

    /**
     * Create a bookmark
     * @param {string} pdfId - PDF identifier
     * @param {Object} bookmark - Bookmark data
     * @returns {Promise<Object>} Created bookmark
     */
    async createBookmark(pdfId, bookmark) {
        await this.initialize();

        // All features enabled by default

        const newBookmark = {
            id: this.generateId(),
            pdfId,
            page: bookmark.page,
            name: bookmark.name || `Page ${bookmark.page}`,
            color: bookmark.color || '#000000', // Default to black (free), colors require Pro
            notes: bookmark.notes || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Get or create bookmarks array for this PDF
        const pdfBookmarks = this.bookmarks.get(pdfId) || [];
        pdfBookmarks.push(newBookmark);
        this.bookmarks.set(pdfId, pdfBookmarks);

        await this.saveBookmarks();
        
        console.log(`📚 BookmarkManager: Created bookmark for ${pdfId} page ${bookmark.page}`);
        return newBookmark;
    }

    /**
     * Get all bookmarks for a PDF
     * @param {string} pdfId - PDF identifier
     * @returns {Promise<Array>} Array of bookmarks
     */
    async getBookmarks(pdfId) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        return [...bookmarks].sort((a, b) => a.page - b.page);
    }

    /**
     * Get bookmark by ID
     * @param {string} pdfId - PDF identifier
     * @param {string} bookmarkId - Bookmark ID
     * @returns {Promise<Object|null>} Bookmark or null
     */
    async getBookmark(pdfId, bookmarkId) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        return bookmarks.find(b => b.id === bookmarkId) || null;
    }

    /**
     * Update a bookmark
     * @param {string} pdfId - PDF identifier
     * @param {string} bookmarkId - Bookmark ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Updated bookmark
     */
    async updateBookmark(pdfId, bookmarkId, updates) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        const index = bookmarks.findIndex(b => b.id === bookmarkId);
        
        if (index === -1) {
            throw new Error(`Bookmark ${bookmarkId} not found`);
        }

        const updatedBookmark = {
            ...bookmarks[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        bookmarks[index] = updatedBookmark;
        this.bookmarks.set(pdfId, bookmarks);

        await this.saveBookmarks();
        
        console.log(`📚 BookmarkManager: Updated bookmark ${bookmarkId}`);
        return updatedBookmark;
    }

    /**
     * Delete a bookmark
     * @param {string} pdfId - PDF identifier
     * @param {string} bookmarkId - Bookmark ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteBookmark(pdfId, bookmarkId) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        const filtered = bookmarks.filter(b => b.id !== bookmarkId);
        
        if (filtered.length === bookmarks.length) {
            return false; // Bookmark not found
        }

        this.bookmarks.set(pdfId, filtered);
        await this.saveBookmarks();
        
        console.log(`📚 BookmarkManager: Deleted bookmark ${bookmarkId}`);
        return true;
    }

    /**
     * Delete all bookmarks for a PDF
     * @param {string} pdfId - PDF identifier
     * @returns {Promise<number>} Number of bookmarks deleted
     */
    async deleteAllBookmarks(pdfId) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        const count = bookmarks.length;
        
        this.bookmarks.delete(pdfId);
        await this.saveBookmarks();
        
        console.log(`📚 BookmarkManager: Deleted ${count} bookmarks for ${pdfId}`);
        return count;
    }

    /**
     * Get bookmarks by page
     * @param {string} pdfId - PDF identifier
     * @param {number} page - Page number
     * @returns {Promise<Array>} Bookmarks on that page
     */
    async getBookmarksOnPage(pdfId, page) {
        await this.initialize();
        
        const bookmarks = this.bookmarks.get(pdfId) || [];
        return bookmarks.filter(b => b.page === page);
    }

    /**
     * Check if page has bookmark
     * @param {string} pdfId - PDF identifier
     * @param {number} page - Page number
     * @returns {Promise<boolean>} True if page has bookmark
     */
    async hasBookmarkOnPage(pdfId, page) {
        const bookmarks = await this.getBookmarksOnPage(pdfId, page);
        return bookmarks.length > 0;
    }

    // ============================================
    // READING PROGRESS TRACKING
    // ============================================

    /**
     * Update reading progress
     * @param {string} pdfId - PDF identifier
     * @param {Object} progressData - Progress data
     */
    async updateProgress(pdfId, progressData) {
        await this.initialize();

        // All features enabled by default

        const currentProgress = this.progress.get(pdfId) || {
            pdfId,
            currentPage: 1,
            totalPages: progressData.totalPages || 0,
            pagesRead: [],
            timeSpent: 0,
            sessions: 0,
            lastRead: null,
            createdAt: new Date().toISOString()
        };

        // Update progress
        const updatedProgress = {
            ...currentProgress,
            currentPage: progressData.currentPage || currentProgress.currentPage,
            totalPages: progressData.totalPages || currentProgress.totalPages,
            lastRead: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Track unique pages read
        if (progressData.currentPage && !currentProgress.pagesRead.includes(progressData.currentPage)) {
            updatedProgress.pagesRead = [...currentProgress.pagesRead, progressData.currentPage].sort((a, b) => a - b);
        }

        // Track time spent
        if (progressData.timeSpent) {
            updatedProgress.timeSpent = currentProgress.timeSpent + progressData.timeSpent;
        }

        // Track sessions
        if (progressData.newSession) {
            updatedProgress.sessions = currentProgress.sessions + 1;
        }

        this.progress.set(pdfId, updatedProgress);
        await this.saveProgress();

        return updatedProgress;
    }

    /**
     * Get reading progress
     * @param {string} pdfId - PDF identifier
     * @returns {Promise<Object>} Progress data
     */
    async getProgress(pdfId) {
        await this.initialize();
        
        const progress = this.progress.get(pdfId);
        
        if (!progress) {
            return {
                pdfId,
                currentPage: 1,
                totalPages: 0,
                pagesRead: [],
                percentage: 0,
                timeSpent: 0,
                sessions: 0,
                lastRead: null
            };
        }

        // Calculate percentage
        const percentage = progress.totalPages > 0 
            ? (progress.pagesRead.length / progress.totalPages) * 100 
            : 0;

        return {
            ...progress,
            percentage: Math.round(percentage)
        };
    }

    /**
     * Get all reading progress
     * @returns {Promise<Array>} Array of progress for all PDFs
     */
    async getAllProgress() {
        await this.initialize();
        
        const allProgress = [];
        for (const [pdfId, progress] of this.progress.entries()) {
            const percentage = progress.totalPages > 0 
                ? (progress.pagesRead.length / progress.totalPages) * 100 
                : 0;
            
            allProgress.push({
                ...progress,
                percentage: Math.round(percentage)
            });
        }

        return allProgress.sort((a, b) => 
            new Date(b.lastRead) - new Date(a.lastRead)
        );
    }

    /**
     * Delete reading progress
     * @param {string} pdfId - PDF identifier
     * @returns {Promise<boolean>} Success status
     */
    async deleteProgress(pdfId) {
        await this.initialize();
        
        const existed = this.progress.has(pdfId);
        this.progress.delete(pdfId);
        
        if (existed) {
            await this.saveProgress();
            console.log(`📊 BookmarkManager: Deleted progress for ${pdfId}`);
        }
        
        return existed;
    }

    /**
     * Get statistics for a PDF
     * @param {string} pdfId - PDF identifier
     * @returns {Promise<Object>} Statistics
     */
    async getStatistics(pdfId) {
        await this.initialize();
        
        const bookmarks = await this.getBookmarks(pdfId);
        const progress = await this.getProgress(pdfId);

        return {
            totalBookmarks: bookmarks.length,
            pagesWithBookmarks: [...new Set(bookmarks.map(b => b.page))].length,
            currentPage: progress.currentPage,
            totalPages: progress.totalPages,
            pagesRead: progress.pagesRead.length,
            percentage: progress.percentage,
            timeSpent: progress.timeSpent,
            sessions: progress.sessions,
            lastRead: progress.lastRead,
            avgTimePerPage: progress.pagesRead.length > 0 
                ? Math.round(progress.timeSpent / progress.pagesRead.length) 
                : 0
        };
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Generate unique ID
     * @returns {string} Unique ID
     */
    generateId() {
        return `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export bookmarks and progress
     * @param {string} pdfId - PDF identifier (optional, exports all if not provided)
     * @returns {Promise<Object>} Export data
     */
    async exportData(pdfId = null) {
        await this.initialize();

        if (pdfId) {
            return {
                bookmarks: await this.getBookmarks(pdfId),
                progress: await this.getProgress(pdfId),
                exportedAt: new Date().toISOString()
            };
        }

        // Export all
        const allBookmarks = Object.fromEntries(this.bookmarks);
        const allProgress = await this.getAllProgress();

        return {
            bookmarks: allBookmarks,
            progress: allProgress,
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Import bookmarks and progress
     * @param {Object} data - Import data
     * @returns {Promise<Object>} Import summary
     */
    async importData(data) {
        await this.initialize();

        let bookmarksImported = 0;
        let progressImported = 0;

        try {
            // Import bookmarks
            if (data.bookmarks) {
                if (typeof data.bookmarks === 'object' && !Array.isArray(data.bookmarks)) {
                    // Import all PDFs
                    for (const [pdfId, bookmarks] of Object.entries(data.bookmarks)) {
                        this.bookmarks.set(pdfId, bookmarks);
                        bookmarksImported += bookmarks.length;
                    }
                }
                await this.saveBookmarks();
            }

            // Import progress
            if (data.progress) {
                if (Array.isArray(data.progress)) {
                    data.progress.forEach(p => {
                        this.progress.set(p.pdfId, p);
                        progressImported++;
                    });
                } else if (typeof data.progress === 'object') {
                    this.progress.set(data.progress.pdfId, data.progress);
                    progressImported++;
                }
                await this.saveProgress();
            }

            console.log(`📚 BookmarkManager: Imported ${bookmarksImported} bookmarks and ${progressImported} progress entries`);

            return {
                success: true,
                bookmarksImported,
                progressImported
            };

        } catch (error) {
            console.error('📚 BookmarkManager: Import error:', error);
            throw error;
        }
    }

    /**
     * Clear all data (use with caution!)
     */
    async clearAll() {
        this.bookmarks.clear();
        this.progress.clear();
        await AsyncStorage.multiRemove([STORAGE_KEY, PROGRESS_KEY]);
        console.log('📚 BookmarkManager: All data cleared');
    }

    /**
     * Get storage size estimate
     * @returns {Promise<Object>} Size information
     */
    async getStorageSize() {
        await this.initialize();

        const bookmarksBytes = utf8ByteLength(JSON.stringify(Object.fromEntries(this.bookmarks)));
        const progressBytes = utf8ByteLength(JSON.stringify(Object.fromEntries(this.progress)));

        return {
            bookmarks: {
                count: Array.from(this.bookmarks.values()).flat().length,
                sizeKB: Math.round(bookmarksBytes / 1024)
            },
            progress: {
                count: this.progress.size,
                sizeKB: Math.round(progressBytes / 1024)
            },
            totalKB: Math.round((bookmarksBytes + progressBytes) / 1024)
        };
    }
}

function utf8ByteLength(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) {
            bytes += 1;
        } else if (code < 0x800) {
            bytes += 2;
        } else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

// Create singleton instance
const bookmarkManager = new BookmarkManager();

export default bookmarkManager;

