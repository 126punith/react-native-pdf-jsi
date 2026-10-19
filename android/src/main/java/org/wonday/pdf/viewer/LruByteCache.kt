package org.wonday.pdf.viewer

/**
 * Least-recently-used map bounded by total size in bytes. Evicted values go to
 * [onEvict] (the viewer returns bitmaps to its pool there). Not thread-safe:
 * the viewer only touches it on the main thread.
 */
class LruByteCache<K, V>(
    maxBytes: Long,
    private val sizeOf: (V) -> Long,
    private val onEvict: (K, V) -> Unit = { _, _ -> },
) {
    private val map = LinkedHashMap<K, V>(16, 0.75f, true)

    var maxBytes: Long = maxBytes
        set(value) {
            field = value
            trimTo(value)
        }

    var size: Long = 0
        private set

    val count: Int get() = map.size

    operator fun get(key: K): V? = map[key]

    fun containsKey(key: K): Boolean = map.containsKey(key)

    fun put(key: K, value: V) {
        val previous = map.put(key, value)
        size += sizeOf(value)
        if (previous != null) {
            size -= sizeOf(previous)
            if (previous !== value) onEvict(key, previous)
        }
        trimTo(maxBytes)
    }

    fun remove(key: K): V? {
        val value = map.remove(key) ?: return null
        size -= sizeOf(value)
        onEvict(key, value)
        return value
    }

    /** Removes every entry for which `predicate` is true. */
    fun removeIf(predicate: (K) -> Boolean) {
        val iterator = map.entries.iterator()
        while (iterator.hasNext()) {
            val (key, value) = iterator.next()
            if (predicate(key)) {
                iterator.remove()
                size -= sizeOf(value)
                onEvict(key, value)
            }
        }
    }

    fun clear() = removeIf { true }

    fun keys(): Set<K> = LinkedHashSet(map.keys)

    fun trimTo(limit: Long) {
        val iterator = map.entries.iterator()
        while (size > limit && iterator.hasNext()) {
            val (key, value) = iterator.next()
            iterator.remove()
            size -= sizeOf(value)
            onEvict(key, value)
        }
    }
}
