package org.wonday.pdf.viewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RenderQueueTest {
    /** Blocks the worker so jobs can be queued deterministically. */
    private fun blocked(queue: RenderQueue): CountDownLatch {
        val gate = CountDownLatch(1)
        val started = CountDownLatch(1)
        queue.submit("gate", -1000) {
            started.countDown()
            gate.await(5, TimeUnit.SECONDS)
        }
        assertTrue(started.await(5, TimeUnit.SECONDS))
        return gate
    }

    @Test
    fun runsLowestPriorityFirstThenFifo() {
        val queue = RenderQueue("test")
        val order = Collections.synchronizedList(ArrayList<String>())
        val gate = blocked(queue)
        val done = CountDownLatch(4)
        listOf("c" to 5, "a" to 1, "b" to 1, "d" to 0).forEach { (key, priority) ->
            queue.submit(key, priority) {
                order.add(key)
                done.countDown()
            }
        }
        gate.countDown()
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("d", "a", "b", "c"), order)
        queue.shutdown()
    }

    @Test
    fun dedupesPendingKeysAndKeepsTheBetterPriority() {
        val queue = RenderQueue("test")
        val gate = blocked(queue)
        assertTrue(queue.submit("x", 10) {})
        assertFalse(queue.submit("x", 2) {})
        assertTrue(queue.submit("y", 5) {})
        assertEquals(listOf("x", "y"), queue.pendingKeys())
        assertFalse(queue.submit("gate", 0) {})
        gate.countDown()
        queue.shutdown()
    }

    @Test
    fun retainDropsUnwantedJobsButKeepsPinnedOnes() {
        val queue = RenderQueue("test")
        val gate = blocked(queue)
        queue.submit("keep", 1) {}
        queue.submit("drop", 1) {}
        queue.submit("${RenderQueue.PINNED}close", 1) {}
        queue.retain(setOf("keep"))
        assertEquals(listOf("keep", "${RenderQueue.PINNED}close"), queue.pendingKeys())
        queue.cancelAll()
        assertTrue(queue.pendingKeys().isEmpty())
        gate.countDown()
        queue.shutdown()
    }

    @Test
    fun aFailingJobDoesNotStopTheWorker() {
        val queue = RenderQueue("test")
        val ran = CountDownLatch(1)
        queue.submit("boom", 0) { error("render failed") }
        queue.submit("after", 1) { ran.countDown() }
        assertTrue(ran.await(5, TimeUnit.SECONDS))
        queue.shutdown()
    }

    @Test
    fun shutdownRejectsNewJobsAndEndsTheThread() {
        val queue = RenderQueue("test")
        queue.shutdown()
        assertFalse(queue.submit("late", 0) {})
        queue.join(2000)
    }
}
