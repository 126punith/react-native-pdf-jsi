import CryptoKit
import Foundation

enum PdfStoreMode {
  case none, session, persistent
}

struct PdfStoreRequest {
  let requestId: String
  let url: URL
  let headers: [String: String]
  let cacheKey: String?
  let mode: PdfStoreMode
  let maxAgeMs: Double?
  let chunkThresholdBytes: Int64
}

struct PdfStoreRecord {
  var key: String
  var url: String
  var file: URL
  var byteSize: Int64
  var etag: String
  var lastModified: String
  var validatedAtMs: Double
  var lastAccessMs: Double
  var persistent: Bool
  var stale: Bool
  var fromCache: Bool
}

/**
 * Downloads PDFs into a disk cache. Same behaviour as the Android
 * PdfDownloadCache:
 *
 * - `<sha256>.pdf` plus a `<sha256>.meta` JSON file per entry.
 * - Revalidation with If-None-Match / If-Modified-Since; a network error or
 *   5xx returns the stored copy with `stale = true`.
 * - Files above the chunk threshold resume with Range + If-Range after an
 *   interruption, also after the app restarts.
 * - Concurrent requests for the same document share one download.
 * - The session cache is capped at `maxCacheBytes` (least recently used first).
 *
 * All state lives on one serial queue, which is also the URLSession delegate queue.
 */
final class PdfDownloadStore: NSObject, URLSessionDataDelegate {
  static let shared = PdfDownloadStore()
  static let defaultMaxCacheBytes: Int64 = 200 * 1024 * 1024
  static let defaultChunkThreshold: Int64 = 32 * 1024 * 1024

  typealias Completion = (Result<PdfStoreRecord, Error>) -> Void
  typealias Progress = (Int64, Int64) -> Void

  private struct Waiter {
    let completion: Completion
    let progress: Progress?
  }

  private struct ResumeState {
    let etag: String
    let lastModified: String
    let total: Int64
  }

  private final class Job {
    let id: String
    let key: String
    let request: PdfStoreRequest
    let dir: URL
    var waiters: [(String, Waiter)] = []
    var cancelled = false
    var task: URLSessionDataTask?
    var existing: PdfStoreRecord?
    var resume: ResumeState?
    var resuming = false
    var handle: FileHandle?
    var loaded: Int64 = 0
    var total: Int64 = -1
    var lastEmit: TimeInterval = 0
    var etag = ""
    var lastModified = ""
    var attempts = 0
    var notModified = false
    var restart = false
    var httpStatus: Int?
    var writeError: Error?

    init(id: String, key: String, request: PdfStoreRequest, dir: URL) {
      self.id = id
      self.key = key
      self.request = request
      self.dir = dir
    }

    var target: URL { dir.appendingPathComponent("\(key).pdf") }
    var part: URL { dir.appendingPathComponent("\(key).part") }
    var partMeta: URL { dir.appendingPathComponent("\(key).partmeta") }
  }

  private let queue = DispatchQueue(label: "pdf-jsi.download-store")
  private var session: URLSession!
  private var jobs: [String: Job] = [:]
  private var jobsByRequest: [String: Job] = [:]
  private var jobsByTask: [Int: Job] = [:]
  private var limit: Int64 = PdfDownloadStore.defaultMaxCacheBytes

  let sessionDir: URL
  let persistentDir: URL
  let tempDir: URL

