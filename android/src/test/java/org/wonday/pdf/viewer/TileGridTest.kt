package org.wonday.pdf.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TileGridTest {
    @Test
    fun bucketsRoundTripAndNeverGoBelowOne() {
        assertEquals(0, TileGrid.bucketFor(0.5f))
        assertEquals(0, TileGrid.bucketFor(1f))
        for (bucket in 1..10) {
            assertEquals(bucket, TileGrid.bucketFor(TileGrid.zoomFor(bucket)))
        }
        assertEquals(1.25f, TileGrid.zoomFor(1), 0.0001f)
    }

    @Test
    fun visibleTilesCoverTheVisibleRectAndClipAtPageEdges() {
        val tiles = TileGrid.visibleTiles(1300, 700, 100f, 100f, 1100f, 600f)
        assertEquals(listOf(0 to 0, 1 to 0, 2 to 0, 0 to 1, 1 to 1, 2 to 1), tiles.map { it.column to it.row })
        val corner = tiles.last()
        assertEquals(1300 - 1024, corner.width)
        assertEquals(700 - 512, corner.height)
    }

    @Test
    fun noTilesWhenThePageIsOffScreen() {
        assertTrue(TileGrid.visibleTiles(1000, 1000, 1200f, 0f, 1500f, 500f).isEmpty())
        assertTrue(TileGrid.visibleTiles(0, 1000, 0f, 0f, 500f, 500f).isEmpty())
    }
}
