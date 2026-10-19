package org.wonday.pdf

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.RNPDFPdfViewManagerDelegate
import com.facebook.react.viewmanagers.RNPDFPdfViewManagerInterface
import org.wonday.pdf.viewer.PdfHighlightRect
import org.wonday.pdf.viewer.PdfViewerView

@ReactModule(name = PdfViewManager.REACT_CLASS)
class PdfViewManager : SimpleViewManager<PdfViewerView>(), RNPDFPdfViewManagerInterface<PdfViewerView> {
    private val delegate = RNPDFPdfViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<PdfViewerView> = delegate

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext): PdfViewerView {
        val view = PdfViewerView(context)
        view.onEvent = { event ->
            val reactContext = view.context as ReactContext
            val data = Arguments.createMap().apply { putString("message", event.toString()) }
            UIManagerHelper.getEventDispatcherForReactTag(reactContext, view.id)
                ?.dispatchEvent(ChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, data))
        }
        return view
    }

    override fun onDropViewInstance(view: PdfViewerView) {
        view.dispose()
        super.onDropViewInstance(view)
    }

    override fun onAfterUpdateTransaction(view: PdfViewerView) {
        super.onAfterUpdateTransaction(view)
        view.commitProps()
    }

    override fun setPath(view: PdfViewerView, value: String?) = view.setPath(value)

    override fun setPassword(view: PdfViewerView, value: String?) = view.setPassword(value)

    override fun setInitialPage(view: PdfViewerView, value: Int) = view.setInitialPage(value)

    override fun setInitialScale(view: PdfViewerView, value: Float) = view.setInitialScale(value)

    override fun setMinScale(view: PdfViewerView, value: Float) = view.setMinScale(value)

    override fun setMaxScale(view: PdfViewerView, value: Float) = view.setMaxScale(value)

    override fun setHorizontal(view: PdfViewerView, value: Boolean) = view.setHorizontal(value)

    override fun setEnablePaging(view: PdfViewerView, value: Boolean) = view.setEnablePaging(value)

    override fun setEnableRTL(view: PdfViewerView, value: Boolean) = view.setEnableRTL(value)

    override fun setSinglePage(view: PdfViewerView, value: Boolean) = view.setSinglePage(value)

    override fun setFitPolicy(view: PdfViewerView, value: Int) = view.setFitPolicy(value)

    override fun setSpacing(view: PdfViewerView, value: Int) = view.setSpacing(value)

    override fun setEnableDoubleTapZoom(view: PdfViewerView, value: Boolean) = view.setEnableDoubleTapZoom(value)

    override fun setScrollEnabled(view: PdfViewerView, value: Boolean) = view.setScrollEnabled(value)

    override fun setEnableAnnotationRendering(view: PdfViewerView, value: Boolean) =
        view.setEnableAnnotationRendering(value)

    override fun setShowsHorizontalScrollIndicator(view: PdfViewerView, value: Boolean) =
        view.setShowsHorizontalScrollIndicator(value)

    override fun setShowsVerticalScrollIndicator(view: PdfViewerView, value: Boolean) =
        view.setShowsVerticalScrollIndicator(value)

    override fun setHighlightRects(view: PdfViewerView, value: ReadableArray?) {
        val rects = ArrayList<PdfHighlightRect>()
        if (value != null) {
            for (index in 0 until value.size()) {
                val item = value.getMap(index) ?: continue
                rects.add(
                    PdfHighlightRect(
                        item.getInt("page"),
                        item.getDouble("x").toFloat(),
                        item.getDouble("y").toFloat(),
                        item.getDouble("width").toFloat(),
                        item.getDouble("height").toFloat(),
                    ),
                )
            }
        }
        view.setHighlights(rects)
    }

    override fun goToPage(view: PdfViewerView, page: Int, animated: Boolean) = view.goToPage(page, animated)

    override fun zoomTo(view: PdfViewerView, scale: Float, animated: Boolean) = view.zoomTo(scale, animated)

    override fun receiveCommand(view: PdfViewerView, commandId: String, args: ReadableArray?) {
        delegate.receiveCommand(view, commandId, args)
    }

    private class ChangeEvent(surfaceId: Int, viewTag: Int, private val data: WritableMap) :
        Event<ChangeEvent>(surfaceId, viewTag) {
        override fun getEventName(): String = "topChange"

        // Every message is a different event (load, pageChange, ...), so none may replace another.
        override fun canCoalesce(): Boolean = false

        override fun getEventData(): WritableMap = data
    }

    companion object {
        const val REACT_CLASS = "RNPDFPdfView"
    }
}
