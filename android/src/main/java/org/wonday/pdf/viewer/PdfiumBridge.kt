package org.wonday.pdf.viewer

import android.graphics.Bitmap

/** JNI entry points in libNitroPdfJsi (PdfViewerJni.cpp). Handles come from [nativeOpen]. */
object PdfiumBridge {
    init {
        System.loadLibrary("NitroPdfJsi")
    }

    /** Throws IllegalStateException with a `[code] message` text on failure. */
    @JvmStatic external fun nativeOpen(path: String, password: String?): Long

    @JvmStatic external fun nativeClose(handle: Long)

    /** Width and height in points, rotation applied, two floats per page. */
    @JvmStatic external fun nativePageSizes(handle: Long): FloatArray

    @JvmStatic external fun nativeRender(
        handle: Long,
        page: Int,
        bitmap: Bitmap,
        pageWidthPx: Float,
        pageHeightPx: Float,
        offsetX: Float,
        offsetY: Float,
        background: Int,
        annotations: Boolean,
    ): Boolean

    /** Five floats per link: x, y, width, height (points from the top-left), target page or -1. */
    @JvmStatic external fun nativeLinkRects(handle: Long, page: Int): FloatArray

    /** URI of each link from [nativeLinkRects], or null for internal links. */
    @JvmStatic external fun nativeLinkUris(handle: Long, page: Int): Array<String?>

    @JvmStatic external fun nativeOutlineTitles(handle: Long): Array<String>

    /** Two ints per outline item: target page and level. */
    @JvmStatic external fun nativeOutlineInfo(handle: Long): IntArray
}

private val CODE = Regex("""\[([a-z-]+)]\s*""")

/** Splits a native `[code] message` text. */
internal fun splitNativeError(message: String?): Pair<String, String> {
    val text = message ?: ""
    val match = CODE.find(text) ?: return "unknown" to text.ifEmpty { "Unknown error" }
    return match.groupValues[1] to text.substring(match.range.last + 1).trim()
}
