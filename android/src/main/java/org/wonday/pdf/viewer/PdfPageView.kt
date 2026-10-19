package org.wonday.pdf.viewer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.View
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Draws one page of a document that a PdfDocument has open, fitted and centred.
 * Reusing that document means its password and in-memory edits apply.
 */
class PdfPageView(context: Context) : View(context) {
    var onEvent: ((JSONObject) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val target = RectF()
    private var bitmap: Bitmap? = null
    private var generation = 0
    private var disposed = false

    private var path: String? = null
    private var page = 0
    private var revision = 0
    private var annotations = true
    private var dirty = false

    fun setPath(value: String?) {
        if (value != path) {
            path = value
            dirty = true
        }
    }

    fun setPage(value: Int) {
        if (value != page) {
            page = value
            dirty = true
        }
    }

    fun setRevision(value: Int) {
        if (value != revision) {
            revision = value
            dirty = true
        }
    }

    fun setEnableAnnotationRendering(value: Boolean) {
        if (value != annotations) {
            annotations = value
            dirty = true
        }
    }

    fun commitProps() {
        if (dirty) {
            dirty = false
            requestRender()
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        requestRender()
    }

    private fun requestRender() {
        val token = ++generation
        val source = path?.takeIf { it.isNotEmpty() } ?: return
        if (width <= 0 || height <= 0 || disposed) return
        val index = page
        val viewWidth = width
        val viewHeight = height
        val withAnnotations = annotations
        queue.submit("page:${System.identityHashCode(this)}:$token", 0) {
            val result = render(source, index, viewWidth, viewHeight, withAnnotations)
            main.post { deliver(token, result) }
        }
    }

    private sealed class Result {
        class Image(val bitmap: Bitmap) : Result()
        class Failure(val code: String, val message: String) : Result()
    }

    private fun render(source: String, index: Int, viewWidth: Int, viewHeight: Int, withAnnotations: Boolean): Result {
        val handle = PdfiumBridge.nativeOpenShared(source)
        if (handle == 0L) {
            return Result.Failure("document-closed", "Open the document with PdfLibrary before showing a PdfPage: $source")
        }
        try {
            val sizes = PdfiumBridge.nativePageSizes(handle)
            if (index < 0 || index * 2 + 1 >= sizes.size) {
                return Result.Failure("invalid-page", "Page $index is outside 0..${sizes.size / 2 - 1}")
            }
            val pageWidth = sizes[index * 2]
            val pageHeight = sizes[index * 2 + 1]
            val scale = min(viewWidth / pageWidth, viewHeight / pageHeight)
            val bitmapWidth = max(1, (pageWidth * scale).roundToInt())
            val bitmapHeight = max(1, (pageHeight * scale).roundToInt())
            val image = try {
                Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
            } catch (_: OutOfMemoryError) {
                return Result.Failure("out-of-memory", "Not enough memory to draw page $index")
            }
            val ok = PdfiumBridge.nativeRender(
                handle, index, image, bitmapWidth.toFloat(), bitmapHeight.toFloat(), 0f, 0f, Color.WHITE, withAnnotations,
            )
            if (!ok) {
                image.recycle()
                return Result.Failure("page-render-failed", "Failed to render page $index")
            }
            return Result.Image(image)
        } finally {
            PdfiumBridge.nativeRelease(handle)
        }
    }

    private fun deliver(token: Int, result: Result) {
        if (token != generation || disposed) {
            (result as? Result.Image)?.bitmap?.recycle()
            return
        }
        when (result) {
            is Result.Image -> {
                bitmap?.recycle()
                bitmap = result.bitmap
                invalidate()
                emit(JSONObject().put("type", "render").put("width", result.bitmap.width).put("height", result.bitmap.height))
            }
            is Result.Failure -> emit(JSONObject().put("type", "error").put("code", result.code).put("message", result.message))
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val image = bitmap ?: return
        val scale = min(width.toFloat() / image.width, height.toFloat() / image.height)
        val drawWidth = image.width * scale
        val drawHeight = image.height * scale
        val left = (width - drawWidth) / 2f
        val top = (height - drawHeight) / 2f
        target.set(left, top, left + drawWidth, top + drawHeight)
        canvas.drawBitmap(image, null, target, paint)
    }

    private val pendingEvents = ArrayList<JSONObject>()

    /** Fabric drops events sent before the view is mounted, so they wait for the first layout. */
    private fun emit(event: JSONObject) {
        if (isAttachedToWindow && isLaidOut) {
            onEvent?.invoke(event)
        } else {
            pendingEvents.add(event)
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (pendingEvents.isNotEmpty() && isAttachedToWindow) {
            val events = ArrayList(pendingEvents)
            pendingEvents.clear()
            events.forEach { onEvent?.invoke(it) }
        }
    }

    fun dispose() {
        disposed = true
        generation++
        bitmap?.recycle()
        bitmap = null
    }

    companion object {
        /** Shared by all page views; PDFium renders one page at a time anyway. */
        private val queue = RenderQueue("pdf-page")
    }
}