  private override init() {
    let fm = FileManager.default
    let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    sessionDir = caches.appendingPathComponent("pdf-jsi/session", isDirectory: true)
    persistentDir = support.appendingPathComponent("pdf-jsi/persistent", isDirectory: true)
    tempDir = fm.temporaryDirectory.appendingPathComponent("pdf-jsi", isDirectory: true)
    super.init()
    try? fm.removeItem(at: tempDir)
    for dir in [sessionDir, persistentDir, tempDir] {
      try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    var persistentURL = persistentDir
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? persistentURL.setResourceValues(values)

    let delegateQueue = OperationQueue()
    delegateQueue.maxConcurrentOperationCount = 1
    delegateQueue.underlyingQueue = queue
    let configuration = URLSessionConfiguration.default
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest = 30
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
  }

  var maxCacheBytes: Int64 {
    get { queue.sync { limit } }
    set { queue.sync { limit = max(0, newValue) } }
  }

  // MARK: Public API

  func download(_ request: PdfStoreRequest, progress: Progress?, completion: @escaping Completion) {
    queue.async {
      let key = Self.key(url: request.url.absoluteString, headers: request.headers, cacheKey: request.cacheKey)
      let id = "\(request.mode):\(key)"
      let waiter = Waiter(completion: completion, progress: progress)
      if let running = self.jobs[id], !running.cancelled {
        running.waiters.append((request.requestId, waiter))
        self.jobsByRequest[request.requestId] = running
        return
      }
      let job = Job(id: id, key: key, request: request, dir: self.dir(for: request.mode))
      job.waiters.append((request.requestId, waiter))
      self.jobs[id] = job
      self.jobsByRequest[request.requestId] = job
      self.start(job)
    }
  }

  func cancel(_ requestId: String) {
    queue.async {
      guard let job = self.jobsByRequest.removeValue(forKey: requestId),
            let index = job.waiters.firstIndex(where: { $0.0 == requestId }) else {
        return
      }
      let waiter = job.waiters.remove(at: index).1
      waiter.completion(.failure(pdfError("cancelled", "The download was cancelled.")))
      if job.waiters.isEmpty {
        job.cancelled = true
        job.task?.cancel()
        if self.jobs[job.id] === job {
          self.jobs.removeValue(forKey: job.id)
        }
      }
    }
  }

  func entry(url: String, headers: [String: String], cacheKey: String?) -> PdfStoreRecord? {
    let key = Self.key(url: url, headers: headers, cacheKey: cacheKey)
    return readRecord(dir: persistentDir, key: key, persistent: true)
      ?? readRecord(dir: sessionDir, key: key, persistent: false)
  }

  func remove(_ key: String) -> Bool {
    guard key.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return false }
    var removed = false
    for dir in [sessionDir, persistentDir] {
      for suffix in [".pdf", ".meta", ".part", ".partmeta"] {
        let url = dir.appendingPathComponent(key + suffix)
        if (try? FileManager.default.removeItem(at: url)) != nil, suffix == ".pdf" {
          removed = true
        }
      }
    }
    return removed
  }

