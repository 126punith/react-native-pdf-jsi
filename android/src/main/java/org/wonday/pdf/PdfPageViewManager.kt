package org.wonday.pdf

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.RNPDFPdfPageViewManagerDelegate
import com.facebook.react.viewmanagers.RNPDFPdfPageViewManagerInterface
import org.wonday.pdf.viewer.PdfPageView

@ReactModule(name = PdfPageViewManager.REACT_CLASS)
class PdfPageViewManager : SimpleViewManager<PdfPageView>(), RNPDFPdfPageViewManagerInterface<PdfPageView> {
    private val delegate = RNPDFPdfPageViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<PdfPageView> = delegate

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext): PdfPageView {
        val view = PdfPageView(context)
        view.onEvent = { event ->
            val reactContext = view.context as ReactContext
            val data = Arguments.createMap().apply { putString("message", event.toString()) }
            UIManagerHelper.getEventDispatcherForReactTag(reactContext, view.id)
                ?.dispatchEvent(ChangeEvent(UIManagerHelper.getSurfaceId(view), view.id, data))
        }
        return view
    }

    override fun onDropViewInstance(view: PdfPageView) {
        view.dispose()
        super.onDropViewInstance(view)
    }

    override fun onAfterUpdateTransaction(view: PdfPageView) {
        super.onAfterUpdateTransaction(view)
        view.commitProps()
    }

    override fun setPath(view: PdfPageView, value: String?) = view.setPath(value)

    override fun setPage(view: PdfPageView, value: Int) = view.setPage(value)

    override fun setRevision(view: PdfPageView, value: Int) = view.setRevision(value)

    override fun setEnableAnnotationRendering(view: PdfPageView, value: Boolean) = view.setEnableAnnotationRendering(value)

    private class ChangeEvent(surfaceId: Int, viewTag: Int, private val data: WritableMap) :
        Event<ChangeEvent>(surfaceId, viewTag) {
        override fun getEventName(): String = "topChange"

        override fun canCoalesce(): Boolean = false

        override fun getEventData(): WritableMap = data
    }

    companion object {
        const val REACT_CLASS = "RNPDFPdfPageView"
    }
}
