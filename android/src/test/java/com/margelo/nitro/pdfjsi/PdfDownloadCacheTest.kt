package com.margelo.nitro.pdfjsi

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PdfDownloadCacheTest {
  @get:Rule
  val folder = TemporaryFolder()

  private lateinit var server: HttpServer
  private lateinit var cache: PdfDownloadCache
  private val requests = AtomicInteger()
  private val rangeRequests = AtomicInteger()

  /** Per-path behaviour for the test server. */
  private class Route(
    var body: ByteArray,
    var etag: String? = "\"v1\"",
    var status: Int = 200,
    var truncateFirst: Boolean = false,
    var delayPerChunkMs: Long = 0,
    var acceptRanges: Boolean = true,
    val started: CountDownLatch = CountDownLatch(1),
    var release: CountDownLatch? = null,
  )

  private val routes = HashMap<String, Route>()

  private fun pdf(size: Int, seed: Int = 1): ByteArray {
    val bytes = ByteArray(size) { ((it * 31 + seed) % 251).toByte() }
    "%PDF-1.7\n".toByteArray().copyInto(bytes)
    return bytes
  }

  private fun url(path: String) = "http://127.0.0.1:${server.address.port}$path"

  @Before
  fun setUp() {
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.executor = Executors.newCachedThreadPool()
    server.createContext("/") { exchange -> handle(exchange) }
    server.start()
    cache = newCache()
  }

  private fun newCache() = PdfDownloadCache(
    sessionDir = folder.root.resolve("session"),
    persistentDir = folder.root.resolve("persistent"),
    tempDir = folder.root.resolve("tmp"),
    readTimeoutMs = 5_000,
    resumeBackoffMs = 10,
  )

  @After
  fun tearDown() {
    server.stop(0)
    cache.shutdown()
  }

  private fun handle(exchange: HttpExchange) {
    requests.incrementAndGet()
    val route = routes[exchange.requestURI.path]
    if (route == null) {
      exchange.sendResponseHeaders(404, -1)
      exchange.close()
      return
    }
    route.started.countDown()
    route.release?.await(5, TimeUnit.SECONDS)
    val headers = exchange.responseHeaders
    route.etag?.let { headers.add("ETag", it) }
    if (route.acceptRanges) headers.add("Accept-Ranges", "bytes")
    if (route.status != 200) {
      exchange.sendResponseHeaders(route.status, -1)
      exchange.close()
      return
    }
    val ifNoneMatch = exchange.requestHeaders.getFirst("If-None-Match")
    if (ifNoneMatch != null && ifNoneMatch == route.etag) {
      exchange.sendResponseHeaders(304, -1)
      exchange.close()
      return
    }
    val range = exchange.requestHeaders.getFirst("Range")
    val ifRange = exchange.requestHeaders.getFirst("If-Range")
    var start = 0
    if (range != null && (ifRange == null || ifRange == route.etag)) {
      rangeRequests.incrementAndGet()
      start = Regex("""bytes=(\d+)-""").find(range)!!.groupValues[1].toInt()
      headers.add("Content-Range", "bytes $start-${route.body.size - 1}/${route.body.size}")
      exchange.sendResponseHeaders(206, (route.body.size - start).toLong())
    } else {
      exchange.sendResponseHeaders(200, route.body.size.toLong())
    }
    val output = exchange.responseBody
    try {
      val end = if (route.truncateFirst) {
        route.truncateFirst = false
        route.body.size / 2
      } else {
        route.body.size
      }
      var index = start
      while (index < end) {
        val next = minOf(end, index + 8 * 1024)
        output.write(route.body, index, next - index)
        output.flush()
        index = next
        if (route.delayPerChunkMs > 0) Thread.sleep(route.delayPerChunkMs)
      }
    } catch (_: Exception) {
      // Client went away.
    } finally {
      exchange.close()
    }
  }

  private fun request(
    path: String,
    id: String = "r-${System.nanoTime()}",
    mode: CacheMode = CacheMode.SESSION,
    maxAgeMs: Long? = null,
    headers: Map<String, String> = emptyMap(),
    cacheKey: String? = null,
    chunkThreshold: Long = DownloadRequest.DEFAULT_CHUNK_THRESHOLD,
  ) = DownloadRequest(id, url(path), headers, cacheKey, mode, maxAgeMs, chunkThreshold)

  private fun download(request: DownloadRequest, listener: ProgressListener? = null): CacheRecord =
    cache.download(request, listener).get(10, TimeUnit.SECONDS)

  private fun failureCode(block: () -> Unit): String {
    try {
      block()
    } catch (error: ExecutionException) {
      val cause = error.cause
      if (cause is PdfCacheException) return cause.code
      throw error
    }
    fail("expected a failure")
    return ""
  }

  @Test
  fun downloadsAndStoresTheFile() {
    val body = pdf(100_000)
    routes["/a.pdf"] = Route(body)
    val record = download(request("/a.pdf"))
    assertFalse(record.fromCache)
    assertArrayEquals(body, record.file.readBytes())
    assertEquals("\"v1\"", record.etag)
    assertEquals(body.size.toLong(), record.byteSize)
  }

  @Test
  fun freshCopyWithinMaxAgeSkipsTheNetwork() {
    routes["/a.pdf"] = Route(pdf(10_000))
    download(request("/a.pdf"))
    val before = requests.get()
    val record = download(request("/a.pdf", maxAgeMs = 60_000))
    assertTrue(record.fromCache)
    assertEquals(before, requests.get())
  }

  @Test
  fun revalidatesWithEtagAndKeepsTheCopyOn304() {
    routes["/a.pdf"] = Route(pdf(10_000))
    val first = download(request("/a.pdf"))
    val second = download(request("/a.pdf"))
    assertTrue(second.fromCache)
    assertFalse(second.stale)
    assertEquals(first.file, second.file)
    assertEquals(2, requests.get())
  }

  @Test
  fun changedEtagReplacesTheCopy() {
    routes["/a.pdf"] = Route(pdf(10_000, seed = 1))
    download(request("/a.pdf"))
    val updated = pdf(12_000, seed = 2)
    routes["/a.pdf"] = Route(updated, etag = "\"v2\"")
    val record = download(request("/a.pdf"))
    assertFalse(record.fromCache)
    assertArrayEquals(updated, record.file.readBytes())
  }

  @Test
  fun offlineFallsBackToTheStoredCopy() {
    routes["/a.pdf"] = Route(pdf(10_000))
    val first = download(request("/a.pdf"))
    server.stop(0)
    val record = download(request("/a.pdf"))
    assertTrue(record.stale)
    assertTrue(record.fromCache)
    assertEquals(first.file, record.file)
  }

  @Test
  fun serverErrorFallsBackButClientErrorFails() {
    routes["/a.pdf"] = Route(pdf(10_000))
    download(request("/a.pdf"))
    routes["/a.pdf"]!!.status = 503
    assertTrue(download(request("/a.pdf")).stale)
    routes["/a.pdf"]!!.status = 403
    assertEquals("download-failed", failureCode { download(request("/a.pdf")) })
  }

  @Test
  fun missingDocumentFails() {
    assertEquals("download-failed", failureCode { download(request("/missing.pdf")) })
  }

  @Test
  fun nonPdfResponseIsRejected() {
    routes["/login"] = Route("<html>sign in</html>".toByteArray())
    assertEquals("download-failed", failureCode { download(request("/login")) })
    assertNull(cache.getEntry(url("/login"), emptyMap(), null))
  }

  @Test
  fun concurrentRequestsShareOneDownload() {
    val release = CountDownLatch(1)
    routes["/a.pdf"] = Route(pdf(50_000), release = release)
    val first = cache.download(request("/a.pdf", id = "one"), null)
    val second = cache.download(request("/a.pdf", id = "two"), null)
    release.countDown()
    assertEquals(first.get(10, TimeUnit.SECONDS).file, second.get(10, TimeUnit.SECONDS).file)
    assertEquals(1, requests.get())
  }

  @Test
  fun interruptedLargeDownloadResumesWithRange() {
    val body = pdf(400_000)
    routes["/big.pdf"] = Route(body, truncateFirst = true)
    val record = download(request("/big.pdf", chunkThreshold = 1_000))
    assertArrayEquals(body, record.file.readBytes())
    assertEquals(1, rangeRequests.get())
  }

  @Test
  fun interruptedSmallDownloadDoesNotResume() {
    routes["/small.pdf"] = Route(pdf(100_000), truncateFirst = true)
    assertEquals("download-failed", failureCode { download(request("/small.pdf")) })
    assertEquals(0, rangeRequests.get())
  }

  @Test
  fun cancellingTheOnlyRequestStopsTheDownload() {
    val route = Route(pdf(2_000_000), delayPerChunkMs = 20)
    routes["/slow.pdf"] = route
    val future = cache.download(request("/slow.pdf", id = "slow"), null)
    route.started.await(5, TimeUnit.SECONDS)
    cache.cancel("slow")
    assertEquals("cancelled", failureCode { future.get(10, TimeUnit.SECONDS) })
  }

  @Test
  fun cancellingOneSharedRequestKeepsTheOther() {
    val release = CountDownLatch(1)
    routes["/a.pdf"] = Route(pdf(50_000), release = release)
    val first = cache.download(request("/a.pdf", id = "one"), null)
    val second = cache.download(request("/a.pdf", id = "two"), null)
    cache.cancel("one")
    release.countDown()
    assertEquals("cancelled", failureCode { first.get(10, TimeUnit.SECONDS) })
    assertTrue(second.get(10, TimeUnit.SECONDS).file.isFile)
  }

  @Test
  fun progressIsReportedWithTheTotal() {
    val body = pdf(300_000)
    routes["/a.pdf"] = Route(body)
    var last = 0L to 0L
    download(request("/a.pdf")) { loaded, total -> last = loaded to total }
    assertEquals(body.size.toLong() to body.size.toLong(), last)
  }

  @Test
  fun leastRecentlyUsedSessionEntriesAreEvicted() {
    routes["/a.pdf"] = Route(pdf(60_000, 1))
    routes["/b.pdf"] = Route(pdf(60_000, 2))
    cache.maxCacheBytes = 100_000
    val a = download(request("/a.pdf"))
    Thread.sleep(5)
    val b = download(request("/b.pdf"))
    assertFalse(a.file.exists())
    assertTrue(b.file.exists())
  }

  @Test
  fun persistentEntriesAreNotEvicted() {
    routes["/a.pdf"] = Route(pdf(60_000, 1))
    routes["/b.pdf"] = Route(pdf(60_000, 2))
    cache.maxCacheBytes = 100_000
    val a = download(request("/a.pdf", mode = CacheMode.PERSISTENT))
    download(request("/b.pdf"))
    assertTrue(a.file.exists())
    assertTrue(a.persistent)
  }

  @Test
  fun cacheKeysDependOnHeadersUnlessACacheKeyIsGiven() {
    val plain = PdfDownloadCache.keyFor("https://x/a.pdf", emptyMap(), null)
    val withAuth = PdfDownloadCache.keyFor("https://x/a.pdf", mapOf("Authorization" to "a"), null)
    val sameAuthOtherCase = PdfDownloadCache.keyFor("https://x/a.pdf", mapOf("authorization" to "a"), null)
    assertNotEquals(plain, withAuth)
    assertEquals(withAuth, sameAuthOtherCase)
    assertEquals(
      PdfDownloadCache.keyFor("https://x/a.pdf?sig=1", emptyMap(), "doc"),
      PdfDownloadCache.keyFor("https://x/a.pdf?sig=2", emptyMap(), "doc"),
    )
  }

  @Test
  fun entriesCanBeLookedUpRemovedAndCleared() {
    routes["/a.pdf"] = Route(pdf(10_000))
    val record = download(request("/a.pdf"))
    assertEquals(record.key, cache.getEntry(url("/a.pdf"), emptyMap(), null)?.key)
    assertTrue(cache.byteSize() >= 10_000)
    assertTrue(cache.remove(record.key))
    assertNull(cache.getEntry(url("/a.pdf"), emptyMap(), null))
    download(request("/a.pdf"))
    cache.clear()
    assertEquals(0L, cache.byteSize())
  }

  @Test
  fun noneModeDoesNotKeepMetadata() {
    routes["/a.pdf"] = Route(pdf(10_000))
    download(request("/a.pdf", mode = CacheMode.NONE))
    assertNull(cache.getEntry(url("/a.pdf"), emptyMap(), null))
    download(request("/a.pdf", mode = CacheMode.NONE))
    assertEquals(2, requests.get())
  }

  @Test
  fun noneModeFilesSurviveARestartUntilTheyAreOld() {
    routes["/a.pdf"] = Route(pdf(10_000, 1))
    routes["/b.pdf"] = Route(pdf(10_000, 2))
    val recent = download(request("/a.pdf", mode = CacheMode.NONE))
    val old = download(request("/b.pdf", mode = CacheMode.NONE))
    assertTrue(old.file.setLastModified(System.currentTimeMillis() - PdfDownloadCache.TEMP_MAX_AGE_MS - 60_000))
    cache.shutdown()
    cache = newCache()
    assertTrue(recent.file.exists())
    assertFalse(old.file.exists())
  }
}
