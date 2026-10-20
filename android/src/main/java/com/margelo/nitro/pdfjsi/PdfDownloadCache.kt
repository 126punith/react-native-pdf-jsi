package com.margelo.nitro.pdfjsi

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Properties
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/** Errors whose message starts with a `[code]` the JS layer maps to a PdfError. */
class PdfCacheException(val code: String, message: String, cause: Throwable? = null) :
  Exception("[$code] $message", cause)

enum class CacheMode { NONE, SESSION, PERSISTENT }

class DownloadRequest(
  val requestId: String,
  val url: String,
  val headers: Map<String, String>,
  val cacheKey: String?,
  val mode: CacheMode,
  val maxAgeMs: Long?,
  val chunkThresholdBytes: Long = DEFAULT_CHUNK_THRESHOLD,
) {
  companion object {
    const val DEFAULT_CHUNK_THRESHOLD = 32L * 1024 * 1024
  }
}

data class CacheRecord(
  val key: String,
  val url: String,
  val file: File,
  val byteSize: Long,
  val etag: String,
  val lastModified: String,
  val validatedAtMs: Long,
  val lastAccessMs: Long,
  val persistent: Boolean,
  val stale: Boolean,
  val fromCache: Boolean,
)

fun interface ProgressListener {
  /** `total` is -1 when the server sent no length. */
  fun onProgress(loaded: Long, total: Long)
}

/**
 * Downloads PDFs into a disk cache.
 *
 * - Entries are `<sha256>.pdf` plus a `<sha256>.meta` properties file.
 * - Stored copies are revalidated with If-None-Match / If-Modified-Since;
 *   when the request fails with a network error or a 5xx, the stored copy is
 *   returned with `stale = true`.
 * - Files above the chunk threshold are resumable: an interrupted download
 *   continues with `Range` + `If-Range` instead of starting over, also after
 *   the app restarts.
 * - Concurrent requests for the same document share one download.
 * - The session cache is capped at [maxCacheBytes]; least recently used
 *   entries go first. Persistent entries are only removed explicitly.
 *
 * Plain JVM code (no Android APIs) so it can be tested against a local server.
 */
