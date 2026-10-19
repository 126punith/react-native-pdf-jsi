package org.wonday.pdf.viewer

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/** Tile maths for the zoomed layer. Pure functions so they can be unit tested. */
object TileGrid {
    const val TILE_SIZE = 512
    private const val BUCKET_STEP = 1.25

    /** Zoom levels are quantised so small pinch changes reuse tiles. */
    fun bucketFor(zoom: Float): Int = (ln(zoom.toDouble().coerceAtLeast(1.0)) / ln(BUCKET_STEP)).roundToInt()

    fun zoomFor(bucket: Int): Float = BUCKET_STEP.pow(bucket).toFloat()

    data class Tile(val column: Int, val row: Int, val left: Int, val top: Int, val width: Int, val height: Int)

    /**
     * Tiles of a page rendered at `pageWidth` x `pageHeight` pixels that intersect
     * the visible rectangle (page pixel coordinates).
     */
    fun visibleTiles(
        pageWidth: Int,
        pageHeight: Int,
        visibleLeft: Float,
        visibleTop: Float,
        visibleRight: Float,
        visibleBottom: Float,
    ): List<Tile> {
        if (pageWidth <= 0 || pageHeight <= 0) return emptyList()
        val left = visibleLeft.coerceIn(0f, pageWidth.toFloat())
        val right = visibleRight.coerceIn(0f, pageWidth.toFloat())
        val top = visibleTop.coerceIn(0f, pageHeight.toFloat())
        val bottom = visibleBottom.coerceIn(0f, pageHeight.toFloat())
        if (right <= left || bottom <= top) return emptyList()
        val firstColumn = floor(left / TILE_SIZE).toInt()
        val lastColumn = ceil(right / TILE_SIZE).toInt() - 1
        val firstRow = floor(top / TILE_SIZE).toInt()
        val lastRow = ceil(bottom / TILE_SIZE).toInt() - 1
        val tiles = ArrayList<Tile>()
        for (row in firstRow..lastRow) {
            for (column in firstColumn..lastColumn) {
                val x = column * TILE_SIZE
                val y = row * TILE_SIZE
                tiles.add(Tile(column, row, x, y, minOf(TILE_SIZE, pageWidth - x), minOf(TILE_SIZE, pageHeight - y)))
            }
        }
        return tiles
    }
}
