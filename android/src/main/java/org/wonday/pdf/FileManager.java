package org.wonday.pdf;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * FileManager - Native module for file operations like opening folders
 */
public class FileManager extends ReactContextBaseJavaModule implements ActivityEventListener {
    private static final String TAG = "FileManager";
    private static final String FOLDER_NAME = "PDFDemoApp";
    private static final int PICK_PDF_REQUEST = 47291;
    private final ReactApplicationContext reactContext;
    private Promise pickPromise;

    public FileManager(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        reactContext.addActivityEventListener(this);
    }

    @Override
    public String getName() {
        return "FileManager";
    }

    /**
     * Open the Downloads/PDFDemoApp folder in the file manager
     * Multiple fallback strategies for maximum compatibility
     */
    @ReactMethod
    public void openDownloadsFolder(Promise promise) {
        try {
            Log.i(TAG, "📂 [OPEN FOLDER] Attempting to open Downloads/" + FOLDER_NAME);
            
            // Strategy 1: Try to open specific Downloads/PDFDemoApp folder
            try {
                Intent specificIntent = new Intent(Intent.ACTION_VIEW);
                Uri folderUri = Uri.parse("content://com.android.externalstorage.documents/document/primary:Download/" + FOLDER_NAME);
                specificIntent.setDataAndType(folderUri, "resource/folder");
                specificIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                
                if (specificIntent.resolveActivity(reactContext.getPackageManager()) != null) {
                    reactContext.startActivity(specificIntent);
                    Log.i(TAG, "✅ [OPEN FOLDER] Opened specific folder via DocumentsUI");
                    promise.resolve(true);
                    return;
                }
            } catch (Exception e) {
                Log.i(TAG, "📂 [OPEN FOLDER] Strategy 1 failed, trying fallback...");
            }
            
            // Strategy 2: Open Downloads app
            try {
                Log.i(TAG, "📂 [OPEN FOLDER] Trying Downloads app");
                Intent downloadsIntent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
                downloadsIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                
                if (downloadsIntent.resolveActivity(reactContext.getPackageManager()) != null) {
                    reactContext.startActivity(downloadsIntent);
                    Log.i(TAG, "✅ [OPEN FOLDER] Opened Downloads app");
                    promise.resolve(true);
                    return;
                }
            } catch (Exception e) {
                Log.i(TAG, "📂 [OPEN FOLDER] Strategy 2 failed, trying fallback...");
            }
            
            // Strategy 3: Open Files app with generic CATEGORY_APP_FILES intent
            try {
                Log.i(TAG, "📂 [OPEN FOLDER] Trying Files app");
                Intent filesIntent = new Intent(Intent.ACTION_VIEW);
                filesIntent.addCategory(Intent.CATEGORY_DEFAULT);
                filesIntent.setType("resource/folder");
                filesIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                
                if (filesIntent.resolveActivity(reactContext.getPackageManager()) != null) {
                    reactContext.startActivity(filesIntent);
                    Log.i(TAG, "✅ [OPEN FOLDER] Opened Files app");
                    promise.resolve(true);
                    return;
                }
            } catch (Exception e) {
                Log.i(TAG, "📂 [OPEN FOLDER] Strategy 3 failed");
            }
            
            // Strategy 4: Try to launch any file manager using generic intent
            try {
                Log.i(TAG, "📂 [OPEN FOLDER] Trying generic file manager");
                Intent genericIntent = new Intent(Intent.ACTION_GET_CONTENT);
                genericIntent.setType("*/*");
                genericIntent.addCategory(Intent.CATEGORY_OPENABLE);
                genericIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                
                if (genericIntent.resolveActivity(reactContext.getPackageManager()) != null) {
                    reactContext.startActivity(Intent.createChooser(genericIntent, "Open File Manager"));
                    Log.i(TAG, "✅ [OPEN FOLDER] Opened file picker");
                    promise.resolve(true);
                    return;
                }
            } catch (Exception e) {
                Log.i(TAG, "📂 [OPEN FOLDER] Strategy 4 failed");
            }
            
            // All strategies failed
            Log.w(TAG, "⚠️ [OPEN FOLDER] All strategies failed - no file manager available");
            promise.reject("NO_FILE_MANAGER", "No file manager app available on this device");
            
        } catch (Exception e) {
            Log.e(TAG, "❌ [OPEN FOLDER] ERROR", e);
            promise.reject("OPEN_FOLDER_ERROR", e.getMessage());
        }
    }

    /**
     * Check if a file exists at the given path
     */
    @ReactMethod
    public void fileExists(String filePath, Promise promise) {
        long startTime = System.currentTimeMillis();
        try {
            Log.i(TAG, "[PERF] [fileExists] 🔵 ENTER - path: " + filePath);
            
            long validationStart = System.currentTimeMillis();
            if (filePath == null || filePath.trim().isEmpty()) {
                Log.e(TAG, "[PERF] [fileExists] ❌ Invalid path (empty)");
                promise.reject("INVALID_PATH", "File path cannot be empty");
                return;
            }
            long validationTime = System.currentTimeMillis() - validationStart;
            Log.i(TAG, "[PERF] [fileExists]   Validation: " + validationTime + "ms");
            
            long fileAccessStart = System.currentTimeMillis();
            File file = new File(filePath);
            boolean exists = file.exists();
            long fileAccessTime = System.currentTimeMillis() - fileAccessStart;
            
            long totalTime = System.currentTimeMillis() - startTime;
            
            Log.i(TAG, "[PERF] [fileExists]   File Access: " + fileAccessTime + "ms");
            Log.i(TAG, "[PERF] [fileExists]   Result: " + exists);
            Log.i(TAG, "[PERF] [fileExists] 🔴 EXIT - Total: " + totalTime + "ms");
            
            promise.resolve(exists);
        } catch (Exception e) {
            long totalTime = System.currentTimeMillis() - startTime;
            Log.e(TAG, "[PERF] [fileExists] ❌ ERROR after " + totalTime + "ms", e);
            promise.reject("FILE_EXISTS_ERROR", e.getMessage());
        }
    }

