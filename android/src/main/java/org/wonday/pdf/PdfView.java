/**
 * Copyright (c) 2017-present, Wonday (@wonday.org)
 * All rights reserved.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

package org.wonday.pdf;

import java.io.File;

import android.content.ContentResolver;
import android.content.Context;
import android.util.SizeF;
import android.view.View;
import android.view.ViewGroup;
import android.util.Log;
import android.net.Uri;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import android.os.Looper;

import io.legere.pdfiumandroid.util.Config;
import io.legere.pdfiumandroid.util.ConfigKt;
import io.legere.pdfiumandroid.util.AlreadyClosedBehavior;
import io.legere.pdfiumandroid.DefaultLogger;

import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.UIManagerHelper;
import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.listener.OnPageChangeListener;
import com.github.barteksc.pdfviewer.listener.OnLoadCompleteListener;
import com.github.barteksc.pdfviewer.listener.OnErrorListener;
import com.github.barteksc.pdfviewer.listener.OnTapListener;
import com.github.barteksc.pdfviewer.listener.OnDrawListener;
import com.github.barteksc.pdfviewer.listener.OnPageScrollListener;
import com.github.barteksc.pdfviewer.util.FitPolicy;
import com.github.barteksc.pdfviewer.util.Constants;
import com.github.barteksc.pdfviewer.link.LinkHandler;
import com.github.barteksc.pdfviewer.model.LinkTapEvent;

import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.uimanager.UIManagerModule;
import com.facebook.react.uimanager.events.EventDispatcher;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.RCTEventEmitter;


import static java.lang.String.format;

import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import com.google.gson.Gson;

import org.wonday.pdf.events.TopChangeEvent;

public class PdfView extends PDFView implements OnPageChangeListener,OnLoadCompleteListener,OnErrorListener,OnTapListener,OnDrawListener,OnPageScrollListener, LinkHandler {
    private int page = 1;               // start from 1
    /** While >= 1, ignore onPageChanged callbacks for other pages (stale events during jumpTo). #13 */
    private int programmaticTargetPage = -1;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable clearProgrammaticTargetRunnable = () -> programmaticTargetPage = -1;

    private void armProgrammaticJump(int targetPage) {
        programmaticTargetPage = targetPage;
        mainHandler.removeCallbacks(clearProgrammaticTargetRunnable);
        mainHandler.postDelayed(clearProgrammaticTargetRunnable, 500);
    }
    private boolean horizontal = false;
    private float scale = 1;
    private float minScale = 1;
    private float maxScale = 3;
    private String path;
    private int spacing = 10;
    private String password = "";
    private boolean enableAntialiasing = true;
    private boolean enableAnnotationRendering = true;
    private boolean enableDoubleTapZoom = true;

    private boolean enablePaging = false;
    private boolean autoSpacing = false;
    private boolean pageFling = false;
    private boolean pageSnap = false;
    private FitPolicy fitPolicy = FitPolicy.WIDTH;
    private boolean singlePage = false;
    private boolean scrollEnabled = true;
    private String pdfId = null;

    private String decelerationRate = "normal"; // "normal", "fast", "slow"

    private float originalWidth = 0;
    private float lastPageWidth = 0;
    
    // Track if document needs reload (FIX: Prevent recreation on prop changes)
    private boolean needsReload = true;
    private String lastLoadedPath = null;
    private float lastPageHeight = 0;
    private boolean loadCompleteDispatched = false;
    private int lastKnownPageCount = 0;

    // used to store the parameters for `super.onSizeChanged`
    private int oldW = 0;
    private int oldH = 0;

    /** Search highlight rects: list of { page (1-based), rect "left,top,right,bottom" in PDF points } */
    private List<HighlightRect> highlightRects = new ArrayList<>();
    private static final int HIGHLIGHT_COLOR = Color.argb(80, 255, 255, 0);
    private final Paint highlightPaint = new Paint();

    public PdfView(Context context, AttributeSet set){
        super(context, set);
        ConfigKt.setPdfiumConfig(new Config(new DefaultLogger(), AlreadyClosedBehavior.IGNORE));
        highlightPaint.setColor(HIGHLIGHT_COLOR);
        highlightPaint.setStyle(Paint.Style.FILL);
    }

    /** Entry for one highlight: page (1-based) and rect in PDF points "left,top,right,bottom". */
    private static class HighlightRect {
        final int page;
        final float left, top, right, bottom;

        HighlightRect(int page, float left, float top, float right, float bottom) {
            this.page = page;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    @Override
    public void onPageChanged(int page, int numberOfPages) {
        // pdf lib page start from 0, convert it to our page (start from 1)
        int pageOneBased = page + 1;
        if (programmaticTargetPage >= 1 && pageOneBased != programmaticTargetPage) {
            showLog(format("onPageChanged: skip stale page %d during programmatic jump to %d", pageOneBased, programmaticTargetPage));
            return;
        }
        if (programmaticTargetPage >= 1 && pageOneBased == programmaticTargetPage) {
            mainHandler.removeCallbacks(clearProgrammaticTargetRunnable);
            programmaticTargetPage = -1;
        }
        page = pageOneBased;
        this.page = page;
        showLog(format("%s %s / %s", path, page, numberOfPages));
        
        // Store page count when we get it (useful for loadComplete dispatch)
        if (numberOfPages > 0 && lastKnownPageCount == 0) {
            lastKnownPageCount = numberOfPages;
        }
        
        // Note: We don't dispatch loadComplete from onPageChanged anymore because:
        // 1. The PDF library's onLoad callback should call loadComplete() directly
        // 2. If it doesn't, we've already fixed it in loadComplete() with delayed dispatch
        // 3. This prevents duplicate loadComplete events
        // The delayed dispatch in loadComplete() ensures React component is ready

        WritableMap event = Arguments.createMap();
        event.putString("message", "pageChanged|"+page+"|"+numberOfPages);

        ThemedReactContext context = (ThemedReactContext) getContext();
        EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        int surfaceId = UIManagerHelper.getSurfaceId(this);

        TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

        if (dispatcher != null) {
            dispatcher.dispatchEvent(tce);
        }

//        ReactContext reactContext = (ReactContext)this.getContext();
//        reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//            this.getId(),
//            "topChange",
//            event
//         );
    }

    // In some cases Yoga (I think) will measure the view only along one axis first, resulting in
    // onSizeChanged being called with either w or h set to zero. This in turn starts the rendering
    // of the pdf under the hood with one dimension being set to zero and the follow-up call to
    // onSizeChanged with the correct dimensions doesn't have any effect on the already started process.
    // The offending class is DecodingAsyncTask, which tries to get width and height of the pdfView
    // in the constructor, and is created as soon as the measurement is complete, which in some cases
    // may be incomplete as described above.
    // By delaying calling super.onSizeChanged until the size in both dimensions is correct we are able
    // to prevent this from happening.
    //
    // I'm not sure whether the second condition is necessary, but without it, it would be impossible
    // to set the dimensions to zero after first measurement.
    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        if ((w > 0 && h > 0) || this.oldW > 0 || this.oldH > 0) {
            super.onSizeChanged(w, h, this.oldW, this.oldH);
            this.oldW = w;
            this.oldH = h;
        }
    }

    @Override
    public void loadComplete(int numberOfPages) {
        // Prevent duplicate calls - if already dispatched, skip
        if (loadCompleteDispatched) {
            showLog("loadComplete: Already dispatched, skipping duplicate call");
            return;
        }
        showLog("loadComplete called with " + numberOfPages + " pages, loadCompleteDispatched=" + loadCompleteDispatched);
        // Store the page count for later use
        lastKnownPageCount = numberOfPages;
        
        float width = 0;
        float height = 0;
        
        try {
            SizeF pageSize = getPageSize(0);
            if (pageSize != null) {
                width = pageSize.getWidth();
                height = pageSize.getHeight();
            }
        } catch (Exception e) {
            showLog("Error getting page size in loadComplete: " + e.getMessage());
            // Continue with default values to ensure event is dispatched
        }

        try {
            this.zoomTo(this.scale);
        } catch (Exception e) {
            showLog("Error setting zoom in loadComplete: " + e.getMessage());
            // Continue even if zoom fails
        }
        
        WritableMap event = Arguments.createMap();

        //create a new json Object for the TableOfContents
        Gson gson = new Gson();
        String tableOfContents = "";
        try {
            tableOfContents = gson.toJson(this.getTableOfContents());
        } catch (Exception e) {
            showLog("Error serializing table of contents: " + e.getMessage());
            // Continue with empty table of contents
        }
        
        // Include path in loadComplete message for reliable access in JS
        String pathValue = this.path != null ? this.path : "";
        event.putString("message", "loadComplete|"+numberOfPages+"|"+width+"|"+height+"|"+pathValue+"|"+tableOfContents);

        ThemedReactContext context = (ThemedReactContext) getContext();
        final EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        int surfaceId = UIManagerHelper.getSurfaceId(this);

        final TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

        if (dispatcher != null) {
            showLog("loadComplete: Dispatching event with message: " + event.getString("message"));
            // Post to next frame to ensure React component is ready to receive events
            // This fixes timing issues where event is dispatched before component is mounted
            final PdfView self = this;
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    if (dispatcher != null) {
                        dispatcher.dispatchEvent(tce);
                        self.loadCompleteDispatched = true;
                        showLog("loadComplete: Event dispatched successfully (delayed)");
                    }
                    if (self.pdfId != null && self.path != null) {
                        SearchRegistry.registerPath(self.pdfId, self.path);
                    }
                }
            });
        } else {
            showLog("EventDispatcher is null, cannot dispatch loadComplete event");
        }
        //        ReactContext reactContext = (ReactContext)this.getContext();
