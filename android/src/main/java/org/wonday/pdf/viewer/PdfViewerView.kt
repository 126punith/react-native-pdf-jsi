package org.wonday.pdf.viewer

import android.animation.ValueAnimator
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.OverScroller
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A highlight in PDF points from the page's top-left corner. */
data class PdfHighlightRect(val page: Int, val x: Float, val y: Float, val width: Float, val height: Float)

/**
 * Scrollable, zoomable PDF viewer drawn straight from PDFium.
 *
 * Every page has a base bitmap at its fitted size. Above zoom 1.05 the visible
 * part is covered with 512px tiles rendered at a quantised zoom, so text stays
 * sharp without rendering whole pages at high resolution. While pinching, the
 * tiles of the previous zoom level are stretched until the gesture ends.
 *
 * Events are delivered through [onEvent] as JSON matching `src/viewerEvents.ts`.
 * Page and scale events are sent only once scrolling and zooming have settled.
 */
class PdfViewerView(context: Context) : View(context) {
    var onEvent: ((JSONObject) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val queue = RenderQueue()
    private val density = resources.displayMetrics.density
    private val memoryBudget = (Runtime.getRuntime().maxMemory() / 6).coerceIn(24L shl 20, 160L shl 20)
    private val pool = BitmapPool(16L shl 20)
    private val cache = LruByteCache<String, Bitmap>(
        memoryBudget,
        sizeOf = { it.allocationByteCount.toLong() },
        onEvict = { _, bitmap -> pool.give(bitmap) },
    )

    // Props. Setters only mark what changed; commitProps() applies them together.
    private var path: String? = null
    private var password: String? = null
    private var initialPage = 0
    private var initialScale = 1f
    private var minScale = 1f
    private var maxScale = 4f
    private var horizontal = false
    private var paging = false
    private var rtl = false
    private var singlePage = false
    private var fitPolicy = FitPolicy.WIDTH
    private var spacingDp = 8
    private var doubleTapZoom = true
    private var scrollEnabled = true
    private var annotations = true
    private var showHorizontalIndicator = true
    private var showVerticalIndicator = true
    private var highlights: List<PdfHighlightRect> = emptyList()

    private var documentDirty = false
    private var layoutDirty = false
    private var renderDirty = false

    // Document state.
    private var generation = 0
    private var handle = 0L
    private var pageSizes: List<Pair<Float, Float>> = emptyList()
    private var pageBase = 0
    private var layout: PdfLayout? = null
    private var layoutVersion = 0
    private var positioned = false
    private val links = HashMap<Int, List<PageLinkHit>>()
    private val failedPages = HashSet<Int>()

    // Viewport state, in pixels of the zoomed content.
    private var offsetX = 0f
    private var offsetY = 0f
    private var zoom = 1f
    private var tileBucket = 0
    private var lastPage = -1
    private var lastScale = Float.NaN

    private var touching = false
    private var scaling = false
    private var flinging = false
    private var zoomAnimator: ValueAnimator? = null
    private val scroller = OverScroller(context)

    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val pagePaint = Paint().apply { color = Color.WHITE }
    private val highlightPaint = Paint().apply { color = Color.argb(90, 255, 214, 0) }
    private val indicatorPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(110, 0, 0, 0) }
    private val scratch = RectF()

    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean {
            stopMotion()
            return true
        }

        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            if (!scrollEnabled || scaling) return false
            scrollByClamped(dx, dy)
            return true
        }

        override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
            if (!scrollEnabled || scaling) return false
            if (paging && snapPaging(if (horizontal) -vx else -vy)) return true
            val (maxX, maxY) = maxOffsets()
            flinging = true
            scroller.fling(
                offsetX.roundToInt(), offsetY.roundToInt(), -vx.roundToInt(), -vy.roundToInt(),
                0, maxX.roundToInt(), 0, maxY.roundToInt(),
            )
            postInvalidateOnAnimation()
            return true
        }

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            handleTap(e.x, e.y)
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (!doubleTapZoom) return false
            val target = if (zoom > minScale + 0.05f) minScale else min(maxScale, minScale * 2f)
            animateZoom(target, e.x, e.y)
            return true
        }
    })

    private val scaleGestures = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
            if (layout == null) return false
            scaling = true
            stopMotion()
            return true
        }

        override fun onScale(detector: ScaleGestureDetector): Boolean {
            zoomAround(zoom * detector.scaleFactor, detector.focusX, detector.focusY)
            return true
        }

        override fun onScaleEnd(detector: ScaleGestureDetector) {
            scaling = false
            settle()
        }
    })

    init {
        isClickable = true
        isFocusable = true
    }

    // region Props

    fun setPath(value: String?) {
        if (value != path) {
            path = value
            documentDirty = true
        }
    }

    fun setPassword(value: String?) {
        val normalized = value?.takeIf { it.isNotEmpty() }
        if (normalized != password) {
            password = normalized
            documentDirty = true
        }
    }

    fun setInitialPage(value: Int) {
        if (value != initialPage) {
            initialPage = max(0, value)
            if (singlePage) layoutDirty = true
        }
    }

    fun setInitialScale(value: Float) {
        initialScale = if (value > 0) value else 1f
    }

    fun setMinScale(value: Float) {
        minScale = if (value > 0) value else 1f
        renderDirty = true
    }

    fun setMaxScale(value: Float) {
        maxScale = if (value > 0) value else 4f
        renderDirty = true
    }

    fun setHorizontal(value: Boolean) = updateLayoutProp(horizontal != value) { horizontal = value }

    fun setEnableRTL(value: Boolean) = updateLayoutProp(rtl != value) { rtl = value }

    fun setSinglePage(value: Boolean) = updateLayoutProp(singlePage != value) { singlePage = value }

    fun setFitPolicy(value: Int) {
        val policy = FitPolicy.from(value)
        updateLayoutProp(fitPolicy != policy) { fitPolicy = policy }
    }

    fun setSpacing(value: Int) = updateLayoutProp(spacingDp != value) { spacingDp = max(0, value) }

    fun setEnablePaging(value: Boolean) {
        paging = value
    }

    fun setEnableDoubleTapZoom(value: Boolean) {
        doubleTapZoom = value
    }

    fun setScrollEnabled(value: Boolean) {
        scrollEnabled = value
    }

    fun setEnableAnnotationRendering(value: Boolean) {
        if (value != annotations) {
            annotations = value
            renderDirty = true
            clearBitmaps()
        }
    }

    fun setShowsHorizontalScrollIndicator(value: Boolean) {
        showHorizontalIndicator = value
        renderDirty = true
    }

    fun setShowsVerticalScrollIndicator(value: Boolean) {
        showVerticalIndicator = value
        renderDirty = true
    }

    fun setHighlights(value: List<PdfHighlightRect>) {
        highlights = value
        renderDirty = true
    }

    private inline fun updateLayoutProp(changed: Boolean, apply: () -> Unit) {
        if (changed) {
            apply()
            layoutDirty = true
        }
    }

    /** Applies the props set since the last call. */
    fun commitProps() {
        when {
            documentDirty -> load()
            layoutDirty -> relayout()
            else -> clampZoomToLimits()
        }
        documentDirty = false
        layoutDirty = false
        if (renderDirty) {
            renderDirty = false
            invalidate()
        }
    }

    // endregion

    // region Commands

    fun goToPage(page: Int, animated: Boolean) {
        val current = layout ?: return
        val index = (page - pageBase).coerceIn(0, current.pageCount - 1)
        val target = current.offsetForPage(index, zoom)
        stopMotion()
        if (animated) {
            animateScrollTo(if (horizontal) target else offsetX, if (horizontal) offsetY else target)
        } else {
            if (horizontal) offsetX = target else offsetY = target
            clampOffsets()
            settle()
        }
    }

    fun zoomTo(scale: Float, animated: Boolean) {
        if (layout == null) return
        stopMotion()
        if (animated) {
            animateZoom(scale, width / 2f, height / 2f)
        } else {
            zoomAround(scale, width / 2f, height / 2f)
            settle()
        }
    }

    // endregion

    // region Document lifecycle

    private fun load() {
        closeDocument()
        val source = path?.takeIf { it.isNotEmpty() } ?: return
        val secret = password
        val token = generation
        queue.submit("${RenderQueue.PINNED}open:$token", -50) {
            try {
                val opened = PdfiumBridge.nativeOpen(source, secret)
                val sizes = PdfiumBridge.nativePageSizes(opened)
                val titles = PdfiumBridge.nativeOutlineTitles(opened)
                val info = PdfiumBridge.nativeOutlineInfo(opened)
                val outline = JSONArray()
                for (index in titles.indices) {
                    outline.put(
                        JSONObject()
                            .put("title", titles[index])
                            .put("page", info.getOrElse(index * 2) { 0 })
                            .put("level", info.getOrElse(index * 2 + 1) { 0 }),
                    )
                }
                main.post {
                    if (token != generation) {
                        closeHandle(opened)
                    } else {
                        onOpened(opened, sizes, outline, source)
                    }
                }
            } catch (error: Throwable) {
                val (code, message) = splitNativeError(error.message)
                main.post {
                    if (token == generation) onOpenFailed(code, message)
                }
            }
        }
    }

    private fun onOpened(opened: Long, sizes: FloatArray, outline: JSONArray, source: String) {
        handle = opened
        pageSizes = List(sizes.size / 2) { sizes[it * 2] to sizes[it * 2 + 1] }
        if (pageSizes.isEmpty()) {
            emit(JSONObject().put("type", "error").put("code", "unsupported-pdf").put("message", "The document has no pages"))
            return
        }
        emit(
            JSONObject()
                .put("type", "load")
                .put("pageCount", pageSizes.size)
                .put("width", pageSizes[0].first.toDouble())
                .put("height", pageSizes[0].second.toDouble())
                .put("path", source)
                .put("outline", outline),
        )
        relayout()
    }

    private fun onOpenFailed(code: String, message: String) {
        when (code) {
            "password-required" -> emit(JSONObject().put("type", "passwordRequired").put("incorrect", false))
            "password-incorrect" -> emit(JSONObject().put("type", "passwordRequired").put("incorrect", true))
            else -> emit(JSONObject().put("type", "error").put("code", code).put("message", message))
        }
    }

    private fun closeDocument() {
        generation++
        layoutVersion++
        queue.cancelAll()
        if (handle != 0L) closeHandle(handle)
        handle = 0L
        pageSizes = emptyList()
        layout = null
        positioned = false
        links.clear()
        failedPages.clear()
        lastPage = -1
        lastScale = Float.NaN
        pendingEvents.clear()
        clearBitmaps()
        invalidate()
    }

    /** Closes on the render thread so no render job can use a freed handle. */
    private fun closeHandle(value: Long) {
        if (!queue.submit("${RenderQueue.PINNED}close:$value", -100) { PdfiumBridge.nativeClose(value) }) {
            // The queue is shut down, so nothing else can be using this handle.
            PdfiumBridge.nativeClose(value)
        }
    }

    /** Releases everything; the view cannot be used afterwards. */
    fun dispose() {
        stopMotion()
        val last = handle
        generation++
        handle = 0L
        layout = null
        queue.cancelAll()
        queue.submit("${RenderQueue.PINNED}dispose", -100) {
            if (last != 0L) PdfiumBridge.nativeClose(last)
            queue.shutdown()
        }
        main.removeCallbacksAndMessages(null)
        cache.clear()
        pool.clear()
    }

    private fun clearBitmaps() {
        cache.clear()
        failedPages.clear()
    }

    // endregion

    // region Layout

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0 && h > 0) relayout()
    }

    private fun relayout() {
        if (handle == 0L || pageSizes.isEmpty() || width <= 0 || height <= 0) return
        val previous = layout
        val anchorPage = if (previous != null && positioned) currentPage() else initialPage
        pageBase = if (singlePage) initialPage.coerceIn(0, pageSizes.lastIndex) else 0
        val sizes = if (singlePage) listOf(pageSizes[pageBase]) else pageSizes
        layout = PdfLayout(
            sizes,
            width.toFloat(),
            height.toFloat(),
            fitPolicy,
            if (singlePage) 0f else spacingDp * density,
            horizontal,
            rtl,
        )
        layoutVersion++
        links.clear()
        clearBitmaps()
        if (!positioned) {
            zoom = if (singlePage) 1f else initialScale.coerceIn(minScale, maxScale)
            positioned = true
        }
        tileBucket = TileGrid.bucketFor(zoom)
        val current = layout!!
        val target = current.offsetForPage((anchorPage - pageBase).coerceIn(0, current.pageCount - 1), zoom)
        if (horizontal) {
            offsetX = target
            offsetY = 0f
        } else {
            offsetX = 0f
            offsetY = target
        }
        clampOffsets()
        invalidate()
        settle()
    }

    private fun clampZoomToLimits() {
        if (layout == null) return
        val clamped = zoom.coerceIn(minScale, maxScale)
        if (clamped != zoom) {
            zoomAround(clamped, width / 2f, height / 2f)
            settle()
        }
    }

    private fun maxOffsets(): Pair<Float, Float> {
        val current = layout ?: return 0f to 0f
        return max(0f, current.contentWidth(zoom) - width) to max(0f, current.contentHeight(zoom) - height)
    }

    private fun clampOffsets() {
        val (maxX, maxY) = maxOffsets()
        offsetX = offsetX.coerceIn(0f, maxX)
        offsetY = offsetY.coerceIn(0f, maxY)
    }

    /** Centres content smaller than the viewport. */
    private fun originX(): Float = max(0f, (width - (layout?.contentWidth(zoom) ?: 0f)) / 2f)

    private fun originY(): Float = max(0f, (height - (layout?.contentHeight(zoom) ?: 0f)) / 2f)

    private fun pageScreenRect(index: Int, out: RectF): RectF {
        val box = layout!!.pages[index]
        val left = originX() + box.left * zoom - offsetX
        val top = originY() + box.top * zoom - offsetY
        out.set(left, top, left + box.width * zoom, top + box.height * zoom)
        return out
    }

    private fun scrollOffset(): Float = if (horizontal) offsetX else offsetY

    private fun currentPage(): Int {
        val current = layout ?: return 0
        return pageBase + current.currentPage(scrollOffset(), zoom)
    }

    // endregion

    // region Drawing

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current = layout ?: return
        val viewport = if (horizontal) width else height
        val origin = if (horizontal) originX() else originY()
        val start = (scrollOffset() - origin) / zoom
        val visible = current.pagesBetween(start, start + viewport / zoom)
        val prefetch = current.pagesBetween(start - viewport / zoom / 2f, start + viewport * 1.5f / zoom)
        val wanted = HashSet<String>()
        val centre = current.currentPage(scrollOffset(), zoom)
        val tiled = zoom > 1.05f
        val bucket = if (scaling || zoomAnimator != null) tileBucket else TileGrid.bucketFor(zoom).also { tileBucket = it }

        for (index in prefetch) {
            val baseKey = "b:$index"
            wanted.add(baseKey)
            if (!cache.containsKey(baseKey)) requestBase(index, abs(index - centre))
        }
        for (index in visible) {
            val rect = pageScreenRect(index, scratch)
            canvas.drawRect(rect, pagePaint)
            cache["b:$index"]?.let { canvas.drawBitmap(it, null, rect, bitmapPaint) }
            if (tiled && bucket > 0) drawTiles(canvas, index, rect, bucket, centre, wanted)
            drawHighlights(canvas, index, rect)
        }
        queue.retain(wanted)
        drawIndicators(canvas, current)

        if (scroller.computeScrollOffset()) {
            offsetX = scroller.currX.toFloat()
            offsetY = scroller.currY.toFloat()
            clampOffsets()
            if (flinging) emitPageChangeIfNeeded()
            postInvalidateOnAnimation()
        } else if (flinging) {
            flinging = false
            settle()
        }
    }

    private fun drawTiles(canvas: Canvas, index: Int, rect: RectF, bucket: Int, centre: Int, wanted: MutableSet<String>) {
        val box = layout!!.pages[index]
        val bucketZoom = TileGrid.zoomFor(bucket)
        val pageWidth = ceil(box.width * bucketZoom).toInt()
        val pageHeight = ceil(box.height * bucketZoom).toInt()
        val factor = bucketZoom / zoom
        val tiles = TileGrid.visibleTiles(
            pageWidth,
            pageHeight,
            (0f - rect.left) * factor,
            (0f - rect.top) * factor,
            (width - rect.left) * factor,
            (height - rect.top) * factor,
        )
        val drawScale = zoom / bucketZoom
        val target = RectF()
        for (tile in tiles) {
            val key = "t:$index:$bucket:${tile.column}:${tile.row}"
            wanted.add(key)
            val bitmap = cache[key]
            if (bitmap == null) {
                requestTile(index, bucket, pageWidth, pageHeight, tile, key, abs(index - centre))
                continue
            }
            target.set(
                rect.left + tile.left * drawScale,
                rect.top + tile.top * drawScale,
                rect.left + (tile.left + tile.width) * drawScale,
                rect.top + (tile.top + tile.height) * drawScale,
            )
            canvas.drawBitmap(bitmap, null, target, bitmapPaint)
        }
    }

    private fun drawHighlights(canvas: Canvas, index: Int, rect: RectF) {
        if (highlights.isEmpty()) return
        val docPage = pageBase + index
        val scale = layout!!.scales[index] * zoom
        for (highlight in highlights) {
            if (highlight.page != docPage) continue
            canvas.drawRect(
                rect.left + highlight.x * scale,
                rect.top + highlight.y * scale,
                rect.left + (highlight.x + highlight.width) * scale,
                rect.top + (highlight.y + highlight.height) * scale,
                highlightPaint,
            )
        }
    }

    private fun drawIndicators(canvas: Canvas, current: PdfLayout) {
        if (!touching && !flinging && zoomAnimator == null) return
        val thickness = 3f * density
        val inset = 2f * density
        val contentWidth = current.contentWidth(zoom)
        val contentHeight = current.contentHeight(zoom)
        if (showVerticalIndicator && contentHeight > height) {
            val length = max(24f * density, height * height / contentHeight)
            val top = (height - length) * (offsetY / (contentHeight - height))
            canvas.drawRoundRect(width - inset - thickness, top, width - inset, top + length, thickness, thickness, indicatorPaint)
        }
        if (showHorizontalIndicator && contentWidth > width) {
            val length = max(24f * density, width * width / contentWidth)
            val left = (width - length) * (offsetX / (contentWidth - width))
            canvas.drawRoundRect(left, height - inset - thickness, left + length, height - inset, thickness, thickness, indicatorPaint)
        }
    }

    // endregion

    // region Rendering

    private val background = Color.WHITE

    private fun requestBase(index: Int, distance: Int) {
        val docPage = pageBase + index
        if (docPage in failedPages) return
        val box = layout!!.pages[index]
        val bitmapWidth = ceil(box.width).toInt().coerceAtLeast(1)
        val bitmapHeight = ceil(box.height).toInt().coerceAtLeast(1)
        val key = "b:$index"
        submitRender(key, distance * 2, docPage, bitmapWidth, bitmapHeight, bitmapWidth.toFloat(), bitmapHeight.toFloat(), 0f, 0f)
    }

    private fun requestTile(index: Int, bucket: Int, pageWidth: Int, pageHeight: Int, tile: TileGrid.Tile, key: String, distance: Int) {
        val docPage = pageBase + index
        if (docPage in failedPages) return
        submitRender(
            key, distance * 2 + 1, docPage, tile.width, tile.height,
            pageWidth.toFloat(), pageHeight.toFloat(), tile.left.toFloat(), tile.top.toFloat(),
        )
    }

    private fun submitRender(
        key: String,
        priority: Int,
        docPage: Int,
        bitmapWidth: Int,
        bitmapHeight: Int,
        pageWidth: Float,
        pageHeight: Float,
        left: Float,
        top: Float,
    ) {
        val target = handle
        val version = layoutVersion
        val withAnnotations = annotations
        queue.submit(key, priority) {
            val bitmap = try {
                pool.take(bitmapWidth, bitmapHeight)
            } catch (_: OutOfMemoryError) {
                main.post { onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) }
                return@submit
            }
            val ok = PdfiumBridge.nativeRender(target, docPage, bitmap, pageWidth, pageHeight, left, top, background, withAnnotations)
            main.post {
                if (version != layoutVersion || target != handle) {
                    pool.give(bitmap)
                } else if (!ok) {
                    pool.give(bitmap)
                    if (failedPages.add(docPage)) {
                        emit(
                            JSONObject().put("type", "error").put("code", "page-render-failed")
                                .put("message", "Failed to render page $docPage").put("page", docPage),
                        )
                    }
                } else {
                    cache.put(key, bitmap)
                    invalidate()
                }
            }
        }
    }

    // endregion

    // region Gestures

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (singlePage || layout == null) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touching = true
                if (scrollEnabled) parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> touching = false
        }
        scaleGestures.onTouchEvent(event)
        gestures.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            parent?.requestDisallowInterceptTouchEvent(false)
            if (!flinging && zoomAnimator == null && scroller.isFinished) {
                if (!(paging && snapPaging(0f))) settle()
            }
            invalidate()
        }
        return true
    }

    private fun stopMotion() {
        if (!scroller.isFinished) scroller.forceFinished(true)
        flinging = false
        zoomAnimator?.cancel()
        zoomAnimator = null
    }

    private fun scrollByClamped(dx: Float, dy: Float) {
        offsetX += dx
        offsetY += dy
        clampOffsets()
        emitPageChangeIfNeeded()
        invalidate()
    }

    private fun zoomAround(target: Float, focusX: Float, focusY: Float) {
        val current = layout ?: return
        val next = target.coerceIn(minScale, maxScale)
        if (next == zoom) return
        // Content point under the focus stays under the focus.
        val contentX = (focusX - originX() + offsetX) / zoom
        val contentY = (focusY - originY() + offsetY) / zoom
        zoom = next
        offsetX = contentX * zoom - focusX + originX()
        offsetY = contentY * zoom - focusY + originY()
        clampOffsets()
        if (current.pageCount > 0) invalidate()
    }

    private fun animateZoom(target: Float, focusX: Float, focusY: Float) {
        stopMotion()
        val from = zoom
        val to = target.coerceIn(minScale, maxScale)
        if (from == to) return
        zoomAnimator = ValueAnimator.ofFloat(from, to).apply {
            duration = 220
            interpolator = DecelerateInterpolator()
            addUpdateListener { zoomAround(it.animatedValue as Float, focusX, focusY) }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (zoomAnimator === animation) {
                        zoomAnimator = null
                        settle()
                    }
                }
            })
            start()
        }
    }

    private fun animateScrollTo(x: Float, y: Float) {
        val (maxX, maxY) = maxOffsets()
        val targetX = x.coerceIn(0f, maxX)
        val targetY = y.coerceIn(0f, maxY)
        flinging = true
        scroller.startScroll(
            offsetX.roundToInt(), offsetY.roundToInt(),
            (targetX - offsetX).roundToInt(), (targetY - offsetY).roundToInt(), 300,
        )
        postInvalidateOnAnimation()
    }

    /**
     * Paging snap at the fitted zoom. `velocity` is along the scroll axis in
     * content direction; zero snaps to the nearest page. Returns false when
     * paging does not apply (zoomed in).
     */
    private fun snapPaging(velocity: Float): Boolean {
        val current = layout ?: return false
        if (zoom > 1.05f || current.pageCount < 2) return false
        val page = current.currentPage(scrollOffset(), zoom)
        val threshold = 400f * density
        val target = when {
            velocity > threshold -> page + 1
            velocity < -threshold -> page - 1
            else -> {
                val start = current.pageStart(page) * zoom
                val viewport = if (horizontal) width else height
                if (scrollOffset() - start > viewport / 2f) page + 1 else page
            }
        }.coerceIn(0, current.pageCount - 1)
        val offset = current.offsetForPage(target, zoom)
        if (horizontal) animateScrollTo(offset, offsetY) else animateScrollTo(offsetX, offset)
        return true
    }

    private fun handleTap(x: Float, y: Float) {
        val current = layout ?: return
        for (index in current.pages.indices) {
            val rect = pageScreenRect(index, scratch)
            if (!rect.contains(x, y)) continue
            val scale = current.scales[index] * zoom
            val pointX = (x - rect.left) / scale
            val pointY = (y - rect.top) / scale
            val docPage = pageBase + index
            val hit = linksFor(docPage).firstOrNull { it.contains(pointX, pointY) }
            when {
                hit?.uri != null -> emit(JSONObject().put("type", "link").put("url", hit.uri))
                hit != null && hit.page >= 0 -> goToPage(hit.page, true)
                else -> emit(
                    JSONObject().put("type", "tap").put("page", docPage)
                        .put("x", pointX.toDouble()).put("y", pointY.toDouble()),
                )
            }
            return
        }
    }

    private class PageLinkHit(val x: Float, val y: Float, val width: Float, val height: Float, val page: Int, val uri: String?) {
        fun contains(px: Float, py: Float) = px >= x && px <= x + width && py >= y && py <= y + height
    }

    private fun linksFor(docPage: Int): List<PageLinkHit> = links.getOrPut(docPage) {
        if (handle == 0L) return emptyList()
        try {
            val rects = PdfiumBridge.nativeLinkRects(handle, docPage)
            val uris = PdfiumBridge.nativeLinkUris(handle, docPage)
            List(rects.size / 5) {
                PageLinkHit(rects[it * 5], rects[it * 5 + 1], rects[it * 5 + 2], rects[it * 5 + 3], rects[it * 5 + 4].toInt(), uris.getOrNull(it))
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    // endregion

    // region Events

    /** Sends a page event when the page under the viewport centre changes, including mid-scroll. */
    private fun emitPageChangeIfNeeded() {
        val current = layout ?: return
        val page = pageBase + current.currentPage(scrollOffset(), zoom)
        if (page != lastPage) {
            lastPage = page
            emit(JSONObject().put("type", "pageChange").put("page", page).put("pageCount", pageSizes.size))
        }
    }

    /** Sends page and scale events if they changed. Called when motion stops. */
    private fun settle() {
        if (layout == null) return
        if (touching || scaling || flinging || zoomAnimator != null) return
        tileBucket = TileGrid.bucketFor(zoom)
        emitPageChangeIfNeeded()
        if (lastScale.isNaN() || abs(lastScale - zoom) > 0.001f) {
            val first = lastScale.isNaN()
            lastScale = zoom
            if (!first || zoom != 1f) emit(JSONObject().put("type", "scaleChange").put("scale", zoom.toDouble()))
        }
        invalidate()
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

    // endregion

    // region Memory

    private val memoryCallbacks = object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) = this@PdfViewerView.onTrimMemory(level)

        override fun onConfigurationChanged(newConfig: Configuration) = Unit

        @Deprecated("Deprecated in Java")
        override fun onLowMemory() = onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        context.applicationContext.registerComponentCallbacks(memoryCallbacks)
    }

    override fun onDetachedFromWindow() {
        context.applicationContext.unregisterComponentCallbacks(memoryCallbacks)
        super.onDetachedFromWindow()
    }

    private fun onTrimMemory(level: Int) {
        when {
            level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> cache.clear()
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> cache.trimTo(cache.size / 2)
            else -> return
        }
        pool.clear()
        invalidate()
    }

    // endregion
}