  func clear() {
    let fm = FileManager.default
    for dir in [sessionDir, persistentDir] {
      for file in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] {
        try? fm.removeItem(at: file)
      }
    }
  }

  func byteSize() -> Int64 {
    var total: Int64 = 0
    for dir in [sessionDir, persistentDir] {
      for file in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? [] {
        total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      }
    }
    return total
  }

  // MARK: Jobs

  private func dir(for mode: PdfStoreMode) -> URL {
    switch mode {
    case .none: return tempDir
    case .session: return sessionDir
    case .persistent: return persistentDir
    }
  }

  private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  private func start(_ job: Job) {
    let request = job.request
    if request.mode != .none {
      job.existing = readRecord(dir: job.dir, key: job.key, persistent: request.mode == .persistent)
    }
    if let existing = job.existing, let maxAge = request.maxAgeMs, Self.now() - existing.validatedAtMs <= maxAge {
      var fresh = touch(existing, dir: job.dir)
      fresh.fromCache = true
      finish(job, .success(fresh))
      return
    }
    job.resume = readResumeState(job)
    issue(job)
  }

  private func issue(_ job: Job) {
    guard !job.cancelled else { return }
    var urlRequest = URLRequest(url: job.request.url)
    urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
    for (name, value) in job.request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    // Byte offsets must match the file on the server for Range requests.
    urlRequest.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    let partSize = fileSize(job.part)
    job.resuming = false
    job.notModified = false
    job.restart = false
    job.httpStatus = nil
    job.writeError = nil
    if let resume = job.resume, partSize > 0 {
      job.resuming = true
      urlRequest.setValue("bytes=\(partSize)-", forHTTPHeaderField: "Range")
      urlRequest.setValue(resume.etag.isEmpty ? resume.lastModified : resume.etag, forHTTPHeaderField: "If-Range")
    } else if let existing = job.existing {
      if !existing.etag.isEmpty { urlRequest.setValue(existing.etag, forHTTPHeaderField: "If-None-Match") }
      if !existing.lastModified.isEmpty { urlRequest.setValue(existing.lastModified, forHTTPHeaderField: "If-Modified-Since") }
    }
    let task = session.dataTask(with: urlRequest)
    job.task = task
    jobsByTask[task.taskIdentifier] = job
    task.resume()
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let job = jobsByTask[dataTask.taskIdentifier], !job.cancelled,
          let http = response as? HTTPURLResponse else {
      completionHandler(.cancel)
      return
    }
    let status = http.statusCode
    let header = { (name: String) in http.value(forHTTPHeaderField: name) ?? "" }

    if status == 304, job.existing != nil, !job.resuming {
      job.notModified = true
      completionHandler(.allow)
      return
    }
    if status == 206, job.resuming, let resume = job.resume {
      let start = Self.contentRangeStart(header("Content-Range"))
      let partSize = fileSize(job.part)
      guard start == partSize, let handle = try? FileHandle(forWritingTo: job.part) else {
        job.restart = true
        completionHandler(.cancel)
        return
      }
      handle.seekToEndOfFile()
      job.handle = handle
      job.etag = resume.etag
      job.lastModified = resume.lastModified
      job.total = resume.total
      job.loaded = partSize
      emit(job, force: true)
      completionHandler(.allow)
      return
    }
    if status == 200 {
      job.etag = header("ETag")
      job.lastModified = header("Last-Modified")
      job.total = http.expectedContentLength
      let resumable = job.total >= job.request.chunkThresholdBytes
        && header("Accept-Ranges").lowercased().contains("bytes")
        && (!job.etag.isEmpty || !job.lastModified.isEmpty)
      discardPartial(job)
      job.resume = resumable ? ResumeState(etag: job.etag, lastModified: job.lastModified, total: job.total) : nil
      if let resume = job.resume { writeResumeState(resume, to: job.partMeta) }
      FileManager.default.createFile(atPath: job.part.path, contents: nil)
      guard let handle = try? FileHandle(forWritingTo: job.part) else {
        job.writeError = pdfError("io-error", "Could not create the download file.")
        completionHandler(.cancel)
        return
      }
      job.handle = handle
      job.loaded = 0
      emit(job, force: true)
      completionHandler(.allow)
      return
    }
    if status == 416, job.resuming {
      job.restart = true
      completionHandler(.cancel)
      return
    }
    job.httpStatus = status
    completionHandler(.cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let job = jobsByTask[dataTask.taskIdentifier], !job.cancelled, let handle = job.handle else { return }
    handle.write(data)
    job.loaded += Int64(data.count)
    emit(job, force: false)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let job = jobsByTask.removeValue(forKey: task.taskIdentifier) else { return }
    job.handle?.closeFile()
    job.handle = nil
    job.task = nil
    if job.cancelled { return }

    if let writeError = job.writeError {
      finish(job, .failure(writeError))
      return
    }
    if job.restart {
      discardPartial(job)
      job.resume = nil
      issue(job)
      return
    }
    if let status = job.httpStatus {
      if status >= 500, let existing = job.existing {
        finish(job, .success(staleCopy(existing, job: job)))
      } else {
        finish(job, .failure(pdfError("download-failed", "The server answered HTTP \(status).")))
      }
      return
    }
    if let error = error {
      networkFailure(job, error)
      return
    }
    if job.notModified, var existing = job.existing {
      let now = Self.now()
      existing.validatedAtMs = now
      existing.lastAccessMs = now
      existing.fromCache = true
      existing.stale = false
      writeMeta(existing, dir: job.dir)
      finish(job, .success(existing))
      return
    }
    let size = fileSize(job.part)
    if job.total >= 0 && size != job.total {
      networkFailure(job, pdfError("download-failed", "The connection closed after \(size) of \(job.total) bytes."))
      return
    }
    guard Self.looksLikePdf(job.part) else {
      discardPartial(job)
      finish(job, .failure(pdfError("download-failed", "The server did not return a PDF.")))
      return
    }
    do {
      try Self.moveIntoPlace(job.part, job.target)
    } catch {
      finish(job, .failure(pdfError("io-error", "Could not store the download: \(error.localizedDescription)")))
      return
    }
    try? FileManager.default.removeItem(at: job.partMeta)
    let now = Self.now()
    let record = PdfStoreRecord(
      key: job.key,
      url: job.request.url.absoluteString,
      file: job.target,
      byteSize: fileSize(job.target),
      etag: job.etag,
      lastModified: job.lastModified,
      validatedAtMs: now,
      lastAccessMs: now,
      persistent: job.request.mode == .persistent,
      stale: false,
      fromCache: false
    )
    if job.request.mode != .none {
      writeMeta(record, dir: job.dir)
    }
    finish(job, .success(record))
  }

  private func networkFailure(_ job: Job, _ error: Error) {
    if job.resume != nil, fileSize(job.part) > 0, job.attempts < 3 {
      job.attempts += 1
      queue.asyncAfter(deadline: .now() + 0.5 * Double(job.attempts)) { self.issue(job) }
      return
    }
    if job.resume == nil {
      discardPartial(job)
    }
    if let existing = job.existing {
      finish(job, .success(staleCopy(existing, job: job)))
    } else {
      finish(job, .failure(pdfError(from: error, fallback: "download-failed")))
    }
  }

  private func staleCopy(_ existing: PdfStoreRecord, job: Job) -> PdfStoreRecord {
    var copy = touch(existing, dir: job.dir)
    copy.stale = true
    copy.fromCache = true
    return copy
  }

  private func finish(_ job: Job, _ result: Result<PdfStoreRecord, Error>) {
    if jobs[job.id] === job {
      jobs.removeValue(forKey: job.id)
    }
    if case .success(let record) = result, job.request.mode == .session {
      enforceLimit(keep: record.key)
    }
    let waiters = job.waiters
    job.waiters.removeAll()
    for (requestId, waiter) in waiters {
      jobsByRequest.removeValue(forKey: requestId)
      waiter.completion(result)
    }
  }

  private func emit(_ job: Job, force: Bool) {
    let now = Date().timeIntervalSince1970
    guard force || now - job.lastEmit >= 0.1 else { return }
    job.lastEmit = now
    for (_, waiter) in job.waiters {
      waiter.progress?(job.loaded, job.total)
    }
  }

  private func enforceLimit(keep: String) {
    guard limit > 0 else { return }
    let busy = Set(jobs.values.map { $0.key })
    let files = (try? FileManager.default.contentsOfDirectory(at: sessionDir, includingPropertiesForKeys: nil)) ?? []
    var records = files
      .filter { $0.pathExtension == "meta" }
      .compactMap { readRecord(dir: sessionDir, key: $0.deletingPathExtension().lastPathComponent, persistent: false) }
    records.sort { $0.lastAccessMs < $1.lastAccessMs }
    var total = records.reduce(Int64(0)) { $0 + $1.byteSize }
    for record in records where total > limit {
      if record.key == keep || busy.contains(record.key) { continue }
      try? FileManager.default.removeItem(at: sessionDir.appendingPathComponent("\(record.key).pdf"))
      try? FileManager.default.removeItem(at: sessionDir.appendingPathComponent("\(record.key).meta"))
      total -= record.byteSize
    }
  }

  // MARK: Files

  private func readRecord(dir: URL, key: String, persistent: Bool) -> PdfStoreRecord? {
    let file = dir.appendingPathComponent("\(key).pdf")
    let metaURL = dir.appendingPathComponent("\(key).meta")
    guard FileManager.default.fileExists(atPath: file.path),
          let data = try? Data(contentsOf: metaURL),
          let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return nil
    }
    return PdfStoreRecord(
      key: key,
      url: meta["url"] as? String ?? "",
      file: file,
      byteSize: fileSize(file),
      etag: meta["etag"] as? String ?? "",
      lastModified: meta["lastModified"] as? String ?? "",
      validatedAtMs: (meta["validatedAtMs"] as? NSNumber)?.doubleValue ?? 0,
      lastAccessMs: (meta["lastAccessMs"] as? NSNumber)?.doubleValue ?? 0,
      persistent: persistent,
      stale: false,
      fromCache: true
    )
  }

  private func touch(_ record: PdfStoreRecord, dir: URL) -> PdfStoreRecord {
    var updated = record
    updated.lastAccessMs = Self.now()
    writeMeta(updated, dir: dir)
    return updated
  }

  private func writeMeta(_ record: PdfStoreRecord, dir: URL) {
    let meta: [String: Any] = [
      "url": record.url,
      "etag": record.etag,
      "lastModified": record.lastModified,
      "validatedAtMs": record.validatedAtMs,
      "lastAccessMs": record.lastAccessMs,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: meta) {
      try? data.write(to: dir.appendingPathComponent("\(record.key).meta"), options: .atomic)
    }
  }

  private func readResumeState(_ job: Job) -> ResumeState? {
    guard let data = try? Data(contentsOf: job.partMeta),
          let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let total = (meta["total"] as? NSNumber)?.int64Value,
          total > 0, fileSize(job.part) < total else {
      discardPartial(job)
      return nil
    }
    return ResumeState(etag: meta["etag"] as? String ?? "", lastModified: meta["lastModified"] as? String ?? "", total: total)
  }

  private func writeResumeState(_ state: ResumeState, to url: URL) {
    let meta: [String: Any] = ["etag": state.etag, "lastModified": state.lastModified, "total": state.total]
    if let data = try? JSONSerialization.data(withJSONObject: meta) {
      try? data.write(to: url, options: .atomic)
    }
  }

  private func discardPartial(_ job: Job) {
    try? FileManager.default.removeItem(at: job.part)
    try? FileManager.default.removeItem(at: job.partMeta)
  }

  private func fileSize(_ url: URL) -> Int64 {
    ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.int64Value ?? 0
  }

  // MARK: Helpers

  static func key(url: String, headers: [String: String], cacheKey: String?) -> String {
    let material: String
    if let cacheKey = cacheKey {
      material = "key\n\(cacheKey)"
    } else {
      let sorted = headers.map { ($0.key.lowercased(), $0.value) }.sorted { $0.0 < $1.0 }
      material = (["url\n\(url)"] + sorted.map { "\($0.0):\($0.1)" }).joined(separator: "\n")
    }
    return sha256(material)
  }

  static func sha256(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  /// PDFKit and PDFium accept up to 1 KB of leading junk before `%PDF-`.
  static func looksLikePdf(_ url: URL) -> Bool {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
    defer { handle.closeFile() }
    let header = handle.readData(ofLength: 1024)
    return header.range(of: Data("%PDF-".utf8)) != nil
  }

  static func moveIntoPlace(_ from: URL, _ to: URL) throws {
    let fm = FileManager.default
    if fm.fileExists(atPath: to.path) {
      _ = try fm.replaceItemAt(to, withItemAt: from)
    } else {
      try fm.moveItem(at: from, to: to)
    }
  }

  private static func contentRangeStart(_ header: String) -> Int64? {
    guard let match = header.range(of: #"bytes\s+(\d+)-"#, options: .regularExpression) else { return nil }
    let digits = header[match].drop(while: { !$0.isNumber }).prefix(while: { $0.isNumber })
    return Int64(digits)
  }
}