//        reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//            this.getId(),
//            "topChange",
//            event
//         );

        //Log.e("ReactNative", gson.toJson(this.getTableOfContents()));

    }

    @Override
    public void onError(Throwable t){
        WritableMap event = Arguments.createMap();
        if (t.getMessage().contains("Password required or incorrect password")) {
            event.putString("message", "error|Password required or incorrect password.");
        } else {
            event.putString("message", "error|"+t.getMessage());
        }

        ThemedReactContext context = (ThemedReactContext) getContext();
        EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        int surfaceId = UIManagerHelper.getSurfaceId(this);

        TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

        if (dispatcher != null) {
            dispatcher.dispatchEvent(tce);
        }

//        ReactContext reactContext = (ReactContext)this.getContext();
//        reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//            this.getId(),
//            "topChange",
//            event
//         );
    }

    @Override
    public void onPageScrolled(int page, float positionOffset){

        // maybe change by other instance, restore zoom setting
        Constants.Pinch.MINIMUM_ZOOM = this.minScale;
        Constants.Pinch.MAXIMUM_ZOOM = this.maxScale;

    }

    @Override
    public boolean onTap(MotionEvent e){

        // maybe change by other instance, restore zoom setting
        //Constants.Pinch.MINIMUM_ZOOM = this.minScale;
        //Constants.Pinch.MAXIMUM_ZOOM = this.maxScale;

        WritableMap event = Arguments.createMap();
        event.putString("message", "pageSingleTap|"+page+"|"+e.getX()+"|"+e.getY());

        ThemedReactContext context = (ThemedReactContext) getContext();
        EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        int surfaceId = UIManagerHelper.getSurfaceId(this);

        TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

        if (dispatcher != null) {
            dispatcher.dispatchEvent(tce);
        }
//        ReactContext reactContext = (ReactContext)this.getContext();
//        reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//            this.getId(),
//            "topChange",
//            event
//         );

        // process as tap
         return true;

    }

    @Override
    public void onLayerDrawn(Canvas canvas, float pageWidth, float pageHeight, int displayedPage){
        if (originalWidth == 0) {
            originalWidth = pageWidth;
        }
        
        if (lastPageWidth>0 && lastPageHeight>0 && (pageWidth!=lastPageWidth || pageHeight!=lastPageHeight)) {
            // maybe change by other instance, restore zoom setting
            Constants.Pinch.MINIMUM_ZOOM = this.minScale;
            Constants.Pinch.MAXIMUM_ZOOM = this.maxScale;

            WritableMap event = Arguments.createMap();
            event.putString("message", "scaleChanged|"+(pageWidth/originalWidth));
            ThemedReactContext context = (ThemedReactContext) getContext();
            EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
            int surfaceId = UIManagerHelper.getSurfaceId(this);

            TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

            if (dispatcher != null) {
                dispatcher.dispatchEvent(tce);
            }
//            ReactContext reactContext = (ReactContext)this.getContext();
//            reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//                this.getId(),
//                "topChange",
//                event
//             );
        }

        lastPageWidth = pageWidth;
        lastPageHeight = pageHeight;

        if (!highlightRects.isEmpty() && pdfId != null) {
            int pageOneBased = displayedPage + 1;
            try {
                float pdfW = 0, pdfH = 0;
                float[] sizePt = SearchRegistry.getPageSizePoints(pdfId, displayedPage);
                if (sizePt != null && sizePt.length >= 2 && sizePt[0] > 0 && sizePt[1] > 0) {
                    pdfW = sizePt[0];
                    pdfH = sizePt[1];
                }
                if (pdfW <= 0 || pdfH <= 0) {
                    SizeF fallback = getPageSize(displayedPage);
                    if (fallback != null) {
                        pdfW = fallback.getWidth();
                        pdfH = fallback.getHeight();
                    }
                }
                if (pdfW > 0 && pdfH > 0) {
                    float scaleX = pageWidth / pdfW;
                    float scaleY = pageHeight / pdfH;
                    for (HighlightRect hr : highlightRects) {
                        if (hr.page != pageOneBased) continue;
                        float left = hr.left * scaleX;
                        float right = hr.right * scaleX;
                        float top = hr.top * scaleY;
                        float bottom = hr.bottom * scaleY;
                        // PDF coords: origin bottom-left, so top > bottom. Canvas: origin top-left.
                        float canvasTop = pageHeight - top;
                        float canvasBottom = pageHeight - bottom;
                        canvas.drawRect(left, canvasTop, right, canvasBottom, highlightPaint);
                    }
                }
            } catch (Exception e) {
                showLog("Highlight draw error: " + e.getMessage());
            }
        }
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (this.isRecycled())
            this.drawPdf();
    }

    /**
     * Override to prevent barteksc PDFView's recycle() on navigation.
     * The parent class calls recycle() in onDetachedFromWindow, which destroys the PDF
     * when the view is temporarily detached (e.g., navigating to another screen).
     * We only recycle when PdfManager.onDropViewInstance is called (component unmount).
     */
    @Override
    protected void onDetachedFromWindow() {
        // Intentionally skip super to prevent barteksc PDFView's recycle() which destroys
        // the PDF on navigation. We only recycle when PdfManager.onDropViewInstance is called.
    }

    @Override
    public void recycle() {
        if (pdfId != null) {
            SearchRegistry.unregisterPath(pdfId);
        }
        super.recycle();
    }

    public void drawPdf() {
        
        // FIX: Check if we actually need to reload the document
        // Only reload if path changed or this is first load
        if (!needsReload && this.path != null && this.path.equals(lastLoadedPath)) {
            showLog(format("drawPdf: Skipping reload, path unchanged: %s", this.path));
            // Just jump to the page if needed, dont reload entire document
            if (this.page > 0 && !this.isRecycled()) {
                armProgrammaticJump(this.page);
                this.jumpTo(this.page - 1, false);
            }
            // If PDF is already loaded but loadComplete event hasn't been dispatched yet, dispatch it now
            if (!loadCompleteDispatched && !this.isRecycled() && lastKnownPageCount > 0) {
                showLog("drawPdf: PDF already loaded but loadComplete not dispatched, dispatching now with " + lastKnownPageCount + " pages");
                loadComplete(lastKnownPageCount);
            }
            return;
        }
        showLog(format("drawPdf path:%s %s", this.path, this.page));

        if (this.path != null){

            // set scale
            this.setMinZoom(this.minScale);
            this.setMaxZoom(this.maxScale);
            this.setMidZoom((this.maxScale+this.minScale)/2);
            Constants.Pinch.MINIMUM_ZOOM = this.minScale;
            Constants.Pinch.MAXIMUM_ZOOM = this.maxScale;

            Configurator configurator;

            if (this.path.startsWith("content://")) {
                ContentResolver contentResolver = getContext().getContentResolver();
                InputStream inputStream = null;
                Uri uri = Uri.parse(this.path);
                try {
                    inputStream = contentResolver.openInputStream(uri);
                } catch (FileNotFoundException e) {
                    throw new RuntimeException(e.getMessage());
                }
                configurator = this.fromStream(inputStream);
            } else {
                configurator = this.fromUri(getURI(this.path));
            }

            configurator.defaultPage(this.page-1)
                .swipeHorizontal(this.horizontal)
                .onPageChange(this)
                .onLoad(this)
                .onError(this)
                .onDraw(this)
                .onPageScroll(this)
                .spacing(this.spacing)
                .password(this.password)
                .enableAntialiasing(this.enableAntialiasing)
                .pageFitPolicy(this.fitPolicy)
                .pageSnap(this.pageSnap)
                .autoSpacing(this.autoSpacing)
                .pageFling(this.pageFling)
                .enableSwipe(!this.singlePage && this.scrollEnabled)
                .enableDoubletap(!this.singlePage && this.enableDoubleTapZoom)
                .enableAnnotationRendering(this.enableAnnotationRendering)
                .linkHandler(this);

            if (this.singlePage) {
                configurator.pages(this.page-1);
                setTouchesEnabled(false);
            } else {
                configurator.onTap(this);
            }

            configurator.load();
            
            // Mark as loaded, clear reload flag
            lastLoadedPath = this.path;
            needsReload = false;
        }
    }

    public void setEnableDoubleTapZoom(boolean enableDoubleTapZoom) {
        this.enableDoubleTapZoom = enableDoubleTapZoom;
    }

    public void setPath(String path) {
        if (pdfId != null) {
            SearchRegistry.unregisterPath(pdfId);
        }
        needsReload = true;
        programmaticTargetPage = -1;
        mainHandler.removeCallbacks(clearProgrammaticTargetRunnable);
        this.path = path;
        loadCompleteDispatched = false;
        lastKnownPageCount = 0;
    }

    public void setPdfId(String pdfId) {
        if (this.pdfId != null && !this.pdfId.equals(pdfId)) {
            SearchRegistry.unregisterPath(this.pdfId);
        }
        this.pdfId = pdfId;
    }

    public void setHighlightRects(ReadableArray arr) {
        highlightRects.clear();
        if (arr == null) return;
        for (int i = 0; i < arr.size(); i++) {
            ReadableMap map = arr.getMap(i);
            if (map == null || !map.hasKey("page") || !map.hasKey("rect")) continue;
            int page = map.getInt("page");
            String rectStr = map.getString("rect");
            if (rectStr == null || rectStr.equals("{}")) continue;
            String[] parts = rectStr.split(",");
            if (parts.length != 4) continue;
            try {
                float left = Float.parseFloat(parts[0].trim());
                float top = Float.parseFloat(parts[1].trim());
                float right = Float.parseFloat(parts[2].trim());
                float bottom = Float.parseFloat(parts[3].trim());
                highlightRects.add(new HighlightRect(page, left, top, right, bottom));
            } catch (NumberFormatException ignored) {}
        }
        invalidate();
        postInvalidate();
    }

    // page start from 1
    public void setPage(int page) {
        int newPage = page>1?page:1;
        int oldPage = this.page;
        this.page = newPage;
        
        // If page changed and PDF is already loaded, jump to the new page immediately
        if (newPage != oldPage && !needsReload && this.path != null && !this.isRecycled()) {
            armProgrammaticJump(newPage);
            showLog(format("setPage: Jumping to page %d (from %d)", newPage, oldPage));
            this.jumpTo(newPage - 1, false);
        }
    }

    public void setScale(float scale) {
        this.scale = scale;
    }

    public void setMinScale(float minScale) {
        this.minScale = minScale;
    }

    public void setMaxScale(float maxScale) {
        this.maxScale = maxScale;
    }

    public void setHorizontal(boolean horizontal) {
        this.horizontal = horizontal;
    }

    public void setScrollEnabled(boolean scrollEnabled) {
        this.scrollEnabled = scrollEnabled;
    }

    public void setSpacing(int spacing) {
        this.spacing = spacing;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public void setEnableAntialiasing(boolean enableAntialiasing) {
        this.enableAntialiasing = enableAntialiasing;
    }

    public void setEnableAnnotationRendering(boolean enableAnnotationRendering) {
        this.enableAnnotationRendering = enableAnnotationRendering;
    }

    public void setEnablePaging(boolean enablePaging) {
        this.enablePaging = enablePaging;
        if (this.enablePaging) {
            this.autoSpacing = true;
            this.pageFling = true;
            this.pageSnap = true;
        } else {
            this.autoSpacing = false;
            this.pageFling = false;
            this.pageSnap = false;
        }
    }

    public void setFitPolicy(int fitPolicy) {
        switch(fitPolicy){
            case 0:
                this.fitPolicy = FitPolicy.WIDTH;
                break;
            case 1:
                this.fitPolicy = FitPolicy.HEIGHT;
                break;
            case 2:
            default:
            {
                this.fitPolicy = FitPolicy.BOTH;
                break;
            }
        }

    }

    public void setSinglePage(boolean singlePage) {
        this.singlePage = singlePage;
    }
    
    /**
    
    /**
    
    /**

    /**
     * @see https://github.com/barteksc/AndroidPdfViewer/blob/master/android-pdf-viewer/src/main/java/com/github/barteksc/pdfviewer/link/DefaultLinkHandler.java
     */
    public void handleLinkEvent(LinkTapEvent event) {
        String uri = event.getLink().getUri();
        Integer page = event.getLink().getDestPageIdx();
        if (uri != null && !uri.isEmpty()) {
            handleUri(uri);
        } else if (page != null) {
            handlePage(page);
        }
    }

    /**
     * @see https://github.com/barteksc/AndroidPdfViewer/blob/master/android-pdf-viewer/src/main/java/com/github/barteksc/pdfviewer/link/DefaultLinkHandler.java
     */
    private void handleUri(String uri) {
        WritableMap event = Arguments.createMap();
        event.putString("message", "linkPressed|"+uri);

        ThemedReactContext context = (ThemedReactContext) getContext();
        EventDispatcher dispatcher = UIManagerHelper.getEventDispatcherForReactTag(context, getId());
        int surfaceId = UIManagerHelper.getSurfaceId(this);

        TopChangeEvent tce = new TopChangeEvent(surfaceId, getId(), event);

        if (dispatcher != null) {
            dispatcher.dispatchEvent(tce);
        }

//        ReactContext reactContext = (ReactContext)this.getContext();
//        reactContext.getJSModule(RCTEventEmitter.class).receiveEvent(
//            this.getId(),
//            "topChange",
//            event
//        );
    }

    /**
     * @see https://github.com/barteksc/AndroidPdfViewer/blob/master/android-pdf-viewer/src/main/java/com/github/barteksc/pdfviewer/link/DefaultLinkHandler.java
     */
    private void handlePage(int page) {
        this.jumpTo(page);
    }

    private void showLog(final String str) {
        Log.d("PdfView", str);
    }

    private Uri getURI(final String uri) {
        Uri parsed = Uri.parse(uri);

        if (parsed.getScheme() == null || parsed.getScheme().isEmpty()) {
          return Uri.fromFile(new File(uri));
        }
        return parsed;
    }

    private void setTouchesEnabled(final boolean enabled) {
        setTouchesEnabled(this, enabled);
    }

    private static void setTouchesEnabled(View v, final boolean enabled) {
        if (enabled) {
            v.setOnTouchListener(null);
        } else {
            v.setOnTouchListener(new View.OnTouchListener() {
                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    return true;
                }
            });
        }

        if (v instanceof ViewGroup) {
            ViewGroup vg = (ViewGroup) v;
            for (int i = 0; i < vg.getChildCount(); i++) {
                View child = vg.getChildAt(i);
                setTouchesEnabled(child, enabled);
            }
        }
    }
}