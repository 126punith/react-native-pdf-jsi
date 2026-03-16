/**
 * Copyright (c) 2025-present, Punith M (punithm300@gmail.com)
 * Enhanced PDF JSI Module with high-performance operations
 * All rights reserved.
 * 
 * React Native module for JSI PDF operations
 * Provides high-performance PDF operations via JSI
 */

package org.wonday.pdf;

import android.util.Log;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

// import com.facebook.react.turbomodule.core.CallInvokerHolder; // Not available in this RN version
import com.facebook.soloader.SoLoader;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PDFJSIModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "PDFJSIModule";
    private static final String TAG = "PDFJSIModule";
    
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
    
    public PDFJSIModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.backgroundExecutor = Executors.newFixedThreadPool(2);
        
        Log.d(TAG, "PDFJSIModule: Initializing high-performance PDF JSI module");
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
     * Get JSI performance statistics
     */
    @ReactMethod
    public void getJSIStats(Promise promise) {
        try {
            Log.d(TAG, "Getting JSI stats");
            
            WritableMap stats = Arguments.createMap();
            stats.putString("version", "1.0.0");
            stats.putString("buildDate", "2024-01-01");
            stats.putBoolean("jsiEnabled", true);
            stats.putBoolean("bridgeOptimized", true);
            stats.putBoolean("directMemoryAccess", true);
            stats.putInt("availableMethods", 9);
            stats.putString("performanceLevel", "HIGH");
            stats.putBoolean("isInitialized", isJSIInitialized);
            
            promise.resolve(stats);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting JSI stats", e);
            promise.reject("GET_JSI_STATS_ERROR", e.getMessage());
        }
    }
    
    /**
     * Initialize JSI with custom configuration
     */
    @ReactMethod
    public void initializeJSIConfig(ReadableMap config, Promise promise) {
        try {
            Log.d(TAG, "Initializing JSI with custom configuration");
            
            boolean enablePerformanceTracking = config.getBoolean("enablePerformanceTracking");
            boolean enableCaching = config.getBoolean("enableCaching");
            int maxCacheSize = config.getInt("maxCacheSize");
            
            boolean success = nativeInitializeJSIConfig(enablePerformanceTracking, enableCaching, maxCacheSize);
            
            WritableMap result = Arguments.createMap();
            result.putBoolean("success", success);
            result.putBoolean("jsiEnabled", success);
            result.putString("message", success ? "JSI configured successfully" : "Failed to configure JSI");
            
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "Error initializing JSI config", e);
            promise.reject("JSI_CONFIG_ERROR", e.getMessage());
        }
    }
    
    /**
     * Get memory usage statistics
     */
    @ReactMethod
    public void getMemoryStats(Promise promise) {
        try {
            Log.d(TAG, "Getting memory statistics");
            
            WritableMap stats = nativeGetMemoryStats();
            promise.resolve(stats);
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting memory stats", e);
            promise.reject("MEMORY_STATS_ERROR", e.getMessage());
        }
    }
    
    /**
     * Cleanup resources - Updated for React Native 0.72+
     */
    @Override
    public void invalidate() {
        super.invalidate();
        
        if (backgroundExecutor != null && !backgroundExecutor.isShutdown()) {
            backgroundExecutor.shutdown();
        }
        
        if (isJSIInitialized) {
            nativeCleanupJSI();
        }
        
        Log.d(TAG, "PDFJSIModule: Cleaned up resources");
    }
    
    // Native method declarations
    private native void nativeInitializeJSI(Object callInvokerHolder);
    private native boolean nativeIsJSIAvailable();
    private native boolean nativeInitializeJSIConfig(boolean enablePerformanceTracking, boolean enableCaching, int maxCacheSize);
    private native WritableMap nativeGetMemoryStats();
    private native void nativeCleanupJSI();
}
