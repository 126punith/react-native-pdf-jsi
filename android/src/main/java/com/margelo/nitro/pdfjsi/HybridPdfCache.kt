package com.margelo.nitro.pdfjsi

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Base64OutputStream
import android.webkit.CookieManager
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.Executors

@DoNotStrip
@Keep
class HybridPdfCache : HybridPdfCacheSpec() {
  private val context: Context
    get() = NitroModules.applicationContext
      ?: throw PdfCacheException("unknown", "React Native is not initialized yet.")

  private val cache: PdfDownloadCache by lazy { sharedCache(context) }

  override var maxCacheBytes: Double
    get() = cache.maxCacheBytes.toDouble()
    set(value) {
      cache.maxCacheBytes = if (value.isFinite() && value > 0) value.toLong() else 0L
    }

  override val cacheDirectory: String
    get() = context.cacheDir.absolutePath

  override val documentDirectory: String
    get() = context.filesDir.absolutePath

  override fun download(
    request: PdfDownloadRequest,
    onProgress: ((loadedBytes: Double, totalBytes: Double) -> Unit)?,
  ): Promise<PdfCacheEntry> {
    val promise = Promise<PdfCacheEntry>()
    val mode = when (request.cache) {
      PdfCacheMode.NONE -> CacheMode.NONE
      PdfCacheMode.SESSION -> CacheMode.SESSION
      PdfCacheMode.PERSISTENT -> CacheMode.PERSISTENT
    }
    val listener = onProgress?.let { callback ->
      ProgressListener { loaded, total -> callback(loaded.toDouble(), total.toDouble()) }
    }
    val future = cache.download(
      DownloadRequest(
        requestId = request.requestId,
        url = request.url,
        headers = request.headers ?: emptyMap(),
        cacheKey = request.cacheKey,
        mode = mode,
        maxAgeMs = request.maxAgeMs?.takeIf { it.isFinite() && it >= 0 }?.toLong(),
        chunkThresholdBytes = request.chunkThresholdBytes?.takeIf { it.isFinite() && it > 0 }?.toLong()
          ?: DownloadRequest.DEFAULT_CHUNK_THRESHOLD,
      ),
      listener,
    )
    future.whenComplete { record, error ->
      if (error != null) {
        promise.reject(unwrap(error))
      } else {
        promise.resolve(record.toEntry())
      }
    }
    return promise
  }

  override fun cancelDownload(requestId: String) {
    cache.cancel(requestId)
  }

  override fun getEntry(url: String, headers: Map<String, String>?, cacheKey: String?): Promise<PdfCacheEntry?> =
    io { cache.getEntry(url, headers ?: emptyMap(), cacheKey)?.toEntry() }

  override fun remove(key: String): Promise<Boolean> = io { cache.remove(key) }

  override fun clear(): Promise<Unit> = io { cache.clear() }

  override fun getByteSize(): Promise<Double> = io { cache.byteSize().toDouble() }

  override fun resolveLocal(uri: String): Promise<String> = io { resolveLocalSync(uri) }

  override fun writeBase64(base64: String, identifier: String): Promise<String> = io {
    val dir = File(context.cacheDir, "pdf-jsi/base64").apply { mkdirs() }
    val target = File(dir, "${safeName(identifier)}.pdf")
    if (target.isFile && target.length() > 0) {
      return@io target.absolutePath
    }
    val temp = File(dir, "${target.name}.${System.nanoTime()}.tmp")
    try {
      Base64OutputStream(FileOutputStream(temp), Base64.DEFAULT or Base64.NO_CLOSE).use { output ->
        var index = 0
        while (index < base64.length) {
          val end = minOf(base64.length, index + BASE64_CHUNK)
          output.write(base64.substring(index, end).toByteArray(Charsets.US_ASCII))
          index = end
        }
      }
    } catch (error: IllegalArgumentException) {
      temp.delete()
      throw PdfCacheException("invalid-source", "The base64 data is not valid.", error)
    }
    if (!PdfDownloadCache.looksLikePdf(temp)) {
      temp.delete()
      throw PdfCacheException("invalid-source", "The base64 data is not a PDF.")
    }
    PdfDownloadCache.moveIntoPlace(temp, target)
    target.absolutePath
  }

