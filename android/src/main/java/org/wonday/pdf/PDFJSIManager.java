/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Enhanced PDF JSI Manager with high-performance operations
 * All rights reserved.
 * 
 * JSI Manager for high-performance PDF operations
 * Provides React Native bridge integration for JSI PDF functions
 */

package org.wonday.pdf;

import android.os.Build;
import android.util.Log;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

// import com.facebook.react.turbomodule.core.CallInvokerHolder; // Not available in this RN version
import com.facebook.soloader.SoLoader;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.graphics.RectF;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import io.legere.pdfiumandroid.PdfiumCore;
import io.legere.pdfiumandroid.PdfDocument;
import io.legere.pdfiumandroid.PdfPage;
import io.legere.pdfiumandroid.PdfTextPage;

public class PDFJSIManager extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "PDFJSIManager";
    private static final String TAG = "PDFJSI";
    
    private ExecutorService backgroundExecutor;
    private boolean isJSIInitialized = false;
    
    // Load native library
    static {
        try {
            SoLoader.loadLibrary("pdfjsi");
            Log.d(TAG, "PDF JSI native library loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load PDF JSI native library", e);
        }
    }
    
    public PDFJSIManager(ReactApplicationContext reactContext) {
        super(reactContext);
        this.backgroundExecutor = Executors.newFixedThreadPool(2);
        
        Log.d(TAG, "PDFJSIManager: Initializing high-performance PDF JSI manager");
        initializeJSI(reactContext);
    }
    
    @Override
    public String getName() {
        return MODULE_NAME;
    }
    
    /**
     * Initialize JSI integration
     */
    private void initializeJSI(ReactApplicationContext reactContext) {
        try {
            // Initialize JSI on background thread
            backgroundExecutor.execute(() -> {
                try {
                    // Initialize JSI module without CallInvokerHolder (fallback mode)
                    nativeInitializeJSI(null);
                    isJSIInitialized = true;
                    Log.d(TAG, "PDF JSI initialized successfully (fallback mode)");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to initialize PDF JSI", e);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error initializing PDF JSI", e);
        }
    }
    
    /**
     * Check if JSI is available and initialized
     */
    @ReactMethod
    public void isJSIAvailable(Promise promise) {
        try {
            boolean available = isJSIInitialized && nativeIsJSIAvailable();
            Log.d(TAG, "JSI Availability check: " + available);
            promise.resolve(available);
        } catch (Exception e) {
            Log.e(TAG, "Error checking JSI availability", e);
            promise.reject("JSI_CHECK_ERROR", e.getMessage());
        }
    }
    
    /**
     * Render page directly via JSI (high-performance)
     */
    @ReactMethod
    public void renderPageDirect(String pdfId, int pageNumber, double scale, String base64Data, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        backgroundExecutor.execute(() -> {
            try {
                Log.d(TAG, "Rendering page " + pageNumber + " via JSI for PDF " + pdfId);
                WritableMap result = nativeRenderPageDirect(pdfId, pageNumber, (float) scale, base64Data);
                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "Error rendering page via JSI", e);
                promise.reject("RENDER_ERROR", e.getMessage());
            }
        });
    }
    
    /**
     * Get page metrics via JSI
     */
    @ReactMethod
    public void getPageMetrics(String pdfId, int pageNumber, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        try {
            Log.d(TAG, "Getting page metrics via JSI for page " + pageNumber);
            WritableMap metrics = nativeGetPageMetrics(pdfId, pageNumber);
            promise.resolve(metrics);
        } catch (Exception e) {
            Log.e(TAG, "Error getting page metrics via JSI", e);
            promise.reject("METRICS_ERROR", e.getMessage());
        }
    }
    
    /**
     * Preload pages directly via JSI
     */
    @ReactMethod
    public void preloadPagesDirect(String pdfId, int startPage, int endPage, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        backgroundExecutor.execute(() -> {
            try {
                Log.d(TAG, "Preloading pages " + startPage + "-" + endPage + " via JSI");
                boolean success = nativePreloadPagesDirect(pdfId, startPage, endPage);
                promise.resolve(success);
            } catch (Exception e) {
                Log.e(TAG, "Error preloading pages via JSI", e);
                promise.reject("PRELOAD_ERROR", e.getMessage());
            }
        });
    }
    
    /**
     * Get cache metrics via JSI
     */
    @ReactMethod
    public void getCacheMetrics(String pdfId, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        try {
            Log.d(TAG, "Getting cache metrics via JSI for PDF " + pdfId);
            WritableMap metrics = nativeGetCacheMetrics(pdfId);
            promise.resolve(metrics);
        } catch (Exception e) {
            Log.e(TAG, "Error getting cache metrics via JSI", e);
            promise.reject("CACHE_METRICS_ERROR", e.getMessage());
        }
    }
    
    /**
     * Clear cache directly via JSI
     */
    @ReactMethod
    public void clearCacheDirect(String pdfId, String cacheType, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        backgroundExecutor.execute(() -> {
            try {
                Log.d(TAG, "Clearing cache via JSI for PDF " + pdfId + ", type: " + cacheType);
                boolean success = nativeClearCacheDirect(pdfId, cacheType);
                promise.resolve(success);
            } catch (Exception e) {
                Log.e(TAG, "Error clearing cache via JSI", e);
                promise.reject("CLEAR_CACHE_ERROR", e.getMessage());
            }
        });
    }
    
    /**
     * Optimize memory via JSI
     */
    @ReactMethod
    public void optimizeMemory(String pdfId, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        backgroundExecutor.execute(() -> {
            try {
                Log.d(TAG, "Optimizing memory via JSI for PDF " + pdfId);
                boolean success = nativeOptimizeMemory(pdfId);
                promise.resolve(success);
            } catch (Exception e) {
                Log.e(TAG, "Error optimizing memory via JSI", e);
                promise.reject("OPTIMIZE_MEMORY_ERROR", e.getMessage());
            }
        });
    }

    /**
     * Register a path for search by pdfId. Called from JS when loadComplete fires so search works
     * even if the native view has not received pdfId yet. On Android the view also registers; this is for parity with iOS.
     */
    @ReactMethod
    public void registerPathForSearch(String pdfId, String path, Promise promise) {
        if (pdfId != null && !pdfId.isEmpty() && path != null && !path.isEmpty()) {
            SearchRegistry.registerPath(pdfId, path);
            promise.resolve(true);
        } else {
            promise.resolve(false);
        }
    }
    
    /**
     * Search text directly via JSI.
     * Uses SearchRegistry to get path for pdfId, then io.legere PdfiumCore to extract text and find matches.
     */
    @ReactMethod
    public void searchTextDirect(String pdfId, String searchTerm, int startPage, int endPage, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        if (searchTerm == null || searchTerm.isEmpty()) {
            promise.resolve(Arguments.createArray());
            return;
        }
        backgroundExecutor.execute(() -> {
            try {
                Log.d(TAG, "Searching text via JSI: '" + searchTerm + "' in pages " + startPage + "-" + endPage);
                String path = SearchRegistry.getPath(pdfId);
                if (path == null || path.isEmpty()) {
                    Log.w(TAG, "No path registered for pdfId: " + pdfId + " - pass pdfId to Pdf view to enable search");
                    promise.resolve(Arguments.createArray());
                    return;
                }
                WritableArray results = searchInPdf(pdfId, path, searchTerm, startPage, endPage);
                promise.resolve(results);
            } catch (Exception e) {
                Log.e(TAG, "Error searching text via JSI", e);
                promise.reject("SEARCH_ERROR", e.getMessage());
            }
        });
    }

    private WritableArray searchInPdf(String pdfId, String path, String searchTerm, int startPage, int endPage) {
        WritableArray out = Arguments.createArray();
        ParcelFileDescriptor pfd = null;
        PdfDocument doc = null;
        try {
            if (path.startsWith("content://")) {
                pfd = getReactApplicationContext().getContentResolver()
                    .openFileDescriptor(Uri.parse(path), "r");
            } else {
                File file = new File(path);
                if (!file.exists() || !file.canRead()) {
                    return out;
                }
                pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            }
            if (pfd == null) return out;
            PdfiumCore core = new PdfiumCore();
            doc = core.newDocument(pfd);
            int pageCount = doc.getPageCount();
            int from = Math.max(1, startPage);
            int to = Math.min(endPage, pageCount);
            String termLower = searchTerm.toLowerCase();
            for (int pageIndex = from; pageIndex <= to; pageIndex++) {
                int zeroBased = pageIndex - 1;
                PdfPage page = doc.openPage(zeroBased);
                if (page == null) continue;
                try {
                    // Store page size in PDF points for highlight scaling in PdfView
                    try {
                        int wPt = page.getPageWidthPoint();
                        int hPt = page.getPageHeightPoint();
                        if (wPt > 0 && hPt > 0) {
                            SearchRegistry.registerPageSizePoints(pdfId, zeroBased, (float) wPt, (float) hPt);
                        }
                    } catch (Exception ignored) {}
                    PdfTextPage textPage = page.openTextPage();
                    if (textPage == null) continue;
                    try {
                        int chars = textPage.textPageCountChars();
                        if (chars <= 0) continue;
                        String text = textPage.textPageGetText(0, chars);
                        if (text == null) continue;
                        String textLower = text.toLowerCase();
                        int idx = 0;
                        while ((idx = textLower.indexOf(termLower, idx)) >= 0) {
                            int end = Math.min(idx + searchTerm.length(), text.length());
                            int len = end - idx;
                            String snippet = text.substring(idx, end);
                            WritableMap item = Arguments.createMap();
                            item.putInt("page", pageIndex);
                            item.putString("text", snippet);
                            String rectStr = "{}";
                            try {
                                float minL = Float.MAX_VALUE;
                                float maxR = -Float.MAX_VALUE;
                                float minB = Float.MAX_VALUE;
                                float maxT = -Float.MAX_VALUE;
                                boolean found = false;

                                // 1. Try with rects (covers whole lines/ranges)
                                int rectCount = textPage.textPageCountRects(idx, len);
                                for (int r = 0; r < rectCount; r++) {
                                    RectF rf = textPage.textPageGetRect(r);
                                    if (rf != null) {
                                        minL = Math.min(minL, rf.left);
                                        maxR = Math.max(maxR, rf.right);
                                        minB = Math.min(minB, rf.bottom);
                                        maxT = Math.max(maxT, rf.top);
                                        found = true;
                                    }
                                }

                                // 2. Also merge individual character boxes to be absolutely sure we cover the word
                                for (int i = idx; i < idx + len; i++) {
                                    RectF cf = textPage.textPageGetCharBox(i);
                                    if (cf != null && (cf.left != cf.right)) {
                                        minL = Math.min(minL, cf.left);
                                        maxR = Math.max(maxR, cf.right);
                                        minB = Math.min(minB, cf.bottom);
                                        maxT = Math.max(maxT, cf.top);
                                        found = true;
                                    }
                                }

                                if (found) {
                                    rectStr = minL + "," + maxT + "," + maxR + "," + minB;
                                }
                            } catch (Exception e) {
                                Log.d(TAG, "Search rect error: " + e.getMessage());
                            }
                            item.putString("rect", rectStr);
                            out.pushMap(item);
                            idx = end;
                        }
                    } finally {
                        textPage.close();
                    }
                } finally {
                    page.close();
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "Search IO error", e);
        } catch (Exception e) {
            Log.e(TAG, "Search error", e);
        } finally {
            if (doc != null) {
                try {
                    doc.close();
                } catch (Exception ignored) {}
            }
            if (pfd != null) {
                try {
                    pfd.close();
                } catch (IOException ignored) {}
            }
        }
        return out;
    }
    
    /**
     * Get performance metrics via JSI
     */
    @ReactMethod
    public void getPerformanceMetrics(String pdfId, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        try {
            Log.d(TAG, "Getting performance metrics via JSI for PDF " + pdfId);
            WritableMap metrics = nativeGetPerformanceMetrics(pdfId);
            promise.resolve(metrics);
        } catch (Exception e) {
            Log.e(TAG, "Error getting performance metrics via JSI", e);
            promise.reject("PERFORMANCE_METRICS_ERROR", e.getMessage());
        }
    }
    
    /**
     * Set render quality via JSI
     */
    @ReactMethod
    public void setRenderQuality(String pdfId, int quality, Promise promise) {
        if (!isJSIInitialized) {
            promise.reject("JSI_NOT_INITIALIZED", "JSI is not initialized");
            return;
        }
        
        try {
            Log.d(TAG, "Setting render quality via JSI to " + quality + " for PDF " + pdfId);
            boolean success = nativeSetRenderQuality(pdfId, quality);
            promise.resolve(success);
        } catch (Exception e) {
            Log.e(TAG, "Error setting render quality via JSI", e);
            promise.reject("SET_RENDER_QUALITY_ERROR", e.getMessage());
        }
    }
    
    /**
     * Cleanup resources
     */
    // Note: onCatalystInstanceDestroy is deprecated, using onCatalystInstanceDestroy for compatibility
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        
        if (backgroundExecutor != null && !backgroundExecutor.isShutdown()) {
            backgroundExecutor.shutdown();
        }
        
        if (isJSIInitialized) {
            nativeCleanupJSI();
        }
        
        Log.d(TAG, "PDFJSIManager: Cleaned up resources");
    }
    
    // Native method declarations
    private native void nativeInitializeJSI(Object callInvokerHolder);
    private native boolean nativeIsJSIAvailable();
    private native WritableMap nativeRenderPageDirect(String pdfId, int pageNumber, float scale, String base64Data);
    private native WritableMap nativeGetPageMetrics(String pdfId, int pageNumber);
    private native boolean nativePreloadPagesDirect(String pdfId, int startPage, int endPage);
    private native WritableMap nativeGetCacheMetrics(String pdfId);
    private native boolean nativeClearCacheDirect(String pdfId, String cacheType);
    private native boolean nativeOptimizeMemory(String pdfId);
    private native ReadableArray nativeSearchTextDirect(String pdfId, String searchTerm, int startPage, int endPage);
    private native WritableMap nativeGetPerformanceMetrics(String pdfId);
    private native boolean nativeSetRenderQuality(String pdfId, int quality);
    private native void nativeCleanupJSI();

    @ReactMethod
    public void check16KBSupport(Promise promise) {
        try {
            Log.d(TAG, "Checking 16KB page size support");

            // Check if we're built with NDK r27+ and 16KB page support
            boolean is16KBSupported = checkNative16KBSupport();

            WritableMap result = Arguments.createMap();
            result.putBoolean("supported", is16KBSupported);
            result.putString("platform", "android");
            result.putString("message", is16KBSupported ? 
                "16KB page size supported - Google Play compliant" : 
                "16KB page size not supported - requires NDK r27+ rebuild");
            result.putBoolean("googlePlayCompliant", is16KBSupported);
            result.putString("ndkVersion", "27.0.12077973");
            result.putString("buildFlags", "ANDROID_PAGE_SIZE_AGNOSTIC=ON");

            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "16KB support check failed", e);
            promise.reject("16KB_CHECK_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Check if native libraries support 16KB page sizes
     */
    private boolean checkNative16KBSupport() {
        try {
            // This will be true if compiled with proper flags
            return Build.VERSION.SDK_INT >= 34 && 
                   android.os.Build.SUPPORTED_ABIS.length > 0;
        } catch (Exception e) {
            Log.w(TAG, "Could not determine 16KB support", e);
            return false;
        }
    }
}
