package org.wonday.pdf.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfLayoutTest {
    private val letter = 612f to 792f
    private val landscape = 792f to 612f

    @Test
    fun widthFitScalesEveryPageToTheViewportWidth() {
        val layout = PdfLayout(listOf(letter, landscape), 1080f, 1920f, FitPolicy.WIDTH, spacing = 20f)
        assertEquals(1080f, layout.pages[0].width, 0.01f)
        assertEquals(1080f, layout.pages[1].width, 0.01f)
        assertEquals(1080f / 612f, layout.scales[0], 0.0001f)
        assertEquals(layout.pages[0].bottom + 20f, layout.pages[1].top, 0.01f)
        assertEquals(layout.pages[1].bottom, layout.length, 0.01f)
    }

    @Test
    fun pageFitKeepsPagesInsideTheViewportAndCentred() {
        val layout = PdfLayout(listOf(landscape), 1080f, 1920f, FitPolicy.PAGE)
        val page = layout.pages[0]
        assertTrue(page.width <= 1080f + 0.01f && page.height <= 1920f + 0.01f)
        assertEquals((1080f - page.width) / 2f, page.left, 0.01f)

        val tall = PdfLayout(listOf(letter), 2000f, 500f, FitPolicy.PAGE)
        assertEquals(500f, tall.pages[0].height, 0.01f)
        assertEquals((2000f - tall.pages[0].width) / 2f, tall.pages[0].left, 0.01f)
    }

    @Test
    fun heightFitUsesTheViewportHeight() {
        val layout = PdfLayout(listOf(letter, landscape), 1080f, 1000f, FitPolicy.HEIGHT, horizontal = true)
        assertEquals(1000f, layout.pages[0].height, 0.01f)
        assertEquals(1000f, layout.pages[1].height, 0.01f)
        assertEquals(0f, layout.pages[0].left, 0.01f)
        assertEquals(layout.pages[0].right, layout.pages[1].left, 0.01f)
    }

    @Test
    fun rtlPlacesTheFirstPageOnTheRight() {
        val layout = PdfLayout(listOf(letter, letter, letter), 1000f, 1000f, FitPolicy.PAGE, horizontal = true, rtl = true)
        assertTrue(layout.pages[0].left > layout.pages[1].left)
        assertTrue(layout.pages[1].left > layout.pages[2].left)
        assertEquals(0f, layout.pages[2].left, 0.01f)
        assertEquals(2, layout.pageAt(10f))
    }

    @Test
    fun pageAtAssignsGapsToTheNextPage() {
        val layout = PdfLayout(listOf(letter, letter), 612f, 800f, FitPolicy.WIDTH, spacing = 10f)
        assertEquals(0, layout.pageAt(0f))
        assertEquals(0, layout.pageAt(791f))
        assertEquals(0, layout.pageAt(795f))
        assertEquals(1, layout.pageAt(802f))
        assertEquals(1, layout.pageAt(99999f))
        assertEquals(0, layout.pageAt(-50f))
    }

    @Test
    fun visibleRangeAndCurrentPage() {
        val pages = List(10) { letter }
        val layout = PdfLayout(pages, 612f, 800f, FitPolicy.WIDTH, spacing = 8f)
        assertEquals(0..0, layout.pagesBetween(0f, 800f))
        assertEquals(0..1, layout.pagesBetween(0f, 900f))
        assertEquals(IntRange.EMPTY, layout.pagesBetween(10f, 10f))
        assertEquals(0, layout.currentPage(0f, 1f))
        assertEquals(9, layout.currentPage(layout.length - 800f, 1f))
        assertEquals(2, layout.currentPage(layout.pageStart(2), 1f))
        assertEquals(2, layout.currentPage(layout.pageStart(2) * 2f, 2f))
    }

    @Test
    fun offsetForPageIsClampedToTheScrollRange() {
        val layout = PdfLayout(List(3) { letter }, 612f, 800f, FitPolicy.WIDTH)
        assertEquals(0f, layout.offsetForPage(0, 1f), 0.01f)
        assertEquals(792f, layout.offsetForPage(1, 1f), 0.01f)
        assertEquals(layout.length - 800f, layout.offsetForPage(2, 1f), 0.01f)
        assertEquals(layout.length - 800f, layout.offsetForPage(42, 1f), 0.01f)
        assertEquals(1584f, layout.offsetForPage(1, 2f), 0.01f)
    }

    @Test
    fun emptyPageSizesFallBackToLetter() {
        val layout = PdfLayout(listOf(0f to 0f), 612f, 800f, FitPolicy.WIDTH)
        assertEquals(792f, layout.pages[0].height, 0.01f)
    }
}