class PdfDownloadCache(
  private val sessionDir: File,
  private val persistentDir: File,
  private val tempDir: File,
  private val clock: () -> Long = System::currentTimeMillis,
  private val executor: ExecutorService = Executors.newFixedThreadPool(3, DownloadThreadFactory()),
  private val connectTimeoutMs: Int = 15_000,
  private val readTimeoutMs: Int = 30_000,
  private val resumeBackoffMs: Long = 500,
  private val tempMaxAgeMs: Long = TEMP_MAX_AGE_MS,
) {
  @Volatile
  var maxCacheBytes: Long = DEFAULT_MAX_CACHE_BYTES

  private class Waiter(val future: CompletableFuture<CacheRecord>, val listener: ProgressListener?)

  private class Job(val id: String, val key: String, val request: DownloadRequest) {
    val waiters = LinkedHashMap<String, Waiter>()
    @Volatile var cancelled = false
    @Volatile var connection: HttpURLConnection? = null
  }

  private class ServerError(val status: Int) : RuntimeException("HTTP $status")

  private class ResumeState(val etag: String, val lastModified: String, val total: Long)

  private val lock = Any()
  private val jobs = HashMap<String, Job>()
  private val jobsByRequest = HashMap<String, Job>()
  /** A cancelled download may still be unwinding; a new one for the same files waits for it. */
  private val fileLocks = ConcurrentHashMap<String, Any>()

  init {
    sessionDir.mkdirs()
    persistentDir.mkdirs()
    tempDir.mkdirs()
    pruneTemp()
  }

  /** Uncached downloads outlive the launch that made them, so a path kept by the app still opens after a restart. */
  private fun pruneTemp() {
    val cutoff = clock() - tempMaxAgeMs
    tempDir.listFiles()?.forEach { file ->
      if (file.lastModified() < cutoff) {
        file.deleteRecursively()
      }
    }
  }

  fun download(request: DownloadRequest, listener: ProgressListener?): CompletableFuture<CacheRecord> {
    val future = CompletableFuture<CacheRecord>()
    val key = keyFor(request.url, request.headers, request.cacheKey)
    val jobId = "${request.mode}:$key"
    synchronized(lock) {
      val running = jobs[jobId]
      val job = if (running != null && !running.cancelled) {
        running
      } else {
        Job(jobId, key, request).also { jobs[jobId] = it }
      }
      job.waiters[request.requestId] = Waiter(future, listener)
      jobsByRequest[request.requestId] = job
      if (job !== running) {
        executor.execute { run(job) }
      }
    }
    return future
  }

  /** Cancels one request. The shared download stops once no request waits for it. */
  fun cancel(requestId: String) {
    var connection: HttpURLConnection? = null
    val waiter: Waiter?
    synchronized(lock) {
      val job = jobsByRequest.remove(requestId) ?: return
      waiter = job.waiters.remove(requestId)
      if (job.waiters.isEmpty()) {
        job.cancelled = true
        connection = job.connection
        if (jobs[job.id] === job) {
          jobs.remove(job.id)
        }
      }
    }
    waiter?.future?.completeExceptionally(cancelledError())
    connection?.let { runCatching { it.disconnect() } }
  }

  fun getEntry(url: String, headers: Map<String, String>, cacheKey: String?): CacheRecord? {
    val key = keyFor(url, headers, cacheKey)
    return readRecord(persistentDir, key, true) ?: readRecord(sessionDir, key, false)
  }

  fun remove(key: String): Boolean {
    if (!KEY_PATTERN.matches(key)) {
      return false
    }
    var removed = false
    for (dir in listOf(sessionDir, persistentDir)) {
      for (suffix in listOf(".pdf", ".meta", ".part", ".partmeta")) {
        val file = File(dir, key + suffix)
        if (file.exists() && file.delete() && suffix == ".pdf") {
          removed = true
        }
      }
    }
    return removed
  }

  fun clear() {
    for (dir in listOf(sessionDir, persistentDir)) {
      dir.listFiles()?.forEach { it.deleteRecursively() }
    }
  }

  fun byteSize(): Long = listOf(sessionDir, persistentDir).sumOf { dir ->
    dir.listFiles()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L
  }

  fun shutdown() {
    executor.shutdownNow()
  }

  // ---------------------------------------------------------------------------

  private fun run(job: Job) {
    val result = runCatching {
      synchronized(fileLocks.computeIfAbsent(job.id) { Any() }) { perform(job) }
    }.recoverCatching { error ->
      throw when {
        job.cancelled -> cancelledError()
        error is PdfCacheException -> error
        else -> PdfCacheException("download-failed", "The download failed: ${error.message ?: error.javaClass.simpleName}", error)
      }
    }
    val waiters: List<Waiter>
    synchronized(lock) {
      if (jobs[job.id] === job) {
        jobs.remove(job.id)
      }
      job.waiters.keys.forEach { jobsByRequest.remove(it) }
      waiters = job.waiters.values.toList()
      job.waiters.clear()
    }
    result.fold(
      onSuccess = { record ->
        if (job.request.mode == CacheMode.SESSION) {
          enforceLimit(keep = record.key)
        }
        waiters.forEach { it.future.complete(record) }
      },
      onFailure = { error -> waiters.forEach { it.future.completeExceptionally(error) } },
    )
  }

  private fun dirFor(mode: CacheMode): File = when (mode) {
    CacheMode.NONE -> tempDir
    CacheMode.SESSION -> sessionDir
    CacheMode.PERSISTENT -> persistentDir
  }

  private fun perform(job: Job): CacheRecord {
    val request = job.request
    val dir = dirFor(request.mode)
    val persistent = request.mode == CacheMode.PERSISTENT
    val existing = if (request.mode == CacheMode.NONE) null else readRecord(dir, job.key, persistent)
    val now = clock()
    if (existing != null && request.maxAgeMs != null && now - existing.validatedAtMs <= request.maxAgeMs) {
      return touch(dir, existing).copy(fromCache = true, stale = false)
    }
    return try {
      fetch(job, dir, existing)
    } catch (error: IOException) {
      if (job.cancelled) throw cancelledError()
      existing?.let { touch(dir, it).copy(fromCache = true, stale = true) }
        ?: throw PdfCacheException("download-failed", "The download failed: ${error.message ?: "network error"}", error)
    } catch (error: ServerError) {
      existing?.let { touch(dir, it).copy(fromCache = true, stale = true) }
        ?: throw PdfCacheException("download-failed", "The server answered HTTP ${error.status}.")
    }
  }

  private fun fetch(job: Job, dir: File, existing: CacheRecord?): CacheRecord {
    val request = job.request
    val key = job.key
    val target = File(dir, "$key.pdf")
    val part = File(dir, "$key.part")
    val partMeta = File(dir, "$key.partmeta")
    var resume = readResumeState(part, partMeta)
    var attempts = 0

    while (true) {
      if (job.cancelled) throw cancelledError()
      val connection = open(request)
      job.connection = connection
      try {
        val resuming = resume != null && part.length() > 0
        if (resuming) {
          val state = resume!!
          connection.setRequestProperty("Range", "bytes=${part.length()}-")
          connection.setRequestProperty("If-Range", state.etag.ifEmpty { state.lastModified })
        } else if (existing != null) {
          if (existing.etag.isNotEmpty()) connection.setRequestProperty("If-None-Match", existing.etag)
          if (existing.lastModified.isNotEmpty()) connection.setRequestProperty("If-Modified-Since", existing.lastModified)
        }

        val status = connection.responseCode
        if (job.cancelled) throw cancelledError()

        val etag: String
        val lastModified: String
        val total: Long
        when {
          status == HttpURLConnection.HTTP_NOT_MODIFIED && existing != null && !resuming -> {
            val now = clock()
            val updated = existing.copy(validatedAtMs = now, lastAccessMs = now, fromCache = true, stale = false)
            writeMeta(dir, updated)
            return updated
          }
          status == HttpURLConnection.HTTP_PARTIAL && resuming -> {
            val state = resume!!
            if (contentRangeStart(connection.getHeaderField("Content-Range")) != part.length()) {
              discardPartial(part, partMeta)
              resume = null
              continue
            }
            etag = state.etag
            lastModified = state.lastModified
            total = state.total
            stream(job, connection, part, append = true, total = total)
          }
          status == HttpURLConnection.HTTP_OK -> {
            etag = connection.getHeaderField("ETag").orEmpty()
            lastModified = connection.getHeaderField("Last-Modified").orEmpty()
            total = connection.contentLengthLong
            val resumable = total >= request.chunkThresholdBytes &&
              connection.getHeaderField("Accept-Ranges")?.contains("bytes", ignoreCase = true) == true &&
              (etag.isNotEmpty() || lastModified.isNotEmpty())
            discardPartial(part, partMeta)
            resume = if (resumable) ResumeState(etag, lastModified, total).also { writeResumeState(partMeta, it) } else null
            stream(job, connection, part, append = false, total = total)
          }
          status == HTTP_RANGE_NOT_SATISFIABLE && resuming -> {
            discardPartial(part, partMeta)
            resume = null
            continue
          }
          status >= 500 -> throw ServerError(status)
          else -> throw PdfCacheException("download-failed", "The server answered HTTP $status.")
        }

        if (total >= 0 && part.length() != total) {
          throw IOException("The connection closed after ${part.length()} of $total bytes.")
        }
        if (!looksLikePdf(part)) {
          discardPartial(part, partMeta)
          throw PdfCacheException("download-failed", "The server did not return a PDF.")
        }
        moveIntoPlace(part, target)
        partMeta.delete()
        val now = clock()
        val record = CacheRecord(
          key = key,
          url = request.url,
          file = target,
          byteSize = target.length(),
          etag = etag,
          lastModified = lastModified,
          validatedAtMs = now,
          lastAccessMs = now,
          persistent = request.mode == CacheMode.PERSISTENT,
          stale = false,
          fromCache = false,
        )
        if (request.mode != CacheMode.NONE) {
          writeMeta(dir, record)
        }
        return record
      } catch (error: IOException) {
        if (job.cancelled) throw cancelledError()
        if (resume != null && part.length() > 0 && attempts < MAX_RESUME_ATTEMPTS) {
          attempts += 1
          Thread.sleep(resumeBackoffMs * attempts)
          continue
        }
        if (resume == null) {
          discardPartial(part, partMeta)
        }
        throw error
      } finally {
        job.connection = null
        runCatching { connection.disconnect() }
      }
    }
  }

  private fun open(request: DownloadRequest): HttpURLConnection {
    val connection = URL(request.url).openConnection() as? HttpURLConnection
      ?: throw PdfCacheException("invalid-source", "Only http and https URLs can be downloaded.")
    connection.connectTimeout = connectTimeoutMs
    connection.readTimeout = readTimeoutMs
    connection.instanceFollowRedirects = true
    connection.useCaches = false
    request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
    // Byte offsets must match the file on the server for Range requests.
    connection.setRequestProperty("Accept-Encoding", "identity")
    return connection
  }

  private fun stream(job: Job, connection: HttpURLConnection, file: File, append: Boolean, total: Long) {
    var loaded = if (append) file.length() else 0L
    var lastEmit = 0L
    emit(job, loaded, total)
    connection.inputStream.use { input ->
      FileOutputStream(file, append).use { output ->
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) {
          if (job.cancelled) throw IOException("cancelled")
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
          loaded += read
          val now = clock()
          if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now
            emit(job, loaded, total)
          }
        }
        output.flush()
      }
    }
    emit(job, loaded, total)
  }

  private fun emit(job: Job, loaded: Long, total: Long) {
    val listeners = synchronized(lock) { job.waiters.values.mapNotNull { it.listener } }
    listeners.forEach { listener -> runCatching { listener.onProgress(loaded, total) } }
  }

  private fun enforceLimit(keep: String) {
    val limit = maxCacheBytes
    if (limit <= 0) return
    val busy = synchronized(lock) { jobs.values.map { it.key }.toSet() }
    val records = sessionDir.listFiles { file -> file.name.endsWith(".meta") }
      ?.mapNotNull { readRecord(sessionDir, it.name.removeSuffix(".meta"), false) }
      ?.sortedBy { it.lastAccessMs }
      ?: return
    var total = records.sumOf { it.byteSize }
    for (record in records) {
      if (total <= limit) break
      if (record.key == keep || record.key in busy) continue
      File(sessionDir, "${record.key}.pdf").delete()
      File(sessionDir, "${record.key}.meta").delete()
      total -= record.byteSize
    }
  }

  private fun readRecord(dir: File, key: String, persistent: Boolean): CacheRecord? {
    val file = File(dir, "$key.pdf")
    val metaFile = File(dir, "$key.meta")
    if (!file.isFile || !metaFile.isFile) return null
    val meta = runCatching { Properties().apply { FileInputStream(metaFile).use { load(it) } } }.getOrNull() ?: return null
    return CacheRecord(
      key = key,
      url = meta.getProperty("url").orEmpty(),
      file = file,
      byteSize = file.length(),
      etag = meta.getProperty("etag").orEmpty(),
      lastModified = meta.getProperty("lastModified").orEmpty(),
      validatedAtMs = meta.getProperty("validatedAtMs")?.toLongOrNull() ?: 0L,
      lastAccessMs = meta.getProperty("lastAccessMs")?.toLongOrNull() ?: 0L,
      persistent = persistent,
      stale = false,
      fromCache = true,
    )
  }

  private fun touch(dir: File, record: CacheRecord): CacheRecord {
    val updated = record.copy(lastAccessMs = clock())
    runCatching { writeMeta(dir, updated) }
    return updated
  }

  private fun writeMeta(dir: File, record: CacheRecord) {
    val meta = Properties()
    meta.setProperty("url", record.url)
    meta.setProperty("etag", record.etag)
    meta.setProperty("lastModified", record.lastModified)
    meta.setProperty("validatedAtMs", record.validatedAtMs.toString())
    meta.setProperty("lastAccessMs", record.lastAccessMs.toString())
    writeProperties(File(dir, "${record.key}.meta"), meta)
  }

  private fun readResumeState(part: File, partMeta: File): ResumeState? {
    if (!part.isFile || !partMeta.isFile) {
      discardPartial(part, partMeta)
      return null
    }
    val meta = runCatching { Properties().apply { FileInputStream(partMeta).use { load(it) } } }.getOrNull()
    val total = meta?.getProperty("total")?.toLongOrNull()
    if (meta == null || total == null || total <= 0 || part.length() >= total) {
      discardPartial(part, partMeta)
      return null
    }
    return ResumeState(meta.getProperty("etag").orEmpty(), meta.getProperty("lastModified").orEmpty(), total)
  }

  private fun writeResumeState(partMeta: File, state: ResumeState) {
    val meta = Properties()
    meta.setProperty("etag", state.etag)
    meta.setProperty("lastModified", state.lastModified)
    meta.setProperty("total", state.total.toString())
    writeProperties(partMeta, meta)
  }

  private fun writeProperties(file: File, properties: Properties) {
    val temp = File(file.parentFile, "${file.name}.tmp")
    FileOutputStream(temp).use { properties.store(it, null) }
    moveIntoPlace(temp, file)
  }

  private fun discardPartial(part: File, partMeta: File) {
    part.delete()
    partMeta.delete()
  }

  companion object {
    const val DEFAULT_MAX_CACHE_BYTES = 200L * 1024 * 1024
    const val TEMP_MAX_AGE_MS = 24L * 60 * 60 * 1000
    private const val MAX_RESUME_ATTEMPTS = 3
    private const val HTTP_RANGE_NOT_SATISFIABLE = 416
    private const val BUFFER_SIZE = 64 * 1024
    private const val PROGRESS_INTERVAL_MS = 100L
    private val KEY_PATTERN = Regex("^[0-9a-f]{64}$")

    fun keyFor(url: String, headers: Map<String, String>, cacheKey: String?): String {
      val material = if (cacheKey != null) {
        "key\n$cacheKey"
      } else {
        buildString {
          append("url\n").append(url)
          headers.entries
            .map { it.key.lowercase() to it.value }
            .sortedBy { it.first }
            .forEach { (name, value) -> append('\n').append(name).append(':').append(value) }
        }
      }
      return sha256(material)
    }

    fun sha256(text: String): String =
      MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun cancelledError() = PdfCacheException("cancelled", "The download was cancelled.")

    /** PDFium accepts up to 1 KB of leading junk before `%PDF-`. */
    fun looksLikePdf(file: File): Boolean {
      if (!file.isFile) return false
      val header = ByteArray(1024)
      val read = FileInputStream(file).use { it.read(header) }
      if (read < 5) return false
      val text = String(header, 0, read, Charsets.ISO_8859_1)
      return text.contains("%PDF-")
    }

    fun moveIntoPlace(from: File, to: File) {
      if (from.renameTo(to)) return
      to.delete()
      if (from.renameTo(to)) return
      from.copyTo(to, overwrite = true)
      from.delete()
    }

    private fun contentRangeStart(header: String?): Long? =
      header?.let { Regex("""bytes\s+(\d+)-""").find(it)?.groupValues?.get(1)?.toLongOrNull() }
  }
}

private class DownloadThreadFactory : ThreadFactory {
  private val count = AtomicInteger()
  override fun newThread(runnable: Runnable): Thread =
    Thread(runnable, "pdf-jsi-download-${count.incrementAndGet()}").apply { isDaemon = true }
}