  override fun fileExists(path: String): Promise<Boolean> = io { File(stripFileScheme(path)).exists() }

  override fun fileSize(path: String): Promise<Double> = io {
    val file = File(stripFileScheme(path))
    if (!file.isFile) throw PdfCacheException("io-error", "No file at $path.")
    file.length().toDouble()
  }

  override fun copyFile(from: String, to: String): Promise<Unit> = io {
    val source = File(stripFileScheme(from))
    val target = File(stripFileScheme(to))
    if (!source.isFile) throw PdfCacheException("io-error", "No file at $from.")
    target.parentFile?.mkdirs()
    val temp = File(target.parentFile, "${target.name}.${System.nanoTime()}.tmp")
    source.copyTo(temp, overwrite = true)
    PdfDownloadCache.moveIntoPlace(temp, target)
  }

  override fun deleteFile(path: String): Promise<Boolean> = io {
    val file = File(stripFileScheme(path))
    file.exists() && file.delete()
  }

  override fun saveToDownloads(path: String, fileName: String, mimeType: String): Promise<PdfDownloadsTarget> = io {
    val source = File(stripFileScheme(path))
    if (!source.isFile) throw PdfCacheException("io-error", "No file at $path.")
    val name = safeDisplayName(fileName)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw PdfCacheException("io-error", "Could not create $name in Downloads.")
      try {
        resolver.openOutputStream(uri)?.use { output -> source.inputStream().use { it.copyTo(output) } }
          ?: throw PdfCacheException("io-error", "Could not write $name to Downloads.")
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      } catch (error: Throwable) {
        resolver.delete(uri, null, null)
        throw error
      }
      PdfDownloadsTarget(uri.toString())
    } else {
      @Suppress("DEPRECATION")
      val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      try {
        downloads.mkdirs()
        val target = uniqueFile(downloads, name)
        source.copyTo(target)
        PdfDownloadsTarget(target.absolutePath)
      } catch (error: SecurityException) {
        throw PdfCacheException(
          "io-error",
          "Saving to Downloads on Android 9 and older needs the WRITE_EXTERNAL_STORAGE permission.",
          error,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------

  private fun resolveLocalSync(uri: String): String {
    val trimmed = uri.trim()
    return when {
      trimmed.startsWith("file://") -> existingFile(Uri.parse(trimmed).path ?: "", uri)
      trimmed.startsWith("/") -> existingFile(trimmed, uri)
      trimmed.startsWith("content://") || trimmed.startsWith("android.resource://") ->
        copyToLocal(uri, "content") {
          context.contentResolver.openInputStream(Uri.parse(trimmed))
            ?: throw PdfCacheException("invalid-source", "Could not open $uri.")
        }
      trimmed.startsWith("bundle-assets://") || trimmed.startsWith("asset:/") -> {
        val name = trimmed.removePrefix("bundle-assets://").removePrefix("asset:///").removePrefix("asset:/")
        copyToLocal(uri, "asset") { context.assets.open(name) }
      }
      RESOURCE_NAME.matches(trimmed) -> {
        // Release builds resolve require('./file.pdf') to a raw resource name.
        val id = context.resources.getIdentifier(trimmed, "raw", context.packageName)
        if (id == 0) throw PdfCacheException("invalid-source", "No raw resource named $trimmed.")
        copyToLocal(uri, "raw") { context.resources.openRawResource(id) }
      }
      else -> throw PdfCacheException("invalid-source", "Unsupported source URI: $uri")
    }
  }

  private fun existingFile(path: String, original: String): String {
    val file = File(path)
    if (!file.isFile) throw PdfCacheException("invalid-source", "No file at $original.")
    return file.absolutePath
  }

  /** Bundled files can change with an app update, so the copy is keyed by the install time too. */
  private fun copyToLocal(uri: String, kind: String, open: () -> InputStream): String {
    val dir = File(context.cacheDir, "pdf-jsi/local").apply { mkdirs() }
    val version = if (kind == "content") System.nanoTime().toString() else installTime().toString()
    val target = File(dir, "${PdfDownloadCache.sha256("$kind\n$uri\n${if (kind == "content") "" else version}")}.pdf")
    if (kind != "content" && target.isFile && target.length() > 0) {
      return target.absolutePath
    }
    val temp = File(dir, "${target.name}.$version.tmp")
    try {
      open().use { input -> FileOutputStream(temp).use { input.copyTo(it) } }
    } catch (error: PdfCacheException) {
      temp.delete()
      throw error
    } catch (error: IOException) {
      temp.delete()
      throw PdfCacheException("invalid-source", "Could not read $uri: ${error.message}", error)
    } catch (error: SecurityException) {
      temp.delete()
      throw PdfCacheException("invalid-source", "No permission to read $uri.", error)
    }
    PdfDownloadCache.moveIntoPlace(temp, target)
    return target.absolutePath
  }

  private fun installTime(): Long = runCatching {
    @Suppress("DEPRECATION")
    context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
  }.getOrDefault(0L)

  private fun <T> io(block: () -> T): Promise<T> {
    val promise = Promise<T>()
    fileExecutor.execute {
      try {
        promise.resolve(block())
      } catch (error: Throwable) {
        promise.reject(unwrap(error))
      }
    }
    return promise
  }

  private fun CacheRecord.toEntry() = PdfCacheEntry(
    key = key,
    url = url,
    filePath = file.absolutePath,
    byteSize = byteSize.toDouble(),
    etag = etag,
    lastModified = lastModified,
    validatedAtMs = validatedAtMs.toDouble(),
    lastAccessMs = lastAccessMs.toDouble(),
    persistent = persistent,
    stale = stale,
    fromCache = fromCache,
  )

  companion object {
    private const val BASE64_CHUNK = 64 * 1024
    private val RESOURCE_NAME = Regex("^[a-z0-9_]+$")
    private val fileExecutor = Executors.newFixedThreadPool(2) { runnable ->
      Thread(runnable, "pdf-jsi-files").apply { isDaemon = true }
    }

    @Volatile
    private var shared: PdfDownloadCache? = null

    /** One cache per process: every HybridPdfCache shares downloads and the size limit. */
    private fun sharedCache(context: Context): PdfDownloadCache =
      shared ?: synchronized(this) {
        shared ?: PdfDownloadCache(
          sessionDir = File(context.cacheDir, "pdf-jsi/session"),
          persistentDir = File(context.noBackupFilesDir, "pdf-jsi/persistent"),
          tempDir = File(context.cacheDir, "pdf-jsi/tmp"),
          // React Native's networking stores cookies here; getInstance() throws when no WebView is installed.
          cookies = { url -> runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull() },
        ).also { shared = it }
      }

    private fun unwrap(error: Throwable): Throwable {
      var current = error
      while ((current is java.util.concurrent.CompletionException || current is java.util.concurrent.ExecutionException) &&
        current.cause != null
      ) {
        current = current.cause!!
      }
      return when (current) {
        is PdfCacheException -> current
        is SecurityException -> PdfCacheException("io-error", current.message ?: "Permission denied.", current)
        is IOException -> PdfCacheException("io-error", current.message ?: "I/O error.", current)
        is OutOfMemoryError -> PdfCacheException("out-of-memory", "Not enough memory.", current)
        else -> PdfCacheException("unknown", current.message ?: current.javaClass.simpleName, current)
      }
    }

    private fun stripFileScheme(path: String): String =
      if (path.startsWith("file://")) Uri.parse(path).path ?: path.removePrefix("file://") else path

    private fun safeName(name: String): String = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120).ifEmpty { "document" }

    private fun safeDisplayName(name: String): String =
      name.replace(Regex("[/\\\\:*?\"<>|\\u0000-\\u001f]"), "_").trim().ifEmpty { "document.pdf" }

    private fun uniqueFile(dir: File, name: String): File {
      var candidate = File(dir, name)
      if (!candidate.exists()) return candidate
      val base = name.substringBeforeLast('.', name)
      val extension = name.substringAfterLast('.', "").let { if (it.isEmpty() || it == name) "" else ".$it" }
      var index = 1
      while (candidate.exists()) {
        candidate = File(dir, "$base ($index)$extension")
        index += 1
      }
      return candidate
    }
  }
}
