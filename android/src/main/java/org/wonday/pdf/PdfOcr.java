package org.wonday.pdf;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.lang.reflect.Method;

/**
 * On-device OCR that is not a React Native module. ML Kit is optional; when the
 * dependency is absent, {@link #isAvailable()} is false and recognize throws.
 * Pages are rendered by PDFium first, so passwords and unsaved edits apply.
 */
public final class PdfOcr {
    private PdfOcr() {}

    public static boolean isAvailable() {
        try {
            Class.forName("com.google.mlkit.vision.text.TextRecognition");
            return true;
        } catch (ClassNotFoundException error) {
            return false;
        }
    }

    public static String recognizeImage(String imagePath) throws Exception {
        if (!isAvailable()) {
            throw new IllegalStateException("OCR is disabled. Set pdfJsiEnableOcr=true and rebuild.");
        }
        Bitmap bitmap = BitmapFactory.decodeFile(imagePath);
        if (bitmap == null) {
            throw new IllegalArgumentException("Could not decode " + imagePath);
        }
        try {
            return runMlKit(bitmap);
        } finally {
            bitmap.recycle();
        }
    }

    private static String runMlKit(Bitmap bitmap) throws Exception {
        Class<?> optionsClass = Class.forName("com.google.mlkit.vision.text.latin.TextRecognizerOptions");
        Object options = optionsClass.getField("DEFAULT_OPTIONS").get(null);
        Class<?> recognitionClass = Class.forName("com.google.mlkit.vision.text.TextRecognition");
        Method getClient = recognitionClass.getMethod("getClient", Class.forName("com.google.mlkit.vision.text.TextRecognizerOptionsInterface"));
        Object recognizer = getClient.invoke(null, options);
        try {
            Class<?> imageClass = Class.forName("com.google.mlkit.vision.common.InputImage");
            Method fromBitmap = imageClass.getMethod("fromBitmap", Bitmap.class, int.class);
            Object image = fromBitmap.invoke(null, bitmap, 0);
            Method process = recognizer.getClass().getMethod("process", imageClass);
            Object task = process.invoke(recognizer, image);
            Class<?> tasks = Class.forName("com.google.android.gms.tasks.Tasks");
            Object text = tasks.getMethod("await", Class.forName("com.google.android.gms.tasks.Task")).invoke(null, task);
            Object value = text.getClass().getMethod("getText").invoke(text);
            return value == null ? "" : value.toString();
        } finally {
            recognizer.getClass().getMethod("close").invoke(recognizer);
        }
    }
}
