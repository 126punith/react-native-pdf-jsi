import Foundation
import NitroModules

public final class HybridPdfCache: HybridPdfCacheSpec {
  private var store: PdfDownloadStore { PdfDownloadStore.shared }

  public var maxCacheBytes: Double {
    get { Double(store.maxCacheBytes) }
    set { store.maxCacheBytes = newValue.isFinite && newValue > 0 ? Int64(newValue) : 0 }
  }

  public var cacheDirectory: String {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path
  }

  public var documentDirectory: String {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].path
  }

  public func download(
    request: PdfDownloadRequest,
    onProgress: ((_ loadedBytes: Double, _ totalBytes: Double) -> Void)?
  ) throws -> Promise<PdfCacheEntry> {
    guard let url = URL(string: request.url), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      throw pdfError("invalid-source", "Only http and https URLs can be downloaded.")
    }
    let mode: PdfStoreMode
    switch request.cache {
    case .none: mode = .none
    case .session: mode = .session
    case .persistent: mode = .persistent
    }
    let threshold = request.chunkThresholdBytes.flatMap { $0.isFinite && $0 > 0 ? Int64($0) : nil }
      ?? PdfDownloadStore.defaultChunkThreshold
    let storeRequest = PdfStoreRequest(
      requestId: request.requestId,
      url: url,
      headers: request.headers ?? [:],
      cacheKey: request.cacheKey,
      mode: mode,
      maxAgeMs: request.maxAgeMs.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil },
      chunkThresholdBytes: threshold
    )
    let promise = Promise<PdfCacheEntry>()
    store.download(
      storeRequest,
      progress: onProgress.map { callback in { loaded, total in callback(Double(loaded), Double(total)) } }
    ) { result in
      switch result {
      case .success(let record): promise.resolve(withResult: Self.entry(record))
      case .failure(let error): promise.reject(withError: error)
      }
    }
    return promise
  }

  public func cancelDownload(requestId: String) throws {
    store.cancel(requestId)
  }

  public func getEntry(url: String, headers: Dictionary<String, String>?, cacheKey: String?) throws -> Promise<PdfCacheEntry?> {
    Promise.parallel { [store] in
      store.entry(url: url, headers: headers ?? [:], cacheKey: cacheKey).map(Self.entry)
    }
  }

  public func remove(key: String) throws -> Promise<Bool> {
    Promise.parallel { [store] in store.remove(key) }
  }

  public func clear() throws -> Promise<Void> {
    Promise.parallel { [store] in store.clear() }
  }

  public func getByteSize() throws -> Promise<Double> {
    Promise.parallel { [store] in Double(store.byteSize()) }
  }

  public func resolveLocal(uri: String) throws -> Promise<String> {
    Promise.parallel { try Self.resolveLocalPath(uri) }
  }

  public func writeBase64(base64: String, identifier: String) throws -> Promise<String> {
    Promise.parallel {
      let fm = FileManager.default
      let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pdf-jsi/base64", isDirectory: true)
      try fm.createDirectory(at: dir, withIntermediateDirectories: true)
      let target = dir.appendingPathComponent("\(Self.safeName(identifier)).pdf")
      if let size = (try? fm.attributesOfItem(atPath: target.path)[.size]) as? NSNumber, size.intValue > 0 {
        return target.path
      }
      guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
        throw pdfError("invalid-source", "The base64 data is not valid.")
      }
      guard data.prefix(1024).range(of: Data("%PDF-".utf8)) != nil else {
        throw pdfError("invalid-source", "The base64 data is not a PDF.")
      }
      do {
        try data.write(to: target, options: .atomic)
      } catch {
        throw pdfError("io-error", "Could not write the PDF: \(error.localizedDescription)")
      }
      return target.path
    }
  }

  public func fileExists(path: String) throws -> Promise<Bool> {
    Promise.parallel { FileManager.default.fileExists(atPath: Self.stripFileScheme(path)) }
  }

  public func fileSize(path: String) throws -> Promise<Double> {
    Promise.parallel {
      let local = Self.stripFileScheme(path)
      guard let size = (try? FileManager.default.attributesOfItem(atPath: local)[.size]) as? NSNumber else {
        throw pdfError("io-error", "No file at \(path).")
      }
      return size.doubleValue
    }
  }

  public func copyFile(from: String, to: String) throws -> Promise<Void> {
    Promise.parallel {
      let fm = FileManager.default
      let source = URL(fileURLWithPath: Self.stripFileScheme(from))
      let target = URL(fileURLWithPath: Self.stripFileScheme(to))
      guard fm.fileExists(atPath: source.path) else {
        throw pdfError("io-error", "No file at \(from).")
      }
      do {
        try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temp = target.deletingLastPathComponent().appendingPathComponent(".\(target.lastPathComponent).\(UUID().uuidString).tmp")
        try fm.copyItem(at: source, to: temp)
        try PdfDownloadStore.moveIntoPlace(temp, target)
      } catch {
        throw pdfError("io-error", "Could not copy the file: \(error.localizedDescription)")
      }
    }
  }

  public func deleteFile(path: String) throws -> Promise<Bool> {
    Promise.parallel { (try? FileManager.default.removeItem(atPath: Self.stripFileScheme(path))) != nil }
  }

  public func saveToDownloads(path: String, fileName: String, mimeType: String) throws -> Promise<PdfDownloadsTarget> {
    Promise.parallel {
      let fm = FileManager.default
      let source = URL(fileURLWithPath: Self.stripFileScheme(path))
      guard fm.fileExists(atPath: source.path) else {
        throw pdfError("io-error", "No file at \(path).")
      }
      let documents = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let target = Self.uniqueURL(in: documents, name: Self.safeDisplayName(fileName))
      do {
        try fm.copyItem(at: source, to: target)
      } catch {
        throw pdfError("io-error", "Could not save the file: \(error.localizedDescription)")
      }
      return PdfDownloadsTarget(uri: target.path)
    }
  }

  // MARK: Helpers

  private static func entry(_ record: PdfStoreRecord) -> PdfCacheEntry {
    PdfCacheEntry(
      key: record.key,
      url: record.url,
      filePath: record.file.path,
      byteSize: Double(record.byteSize),
      etag: record.etag,
      lastModified: record.lastModified,
      validatedAtMs: record.validatedAtMs,
      lastAccessMs: record.lastAccessMs,
      persistent: record.persistent,
      stale: record.stale,
      fromCache: record.fromCache
    )
  }

  /// Local files are read in place; bundle resources are looked up by name.
  static func resolveLocalPath(_ uri: String) throws -> String {
    let trimmed = uri.trimmingCharacters(in: .whitespaces)
    let fm = FileManager.default
    if trimmed.hasPrefix("file://") {
      guard let path = URL(string: trimmed)?.path, fm.fileExists(atPath: path) else {
        throw pdfError("invalid-source", "No file at \(uri).")
      }
      return path
    }
    if trimmed.hasPrefix("/") {
      guard fm.fileExists(atPath: trimmed) else {
        throw pdfError("invalid-source", "No file at \(uri).")
      }
      return trimmed
    }
    let name = trimmed.hasPrefix("bundle-assets://") ? String(trimmed.dropFirst("bundle-assets://".count)) : trimmed
    if !name.contains("://") {
      let url = URL(fileURLWithPath: name)
      let base = url.deletingPathExtension().path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      let ext = url.pathExtension.isEmpty ? "pdf" : url.pathExtension
      if let path = Bundle.main.path(forResource: base, ofType: ext) ?? Bundle.main.path(forResource: name, ofType: nil) {
        return path
      }
      throw pdfError("invalid-source", "No bundled file named \(name).")
    }
    throw pdfError("invalid-source", "Unsupported source URI: \(uri)")
  }

  static func stripFileScheme(_ path: String) -> String {
    if path.hasPrefix("file://") {
      return URL(string: path)?.path ?? String(path.dropFirst("file://".count))
    }
    return path
  }

  private static func safeName(_ name: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    let cleaned = String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }).prefix(120)
    return cleaned.isEmpty ? "document" : String(cleaned)
  }

  private static func safeDisplayName(_ name: String) -> String {
    let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
    let cleaned = String(name.unicodeScalars.map { forbidden.contains($0) ? "_" : Character($0) })
      .trimmingCharacters(in: .whitespaces)
    return cleaned.isEmpty ? "document.pdf" : cleaned
  }

  private static func uniqueURL(in dir: URL, name: String) -> URL {
    let fm = FileManager.default
    var candidate = dir.appendingPathComponent(name)
    guard fm.fileExists(atPath: candidate.path) else { return candidate }
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var index = 1
    while fm.fileExists(atPath: candidate.path) {
      candidate = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(index))" : "\(base) (\(index)).\(ext)")
      index += 1
    }
    return candidate
  }
}
