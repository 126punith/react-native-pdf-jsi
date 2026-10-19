package org.wonday.pdf.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LruByteCacheTest {
    private val evicted = ArrayList<String>()
    private fun cache(limit: Long) = LruByteCache<String, ByteArray>(limit, { it.size.toLong() }) { key, _ -> evicted.add(key) }

    @Test
    fun evictsLeastRecentlyUsedWhenOverBudget() {
        val cache = cache(30)
        cache.put("a", ByteArray(10))
        cache.put("b", ByteArray(10))
        cache.put("c", ByteArray(10))
        cache["a"]
        cache.put("d", ByteArray(10))
        assertEquals(listOf("b"), evicted)
        assertNull(cache["b"])
        assertEquals(30L, cache.size)
        assertEquals(setOf("c", "a", "d"), cache.keys())
    }

    @Test
    fun replacingAKeyAdjustsSizeAndReleasesTheOldValue() {
        val cache = cache(100)
        cache.put("a", ByteArray(10))
        cache.put("a", ByteArray(25))
        assertEquals(25L, cache.size)
        assertEquals(listOf("a"), evicted)
        assertEquals(1, cache.count)
    }

    @Test
    fun removeIfAndShrinkingTheBudget() {
        val cache = cache(100)
        listOf("t:1", "t:2", "b:1", "b:2").forEach { cache.put(it, ByteArray(20)) }
        cache.removeIf { it.startsWith("t:") }
        assertEquals(setOf("b:1", "b:2"), cache.keys())
        assertEquals(40L, cache.size)
        cache.maxBytes = 20
        assertEquals(setOf("b:2"), cache.keys())
        cache.clear()
        assertEquals(0L, cache.size)
        assertEquals(listOf("t:1", "t:2", "b:1", "b:2"), evicted)
    }

    @Test
    fun aValueLargerThanTheBudgetIsDroppedImmediately() {
        val cache = cache(10)
        cache.put("huge", ByteArray(50))
        assertEquals(0, cache.count)
        assertEquals(listOf("huge"), evicted)
    }
}
