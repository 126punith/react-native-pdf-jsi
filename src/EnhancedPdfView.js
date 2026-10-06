/**
 * Copyright (c) 2025-present, Enhanced PDF View with JSI
 * All rights reserved.
 * 
 * Enhanced PDF View component that automatically uses JSI when available
 * Falls back to traditional bridge-based operations when JSI is not available
 */

import React, { Component } from 'react';
import { Platform, Alert } from 'react-native';
import Pdf from '../index';
import PDFJSI, { openPdf } from './PDFJSI';

export default class EnhancedPdfView extends Component {
    constructor(props) {
        super(props);
        
        this.state = {
            isJSIAvailable: false,
            jsiInitialized: false,
            pdfData: null,
            renderMode: 'bridge' // 'bridge' or 'jsi'
        };
        
        this.initializeJSI();
    }
    
    /**
     * Initialize JSI availability check
     */
    async initializeJSI() {
        try {
            if (Platform.OS === 'android') {
                const isAvailable = await PDFJSI.checkJSIAvailability();
                this.setState({ 
                    isJSIAvailable: isAvailable,
                    jsiInitialized: true,
                    renderMode: isAvailable ? 'jsi' : 'bridge'
                });
                
                if (isAvailable) {
                    console.log('📱 EnhancedPdfView: JSI mode enabled - High performance mode active');
                } else {
                    console.log('📱 EnhancedPdfView: Bridge mode - Standard performance mode');
                }
            } else {
                this.setState({ 
                    isJSIAvailable: false,
                    jsiInitialized: true,
                    renderMode: 'bridge'
                });
                console.log('📱 EnhancedPdfView: iOS detected - Using bridge mode');
            }
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error initializing JSI:', error);
            this.setState({ 
                isJSIAvailable: false,
                jsiInitialized: true,
                renderMode: 'bridge'
            });
        }
    }
    
    sourcePath() {
        const { source } = this.props;
        if (typeof source === 'string') {
            return source;
        }
        if (source && typeof source.uri === 'string') {
            return source.uri;
        }
        throw new Error('A file path is required. Open the PDF with openPdf(path) before reading it.');
    }

    async ensureOpen() {
        const path = this.sourcePath();
        await openPdf(path);
        return path;
    }