    /**
     * Get file size and metadata
     */
    @ReactMethod
    public void getFileSize(String filePath, Promise promise) {
        long startTime = System.currentTimeMillis();
        try {
            Log.i(TAG, "[PERF] [getFileSize] 🔵 ENTER");
            Log.i(TAG, "[PERF] [getFileSize]   Path: " + filePath);
            Log.i(TAG, "[PERF] [getFileSize]   Path length: " + (filePath != null ? filePath.length() : 0));
            
            long fileCreateStart = System.currentTimeMillis();
            File file = new File(filePath);
            long fileCreateTime = System.currentTimeMillis() - fileCreateStart;
            Log.i(TAG, "[PERF] [getFileSize]   File object creation: " + fileCreateTime + "ms");
            
            long existsCheckStart = System.currentTimeMillis();
            boolean exists = file.exists();
            long existsCheckTime = System.currentTimeMillis() - existsCheckStart;
            Log.i(TAG, "[PERF] [getFileSize]   Exists check: " + existsCheckTime + "ms, result: " + exists);
            
            if (!exists) {
                long totalTime = System.currentTimeMillis() - startTime;
                Log.w(TAG, "[PERF] [getFileSize] ⚠️ File not found after " + totalTime + "ms");
                promise.reject("FILE_NOT_FOUND", "File does not exist: " + filePath);
                return;
            }
            
            long sizeCheckStart = System.currentTimeMillis();
            long sizeBytes = file.length();
            long sizeCheckTime = System.currentTimeMillis() - sizeCheckStart;
            double sizeMB = sizeBytes / (1024.0 * 1024.0);
            Log.i(TAG, "[PERF] [getFileSize]   Size retrieval: " + sizeCheckTime + "ms");
            Log.i(TAG, "[PERF] [getFileSize]   Size: " + sizeBytes + " bytes (" + String.format("%.2f", sizeMB) + " MB)");
            
            long resultBuildStart = System.currentTimeMillis();
            WritableMap result = Arguments.createMap();
            result.putString("size", String.valueOf(sizeBytes));
            result.putDouble("sizeMB", sizeMB);
            result.putString("path", filePath);
            result.putBoolean("exists", true);
            long resultBuildTime = System.currentTimeMillis() - resultBuildStart;
            Log.i(TAG, "[PERF] [getFileSize]   Result build: " + resultBuildTime + "ms");
            
            long totalTime = System.currentTimeMillis() - startTime;
            Log.i(TAG, "[PERF] [getFileSize] 🔴 EXIT - Total: " + totalTime + "ms");
            Log.i(TAG, "[PERF] [getFileSize]   Breakdown: create=" + fileCreateTime + "ms, exists=" + existsCheckTime + "ms, size=" + sizeCheckTime + "ms, build=" + resultBuildTime + "ms");
            
            promise.resolve(result);
        } catch (Exception e) {
            long totalTime = System.currentTimeMillis() - startTime;
            Log.e(TAG, "[PERF] [getFileSize] ❌ ERROR after " + totalTime + "ms", e);
            Log.e(TAG, "[PERF] [getFileSize]   Exception type: " + e.getClass().getName());
            Log.e(TAG, "[PERF] [getFileSize]   Message: " + e.getMessage());
            promise.reject("FILE_SIZE_ERROR", e.getMessage());
        }
    }

    /**
     * Open the system picker and copy the chosen PDF into app files.
     */
    @ReactMethod
    public void pickPdf(Promise promise) {
        Activity activity = reactContext.getCurrentActivity();
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity");
            return;
        }
        if (pickPromise != null) {
            promise.reject("PICK_IN_PROGRESS", "A PDF picker is already open");
            return;
        }
        pickPromise = promise;
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/pdf");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivityForResult(intent, PICK_PDF_REQUEST);
        } catch (Exception e) {
            pickPromise = null;
            Log.e(TAG, "Failed to open PDF picker", e);
            promise.reject("PICK_FAILED", e.getMessage());
        }
    }

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_PDF_REQUEST || pickPromise == null) {
            return;
        }
        Promise promise = pickPromise;
        pickPromise = null;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            promise.reject("PICK_CANCELLED", "PDF selection was cancelled");
            return;
        }
        try {
            String path = copyPickedPdf(data.getData());
            Log.i(TAG, "Picked PDF copied to " + path);
            promise.resolve(path);
        } catch (Exception e) {
            Log.e(TAG, "Failed to copy picked PDF", e);
            promise.reject("PICK_COPY_FAILED", e.getMessage());
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
    }

    @Override
    public void onUserLeaveHint(Activity activity) {
    }

    private String copyPickedPdf(Uri uri) throws IOException {
        File dest = new File(reactContext.getFilesDir(), "merge-picked-" + System.currentTimeMillis() + ".pdf");
        try (InputStream in = reactContext.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) {
                throw new IOException("Unable to open selected PDF");
            }
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
        return dest.getAbsolutePath();
    }
}


