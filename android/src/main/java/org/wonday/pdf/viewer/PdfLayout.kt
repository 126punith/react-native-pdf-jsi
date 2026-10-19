package org.wonday.pdf.viewer

import kotlin.math.max
import kotlin.math.min

/** How a page is scaled at zoom 1. */
enum class FitPolicy {
    WIDTH,
    HEIGHT,
    PAGE;

    companion object {
        fun from(value: Int): FitPolicy = when (value) {
            1 -> HEIGHT
            2 -> PAGE
            else -> WIDTH
        }
    }
}

/** A rectangle in pixels at zoom 1. */
data class PageBox(val left: Float, val top: Float, val width: Float, val height: Float) {
    val right: Float get() = left + width
    val bottom: Float get() = top + height
}

/**
 * Places pages along one axis at zoom 1. Every page is fitted to the viewport
 * on its own (so mixed page sizes line up) and centred on the cross axis.
 * At zoom `z` every coordinate is multiplied by `z`.
 *
 * Page sizes are PDF points, rotation applied; the viewport and spacing are pixels.
 */
class PdfLayout(
    pageSizes: List<Pair<Float, Float>>,
    val viewportWidth: Float,
    val viewportHeight: Float,
    val fitPolicy: FitPolicy = FitPolicy.WIDTH,
    val spacing: Float = 0f,
    val horizontal: Boolean = false,
    val rtl: Boolean = false,
) {
    val pages: List<PageBox>
    /** Pixels per PDF point for each page at zoom 1. */
    val scales: FloatArray
    /** Content length along the scroll axis at zoom 1. */
    val length: Float
    /** Content size across the scroll axis at zoom 1. */
    val crossLength: Float

    val pageCount: Int get() = pages.size

    init {
        require(viewportWidth > 0 && viewportHeight > 0) { "Viewport must not be empty" }
        val count = pageSizes.size
        scales = FloatArray(count)
        val sized = ArrayList<Pair<Float, Float>>(count)
        for ((index, size) in pageSizes.withIndex()) {
            val width = if (size.first > 0) size.first else 612f
            val height = if (size.second > 0) size.second else 792f
            val scale = when (fitPolicy) {
                FitPolicy.WIDTH -> viewportWidth / width
                FitPolicy.HEIGHT -> viewportHeight / height
                FitPolicy.PAGE -> min(viewportWidth / width, viewportHeight / height)
            }
            scales[index] = scale
            sized.add(width * scale to height * scale)
        }
        val cross = if (horizontal) {
            max(viewportHeight, sized.maxOfOrNull { it.second } ?: 0f)
        } else {
            max(viewportWidth, sized.maxOfOrNull { it.first } ?: 0f)
        }
        crossLength = cross
        val boxes = ArrayList<PageBox>(count)
        var cursor = 0f
        val order = if (horizontal && rtl) sized.indices.reversed() else sized.indices
        val placed = arrayOfNulls<PageBox>(count)
        for (index in order) {
            val (width, height) = sized[index]
            placed[index] = if (horizontal) {
                PageBox(cursor, (cross - height) / 2f, width, height).also { cursor += width + spacing }
            } else {
                PageBox((cross - width) / 2f, cursor, width, height).also { cursor += height + spacing }
            }
        }
        placed.forEach { boxes.add(it!!) }
        pages = boxes
        length = if (count == 0) 0f else cursor - spacing
    }

    fun contentWidth(zoom: Float): Float = (if (horizontal) length else crossLength) * zoom

    fun contentHeight(zoom: Float): Float = (if (horizontal) crossLength else length) * zoom

    /** Start of page `index` along the scroll axis at zoom 1. */
    fun pageStart(index: Int): Float = if (horizontal) pages[index].left else pages[index].top

    fun pageEnd(index: Int): Float = if (horizontal) pages[index].right else pages[index].bottom

    /** Pages intersecting [start, end) on the scroll axis (zoom 1 units). Empty if none. */
    fun pagesBetween(start: Float, end: Float): IntRange {
        if (pages.isEmpty() || end <= start) return IntRange.EMPTY
        var first = -1
        var last = -1
        for (index in pages.indices) {
            if (pageEnd(index) > start && pageStart(index) < end) {
                if (first == -1 || index < first) first = index
                if (index > last) last = index
            }
        }
        return if (first == -1) IntRange.EMPTY else first..last
    }

    /**
     * The page under `position` (zoom 1 units on the scroll axis). Gaps belong to
     * the following page; positions past the end belong to the nearest page.
     */
    fun pageAt(position: Float): Int {
        if (pages.isEmpty()) return -1
        var best = 0
        var bestDistance = Float.MAX_VALUE
        for (index in pages.indices) {
            val start = pageStart(index)
            val end = pageEnd(index)
            if (position >= start && position < end + spacing) return index
            val distance = if (position < start) start - position else position - end
            if (distance < bestDistance) {
                bestDistance = distance
                best = index
            }
        }
        return best
    }

    /** Page shown in the middle of the viewport; the last page once scrolled to the end. */
    fun currentPage(scrollOffset: Float, zoom: Float): Int {
        if (pages.isEmpty()) return -1
        val viewport = if (horizontal) viewportWidth else viewportHeight
        val maxOffset = max(0f, length * zoom - viewport)
        if (maxOffset > 0 && scrollOffset >= maxOffset - 1f) {
            return if (horizontal && rtl) 0 else pages.lastIndex
        }
        return pageAt((scrollOffset + viewport / 2f) / zoom)
    }

    /** Scroll offset (zoomed) that shows page `index` at the start of the viewport, clamped. */
    fun offsetForPage(index: Int, zoom: Float): Float {
        if (pages.isEmpty()) return 0f
        val page = index.coerceIn(0, pages.lastIndex)
        val viewport = if (horizontal) viewportWidth else viewportHeight
        val maxOffset = max(0f, length * zoom - viewport)
        return (pageStart(page) * zoom).coerceIn(0f, maxOffset)
    }
}
