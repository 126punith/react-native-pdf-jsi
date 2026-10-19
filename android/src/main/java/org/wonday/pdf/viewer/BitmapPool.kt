package org.wonday.pdf.viewer

import android.graphics.Bitmap

/**
 * Reuses ARGB_8888 bitmaps of the same size (tiles are mostly 512x512) so
 * scrolling does not churn the Java heap. Thread-safe: the render thread takes,
 * the main thread returns.
 */
class BitmapPool(private val maxBytes: Long) {
    private val free = HashMap<Long, ArrayDeque<Bitmap>>()
    private var bytes = 0L

    private fun keyOf(width: Int, height: Int) = (width.toLong() shl 32) or height.toLong()

    @Synchronized
    fun take(width: Int, height: Int): Bitmap {
        val bitmap = free[keyOf(width, height)]?.removeFirstOrNull()
        if (bitmap != null) {
            bytes -= bitmap.allocationByteCount
            return bitmap
        }
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    }

    @Synchronized
    fun give(bitmap: Bitmap) {
        if (bitmap.isRecycled || !bitmap.isMutable) return
        if (bytes + bitmap.allocationByteCount > maxBytes) {
            bitmap.recycle()
            return
        }
        free.getOrPut(keyOf(bitmap.width, bitmap.height)) { ArrayDeque() }.addLast(bitmap)
        bytes += bitmap.allocationByteCount
    }

    @Synchronized
    fun clear() {
        free.values.forEach { queue -> queue.forEach { it.recycle() } }
        free.clear()
        bytes = 0
    }
}
