/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Enhanced PDF JSI Hook with high-performance operations
 * All rights reserved.
 * 
 * React Hook for easy JSI integration in functional components
 * Provides automatic JSI availability detection and fallback handling
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import PDFJSI, { withPdfDocument } from '../PDFJSI';

/**
 * Hook for PDF JSI functionality
 * @param {Object} options - Configuration options
 * @returns {Object} JSI utilities and state
 */
export const usePDFJSI = (options = {}) => {
    const {
        autoInitialize = true,
        enablePerformanceTracking = true,
        enableCaching = true,
        maxCacheSize = 100
    } = options;
    
    // State management
    const [isJSIAvailable, setIsJSIAvailable] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [performanceMetrics, setPerformanceMetrics] = useState(null);
    const [jsiStats, setJsiStats] = useState(null);
    
    // Refs for tracking
    const pdfInstancesRef = useRef(new Map());
    const performanceHistoryRef = useRef([]);
    const mountedRef = useRef(true);

    const recordPerformance = useCallback((entry) => {
        const history = performanceHistoryRef.current;
        history.push(entry);
        if (history.length > maxCacheSize) {
            history.splice(0, history.length - maxCacheSize);
        }
    }, [maxCacheSize]);
    
    /**
     * Initialize JSI availability check
     */
    const initializeJSI = useCallback(async () => {
        try {
            // Enable JSI for both Android and iOS
            // iOS will get enhanced caching and performance optimizations
            if (Platform.OS === 'android') {
                // Android gets full JSI support
                const isAvailable = await PDFJSI.checkJSIAvailability();
                if (mountedRef.current) {
                    setIsJSIAvailable(isAvailable);
                    setIsInitialized(true);
                }
                return isAvailable;
            }
            // iOS gets enhanced caching support (bridge mode with optimizations)
            if (mountedRef.current) {
                setIsJSIAvailable(true); // Enable enhanced features for iOS
                setIsInitialized(true);
            }
            return true;
        } catch (error) {
            console.error('📱 usePDFJSI: Error initializing JSI:', error);
            if (mountedRef.current) {
                setIsJSIAvailable(false);
                setIsInitialized(true);
            }
            return false;
        }
    }, []);
    
    /**
     * Render page with JSI or fallback
     */
    const renderPage = useCallback(async (path, pageNumber, scale) => {
        const startTime = performance.now();
        
        try {
            if (isJSIAvailable) {
                const result = await PDFJSI.renderPageDirect(path, pageNumber, scale);
                
                const endTime = performance.now();
                const renderTime = endTime - startTime;
                
                // Track performance
                if (enablePerformanceTracking) {
                    recordPerformance({
                        operation: 'renderPage',
                        duration: renderTime,
                        timestamp: Date.now(),
                        pdfId: path,
                        pageNumber,
                        scale,
                        mode: 'JSI'
                    });
                }
                
                return result;
            } else {
                // Fallback to bridge mode (would need to implement)
                throw new Error('JSI not available and bridge fallback not implemented');
            }
        } catch (error) {
            const endTime = performance.now();
            const renderTime = endTime - startTime;
            
            if (enablePerformanceTracking) {
                recordPerformance({
                    operation: 'renderPage',
                    duration: renderTime,
                    timestamp: Date.now(),
                    pdfId: path,
                    pageNumber,
                    scale,
                    mode: 'JSI_ERROR',
                    error: error.message
                });
            }
            
            throw error;
        }
    }, [isJSIAvailable, enablePerformanceTracking, recordPerformance]);
    
    /**
     * Get page metrics
     */
    const getPageMetrics = useCallback(async (path, pageNumber) => {
        try {
            if (isJSIAvailable) {
                return await withPdfDocument(path, () => PDFJSI.getPageMetrics(path, pageNumber));
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error getting page metrics:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Preload pages
     */
    const preloadPages = useCallback(async (pdfId, startPage, endPage) => {
        try {
            if (isJSIAvailable) {
                return await PDFJSI.preloadPagesDirect(pdfId, startPage, endPage);
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error preloading pages:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Search text
     */
    const searchText = useCallback(async (pdfId, searchTerm, startPage, endPage) => {
        try {
            if (isJSIAvailable) {
                return await PDFJSI.searchTextDirect(pdfId, searchTerm, startPage, endPage);
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error searching text:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Get cache metrics
     */
    const getCacheMetrics = useCallback(async (path) => {
        try {
            if (isJSIAvailable) {
                return await withPdfDocument(path, () => PDFJSI.getCacheMetrics(path));
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error getting cache metrics:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Clear cache
     */
    const clearCache = useCallback(async (path) => {
        try {
            if (isJSIAvailable) {
                return await withPdfDocument(path, () => PDFJSI.clearCacheDirect(path));
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error clearing cache:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Optimize memory
     */
    const optimizeMemory = useCallback(async (path) => {
        try {
            if (isJSIAvailable) {
                return await withPdfDocument(path, () => PDFJSI.optimizeMemory(path));
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error optimizing memory:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Set render quality
     */
    const setRenderQuality = useCallback(async (path, quality) => {
        try {
            if (isJSIAvailable) {
                return await withPdfDocument(path, () => PDFJSI.setRenderQuality(path, quality));
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error setting render quality:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Update performance metrics
     */
    const updatePerformanceMetrics = useCallback(async (path) => {
        try {
            if (isJSIAvailable) {
                const metrics = await withPdfDocument(path, () => PDFJSI.getPerformanceMetrics(path));
                if (mountedRef.current) {
                    setPerformanceMetrics(metrics);
                }
                return metrics;
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error updating performance metrics:', error);
        }
        return null;
    }, [isJSIAvailable]);
    
    /**
     * Get performance history
     */
    const getPerformanceHistory = useCallback(() => {
        return [...performanceHistoryRef.current];
    }, []);
    
    /**
     * Clear performance history
     */
    const clearPerformanceHistory = useCallback(() => {
        performanceHistoryRef.current = [];
    }, []);
    
    /**
     * Create PDF instance with tracking
     */
    const createPDFInstance = useCallback((pdfId, options = {}) => {
        const instance = {
            id: pdfId,
            created: Date.now(),
            options,
            metrics: null,
            cacheMetrics: null
        };
        
        pdfInstancesRef.current.set(pdfId, instance);
        return instance;
    }, []);
    
    /**
     * Remove PDF instance
     */
    const removePDFInstance = useCallback((pdfId) => {
        pdfInstancesRef.current.delete(pdfId);
    }, []);
    
    /**
     * Get all PDF instances
     */
    const getPDFInstances = useCallback(() => {
        return Array.from(pdfInstancesRef.current.values());
    }, []);
    
    /**
     * Lazy load pages for large PDF files
     */
    const lazyLoadPages = useCallback(async (pdfId, currentPage, preloadRadius = 3, totalPages = null) => {
        try {
            if (isJSIAvailable) {
                return await PDFJSI.lazyLoadPages(pdfId, currentPage, preloadRadius, totalPages);
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error lazy loading pages:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Progressive loading for large PDF files
     */
    const progressiveLoadPages = useCallback(async (pdfId, startPage = 1, batchSize = 5, onProgress = null) => {
        try {
            if (isJSIAvailable) {
                return await PDFJSI.progressiveLoadPages(pdfId, startPage, batchSize, onProgress);
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error progressive loading pages:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    /**
     * Smart caching for frequently accessed pages
     */
    const smartCacheFrequentPages = useCallback(async (pdfId, frequentPages = []) => {
        try {
            if (isJSIAvailable) {
                return await PDFJSI.smartCacheFrequentPages(pdfId, frequentPages);
            } else {
                throw new Error('JSI not available');
            }
        } catch (error) {
            console.error('📱 usePDFJSI: Error smart caching pages:', error);
            throw error;
        }
    }, [isJSIAvailable]);
    
    // Initialize JSI on mount if autoInitialize is enabled
    useEffect(() => {
        if (autoInitialize && !isInitialized) {
            initializeJSI();
        }
    }, [autoInitialize, isInitialized, initializeJSI]);
    
    // Cleanup on unmount
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            pdfInstancesRef.current.clear();
            performanceHistoryRef.current = [];
        };
    }, []);
    
    return {
        // State
        isJSIAvailable,
        isInitialized,
        performanceMetrics,
        jsiStats,
        
        // Core functions
        renderPage,
        getPageMetrics,
        preloadPages,
        searchText,
        getCacheMetrics,
        clearCache,
        optimizeMemory,
        setRenderQuality,
        
        // Performance tracking
        updatePerformanceMetrics,
        getPerformanceHistory,
        clearPerformanceHistory,
        
        // Instance management
        createPDFInstance,
        removePDFInstance,
        getPDFInstances,
        
        // Lazy loading and advanced features
        lazyLoadPages,
        progressiveLoadPages,
        smartCacheFrequentPages,
        
        // Utilities
        initializeJSI
    };
};

export default usePDFJSI;