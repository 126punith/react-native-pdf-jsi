package org.wonday.pdf;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.lang.reflect.Method;

/**
 * On-device OCR that is not a React Native module. ML Kit is optional; when the
 * dependency is absent, {@link #isAvailable()} is false and recognize throws.
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

    public static String recognizePage(String filePath, int pageIndex, boolean fast) throws Exception {
        if (!isAvailable()) {
            throw new IllegalStateException("OCR is disabled. Set pdfJsiEnableOcr=true and rebuild.");
        }
        String path = filePath != null && filePath.startsWith("file://")
            ? filePath.substring("file://".length())
            : filePath;
        if (path == null || path.isEmpty()) {
            throw new IllegalArgumentException("File path is required");
        }
        ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(new File(path), ParcelFileDescriptor.MODE_READ_ONLY);
        Bitmap bitmap = null;
        try (PdfRenderer renderer = new PdfRenderer(descriptor)) {
            descriptor = null;
            if (pageIndex < 0 || pageIndex >= renderer.getPageCount()) {
                throw new IndexOutOfBoundsException("Page index out of range: " + pageIndex);
            }
            PdfRenderer.Page page = renderer.openPage(pageIndex);
            try {
                float scale = fast ? 1.5f : (200f / 72f);
                int width = Math.max(1, Math.round(page.getWidth() * scale));
                int height = Math.max(1, Math.round(page.getHeight() * scale));
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                canvas.drawColor(Color.WHITE);
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            } finally {
                page.close();
            }
        } finally {
            if (descriptor != null) {
                descriptor.close();
            }
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
        Class<?> imageClass = Class.forName("com.google.mlkit.vision.common.InputImage");
        Method fromBitmap = imageClass.getMethod("fromBitmap", Bitmap.class, int.class);
        Object image = fromBitmap.invoke(null, bitmap, 0);
        Method process = recognizer.getClass().getMethod("process", imageClass);
        Object task = process.invoke(recognizer, image);
        Class<?> tasks = Class.forName("com.google.android.gms.tasks.Tasks");
        Object text = tasks.getMethod("await", Class.forName("com.google.android.gms.tasks.Task")).invoke(null, task);
        Object value = text.getClass().getMethod("getText").invoke(text);
        recognizer.getClass().getMethod("close").invoke(recognizer);
        return value == null ? "" : value.toString();
    }
}