    /**
     * Render PDF page using JSI (high-performance)
     */
    async renderPageWithJSI(pageNumber, scale = 1.0) {
        if (!this.state.isJSIAvailable) {
            throw new Error('JSI not available');
        }
        
        try {
            const path = await this.ensureOpen();
            const result = await PDFJSI.renderPageDirect(path, pageNumber, scale);
            
            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || 'Failed to render page');
            }
            
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI render error:', error);
            throw error;
        }
    }
    
    /**
     * Get page metrics using JSI
     */
    async getPageMetricsWithJSI(pageNumber) {
        if (!this.state.isJSIAvailable) {
            throw new Error('JSI not available');
        }
        
        try {
            const path = await this.ensureOpen();
            return PDFJSI.getPageMetrics(path, pageNumber);
            
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI metrics error:', error);
            throw error;
        }
    }
    
    /**
     * Preload pages using JSI
     */
    async preloadPagesWithJSI(startPage, endPage) {
        if (!this.state.isJSIAvailable) {
            throw new Error('JSI not available');
        }
        
        try {
            const path = await this.ensureOpen();
            const success = await PDFJSI.preloadPagesDirect(path, startPage, endPage);
            
            if (success) {
                console.log(`📱 EnhancedPdfView: Preloaded pages ${startPage}-${endPage} via JSI`);
            } else {
                throw new Error('Failed to preload pages');
            }
            
            return success;
            
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI preload error:', error);
            throw error;
        }
    }
    
    /**
     * Search text using JSI
     */
    async searchTextWithJSI(searchTerm, startPage = 1, endPage = 10) {
        if (!this.state.isJSIAvailable) {
            throw new Error('JSI not available');
        }
        
        try {
            const path = await this.ensureOpen();
            const results = await PDFJSI.searchTextDirect(path, searchTerm, startPage, endPage);
            
            console.log(`📱 EnhancedPdfView: Found ${results.length} matches for '${searchTerm}' via JSI`);
            return results;
            
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI search error:', error);
            throw error;
        }
    }
    
    /**
     * Get performance metrics
     */
    async getPerformanceMetrics() {
        try {
            const path = await this.ensureOpen();
            const metrics = PDFJSI.getPerformanceMetrics(path);
            return metrics;
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error getting performance metrics:', error);
            return null;
        }
    }
    
    /**
     * Get JSI statistics
     */
    async getJSIStats() {
        try {
            const stats = await PDFJSI.getJSIStats();
            return stats;
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error getting JSI stats:', error);
            return null;
        }
    }
    
    /**
     * Clear cache
     */
    async clearCache(cacheType = 'all') {
        try {
            const path = await this.ensureOpen();
            const success = PDFJSI.clearCacheDirect(path);
            
            if (success) {
                console.log(`📱 EnhancedPdfView: Cache cleared successfully (${cacheType})`);
            }
            
            return success;
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error clearing cache:', error);
            return false;
        }
    }
    
    /**
     * Optimize memory
     */
    async optimizeMemory() {
        try {
            const path = await this.ensureOpen();
            const success = PDFJSI.optimizeMemory(path);
            
            if (success) {
                console.log('📱 EnhancedPdfView: Memory optimized successfully');
            }
            
            return success;
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error optimizing memory:', error);
            return false;
        }
    }
    
    /**
     * Set render quality
     */
    async setRenderQuality(quality) {
        try {
            const path = await this.ensureOpen();
            const success = PDFJSI.setRenderQuality(path, quality);
            
            if (success) {
                console.log(`📱 EnhancedPdfView: Render quality set to ${quality}`);
            }
            
            return success;
        } catch (error) {
            console.error('📱 EnhancedPdfView: Error setting render quality:', error);
            return false;
        }
    }
    
    /**
     * Show performance information
     */
    showPerformanceInfo = async () => {
        try {
            const stats = await this.getJSIStats();
            const metrics = await this.getPerformanceMetrics();
            
            const message = `Render Mode: ${this.state.renderMode.toUpperCase()}\n` +
                          `JSI Available: ${this.state.isJSIAvailable ? 'Yes' : 'No'}\n` +
                          `Performance Level: ${stats?.performanceLevel || 'Standard'}\n` +
                          `Direct Memory Access: ${stats?.directMemoryAccess ? 'Yes' : 'No'}`;
            
            Alert.alert('Enhanced PDF Performance', message);
        } catch (error) {
            Alert.alert('Performance Info', `Render Mode: ${this.state.renderMode.toUpperCase()}\nJSI Available: ${this.state.isJSIAvailable ? 'Yes' : 'No'}`);
        }
    };
    
    /**
     * Lazy load pages for large PDF files
     */
    lazyLoadPages = async (currentPage, preloadRadius = 3, totalPages = null) => {
        try {
            const path = await this.ensureOpen();
            const result = await PDFJSI.lazyLoadPages(path, currentPage, preloadRadius, totalPages);
            
            if (result.success) {
                console.log(`📱 EnhancedPdfView: Lazy loaded pages around ${currentPage} via JSI`);
            }
            
            return result;
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI lazy load error:', error);
            throw error;
        }
    };
    
    /**
     * Progressive loading for large PDF files
     */
    progressiveLoadPages = async (startPage = 1, batchSize = 5, onProgress = null) => {
        try {
            const path = await this.ensureOpen();
            const result = await PDFJSI.progressiveLoadPages(path, startPage, batchSize, onProgress);
            
            console.log(`📱 EnhancedPdfView: Progressive loaded ${result.totalLoaded} pages via JSI`);
            return result;
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI progressive load error:', error);
            throw error;
        }
    };
    
    /**
     * Smart caching for frequently accessed pages
     */
    smartCacheFrequentPages = async (frequentPages = []) => {
        try {
            const path = await this.ensureOpen();
            const result = await PDFJSI.smartCacheFrequentPages(path, frequentPages);
            
            console.log(`📱 EnhancedPdfView: Smart cached ${result.successfulCaches}/${result.totalPages} frequent pages via JSI`);
            return result;
        } catch (error) {
            console.error('📱 EnhancedPdfView: JSI smart cache error:', error);
            throw error;
        }
    };
    
    render() {
        const { isJSIAvailable, jsiInitialized, renderMode } = this.state;
        
        // Add JSI-specific props to the PDF component
        const enhancedProps = {
            ...this.props,
            // Add JSI-specific props that can be used by the native component
            jsiEnabled: isJSIAvailable,
            renderMode: renderMode,
            // Add performance tracking props
            enablePerformanceTracking: true,
            // Add cache optimization props
            enableSmartCaching: isJSIAvailable,
        };
        
        return (
            <Pdf 
                {...enhancedProps}
                ref={this.props.pdfRef}
            />
        );
    }
}

// Export additional utilities
export const EnhancedPdfUtils = {
    /**
     * Check if JSI is available
     */
    async isJSIAvailable() {
        try {
            return await PDFJSI.checkJSIAvailability();
        } catch (error) {
            return false;
        }
    },
    
    /**
     * Get performance benchmark
     */
    async getPerformanceBenchmark() {
        try {
            const stats = await PDFJSI.getJSIStats();
            const history = PDFJSI.getPerformanceHistory();
            
            return {
                jsiAvailable: stats?.jsiEnabled || false,
                performanceLevel: stats?.performanceLevel || 'Standard',
                directMemoryAccess: stats?.directMemoryAccess || false,
                bridgeOptimized: stats?.bridgeOptimized || false,
                operationHistory: history
            };
        } catch (error) {
            return {
                jsiAvailable: false,
                performanceLevel: 'Standard',
                directMemoryAccess: false,
                bridgeOptimized: false,
                operationHistory: []
            };
        }
    },
    
    /**
     * Clear all caches
     */
    async clearAllCaches(path) {
        try {
            await openPdf(path);
            return PDFJSI.clearCacheDirect(path);
        } catch (error) {
            return false;
        }
    },
    
    /**
     * Optimize all memory
     */
    async optimizeAllMemory(path) {
        try {
            await openPdf(path);
            return PDFJSI.optimizeMemory(path);
        } catch (error) {
            return false;
        }
    }
};