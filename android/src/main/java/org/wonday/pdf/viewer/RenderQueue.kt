package org.wonday.pdf.viewer

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * One background thread that runs render jobs, lowest priority value first.
 * PDFium is single-threaded, so more threads would only queue on its lock.
 *
 * Jobs are keyed: submitting a key that is pending replaces its priority, and
 * [retain] drops pending jobs the viewer no longer needs.
 */
class RenderQueue(name: String = "pdf-render") {
    private class Job(val key: String, var priority: Int, val sequence: Long, val work: () -> Unit)

    private val lock = ReentrantLock()
    private val available = lock.newCondition()
    private val pending = LinkedHashMap<String, Job>()
    private val running = HashSet<String>()
    private var sequence = 0L
    @Volatile private var stopped = false

    private val thread = Thread({ loop() }, name).apply {
        isDaemon = true
        priority = Thread.NORM_PRIORITY - 1
        start()
    }

    /** Queues `work` unless the key is pending or running. Returns false when it was already queued. */
    fun submit(key: String, priority: Int, work: () -> Unit): Boolean = lock.withLock {
        if (stopped || key in running) return false
        val existing = pending[key]
        if (existing != null) {
            existing.priority = minOf(existing.priority, priority)
            return false
        }
        pending[key] = Job(key, priority, sequence++, work)
        available.signal()
        true
    }

    /** Drops pending jobs whose key is not in `keys`. Keys starting with `!` are kept. Running jobs finish. */
    fun retain(keys: Set<String>) = lock.withLock {
        pending.keys.retainAll { it in keys || it.startsWith(PINNED) }
    }

    fun cancelAll() = lock.withLock { pending.clear() }

    fun isQueued(key: String): Boolean = lock.withLock { key in pending || key in running }

    fun pendingKeys(): List<String> = lock.withLock {
        pending.values.sortedWith(compareBy<Job>({ it.priority }, { it.sequence })).map { it.key }
    }

    /** Stops the thread after the running job. Pending jobs are dropped. */
    fun shutdown() {
        lock.withLock {
            stopped = true
            pending.clear()
            available.signalAll()
        }
    }

    private fun next(): Job? = lock.withLock {
        while (!stopped && pending.isEmpty()) {
            available.await()
        }
        if (stopped) return null
        val job = pending.values.minWith(compareBy<Job>({ it.priority }, { it.sequence }))
        pending.remove(job.key)
        running.add(job.key)
        job
    }

    private fun loop() {
        while (true) {
            val job = try {
                next()
            } catch (_: InterruptedException) {
                null
            } ?: return
            try {
                job.work()
            } catch (_: Throwable) {
                // A failed render leaves the base image in place; the next pass retries.
            } finally {
                lock.withLock { running.remove(job.key) }
            }
        }
    }

    internal fun join(timeoutMs: Long) = thread.join(timeoutMs)

    companion object {
        const val PINNED = "!"
    }
}
