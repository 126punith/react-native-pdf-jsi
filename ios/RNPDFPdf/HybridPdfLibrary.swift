import Foundation
import NitroModules
import PDFKit
import UIKit

public final class HybridPdfLibrary: HybridPdfLibrarySpec {
  public var jsiStats: JSIStats {
    JSIStats(version: "5.0.0", performanceLevel: "high", directMemoryAccess: true, bridgeOptimized: true, initialized: true)
  }

  public var kb16Support: KB16Support {
    KB16Support(
      supported: true,
      platform: "ios",
      message: "iOS uses PDFKit; 16KB page size does not apply",
      googlePlayCompliant: true,
      ndkVersion: "",
      buildFlags: ""
    )
  }

  public var ocrAvailable: Bool {
    if #available(iOS 13.0, *) { return true }
    return false
  }

  public func open(path: String) throws -> Promise<(any HybridPdfDocumentSpec)> {
    Promise.parallel {
      let document = HybridPdfDocument()
      try document.openFile(path)
      return document
    }
  }

  public func mergePDFs(filePaths: [String], outputPath: String) throws -> Promise<String> {
    Promise.parallel {
      guard filePaths.count >= 2 else {
        throw RuntimeError.error(withMessage: "At least 2 PDF files are required for merging")
      }
      let merged = PDFDocument()
      for rawPath in filePaths {
        let path = HybridPdfPaths.normalize(rawPath)
        guard let source = PDFDocument(url: URL(fileURLWithPath: path)) else {
          throw RuntimeError.error(withMessage: "Failed to open PDF: \(path)")
        }
        for index in 0..<source.pageCount {
          guard let page = source.page(at: index) else { continue }
          merged.insert(page, at: merged.pageCount)
        }
      }
      let output = outputPath.isEmpty
        ? HybridPdfPaths.sibling(filePaths[0], suffix: "-merged.pdf")
        : HybridPdfPaths.normalize(outputPath)
      guard merged.write(to: URL(fileURLWithPath: output)) else {
        throw RuntimeError.error(withMessage: "Failed to write merged PDF")
      }
      return output
    }
  }

  public func splitPDF(filePath: String, pageRangesJson: String, outputDir: String) throws -> Promise<String> {
    Promise.parallel {
      let path = HybridPdfPaths.normalize(filePath)
      guard let source = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw RuntimeError.error(withMessage: "Failed to open PDF: \(path)")
      }
      let directory = outputDir.isEmpty
        ? URL(fileURLWithPath: path).deletingLastPathComponent().path
        : HybridPdfPaths.normalize(outputDir)
      let ranges = HybridPdfPaths.ranges(pageRangesJson)
      var outputs: [String] = []
      for range in ranges {
        let piece = PDFDocument()
        let start = min(range.0, range.1)
        let end = max(range.0, range.1)
        for index in start...end where index >= 0 && index < source.pageCount {
          if let page = source.page(at: index) {
            piece.insert(page, at: piece.pageCount)
          }
        }
        let output = URL(fileURLWithPath: directory)
          .appendingPathComponent("split-\(start)-\(end).pdf")
          .path
        guard piece.write(to: URL(fileURLWithPath: output)) else {
          throw RuntimeError.error(withMessage: "Failed to write split PDF")
        }
        outputs.append(output)
      }
      let data = try JSONSerialization.data(withJSONObject: outputs)
      return String(data: data, encoding: .utf8) ?? "[]"
    }
  }

  public func extractPages(filePath: String, pageNumbersJson: String, outputPath: String) throws -> Promise<String> {
    Promise.parallel {
      let path = HybridPdfPaths.normalize(filePath)
      guard let source = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw RuntimeError.error(withMessage: "Failed to open PDF: \(path)")
      }
      let extracted = PDFDocument()
      for index in HybridPdfPaths.intArray(pageNumbersJson) where index >= 0 && index < source.pageCount {
        if let page = source.page(at: index) {
          extracted.insert(page, at: extracted.pageCount)
        }
      }
      let output = outputPath.isEmpty
        ? HybridPdfPaths.sibling(path, suffix: "-extract.pdf")
        : HybridPdfPaths.normalize(outputPath)
      guard extracted.write(to: URL(fileURLWithPath: output)) else {
        throw RuntimeError.error(withMessage: "Failed to write extracted PDF")
      }
      return output
    }
  }

  public func compressPDF(inputPath: String, outputPath: String, compressionLevel: Double) throws -> Promise<String> {
    Promise.parallel {
      let started = Date()
      let input = HybridPdfPaths.normalize(inputPath)
      guard let source = PDFDocument(url: URL(fileURLWithPath: input)) else {
        throw RuntimeError.error(withMessage: "Failed to open PDF: \(input)")
      }
      let originalSize = (try? FileManager.default.attributesOfItem(atPath: input)[.size] as? NSNumber)?.doubleValue ?? 0
      let level = min(9, max(0, compressionLevel))
      let scale = 1.0 - (level / 9.0) * 0.55
      let quality = CGFloat(0.92 - (level / 9.0) * 0.57)
      let compressed = PDFDocument()
      for index in 0..<source.pageCount {
        guard let page = source.page(at: index) else { continue }
        let bounds = page.bounds(for: .mediaBox)
        let image = page.thumbnail(
          of: CGSize(width: bounds.width * scale, height: bounds.height * scale),
          for: .mediaBox
        )
        guard let jpeg = image.jpegData(compressionQuality: quality),
              let redrawn = UIImage(data: jpeg),
              let newPage = PDFPage(image: redrawn) else {
          continue
        }
        compressed.insert(newPage, at: compressed.pageCount)
      }
      let output = outputPath.isEmpty
        ? HybridPdfPaths.sibling(input, suffix: "-compressed.pdf")
        : HybridPdfPaths.normalize(outputPath)
      guard compressed.write(to: URL(fileURLWithPath: output)) else {
        throw RuntimeError.error(withMessage: "Failed to write compressed PDF")
      }
      let compressedSize = (try? FileManager.default.attributesOfItem(atPath: output)[.size] as? NSNumber)?.doubleValue ?? 0
      let duration = Date().timeIntervalSince(started) * 1000
      let ratio = originalSize > 0 ? compressedSize / originalSize : 1
      let saved = (1 - ratio) * 100
      return "{\"success\":true,\"originalSize\":\(originalSize),\"compressedSize\":\(compressedSize),\"durationMs\":\(duration),\"compressionRatio\":\(ratio),\"spaceSavedPercent\":\(saved),\"outputPath\":\"\(output)\"}"
    }
  }

  public func storeCachedPdf(base64: String, identifier: String) throws -> Promise<PdfCacheInfo> {
    Promise.parallel { try HybridPdfDiskCache.store(base64, identifier: identifier) }
  }

  public func cachedPdfPath(identifier: String) throws -> Promise<String> {
    Promise.parallel { HybridPdfDiskCache.path(identifier) }
  }

  public func removeCachedPdf(identifier: String) throws -> Promise<Bool> {
    Promise.parallel { HybridPdfDiskCache.remove(identifier) }
  }

  public func clearPdfCache() throws -> Promise<Bool> {
    Promise.parallel { HybridPdfDiskCache.clear() }
  }

  public func clearExpiredPdfs() throws -> Promise<Double> {
    Promise.parallel { HybridPdfDiskCache.clearExpired() }
  }

  public func pdfCacheStats() throws -> Promise<PdfCacheStats> {
    Promise.parallel { HybridPdfDiskCache.stats() }
  }
}

enum HybridPdfDiskCache {
  private static let ttl: TimeInterval = 30 * 24 * 60 * 60
  private static let maxBytes: UInt64 = 500 * 1024 * 1024
  private static let maxFiles = 100
  private static let lock = NSLock()
  private static var hits = 0
  private static var misses = 0

  private static var directory: URL {
    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("pdf-jsi-cache", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private static func file(for identifier: String) -> URL {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    let name = String(identifier.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
    return directory.appendingPathComponent((name.isEmpty ? "pdf" : name) + ".pdf")
  }

  static func store(_ base64: String, identifier: String) throws -> PdfCacheInfo {
    guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
          data.starts(with: Data("%PDF-".utf8)) else {
      throw RuntimeError.error(withMessage: "Invalid PDF data")
    }
    evictIfNeeded(adding: UInt64(data.count))
    let url = file(for: identifier)
    try data.write(to: url)
    return PdfCacheInfo(cacheId: identifier, filePath: url.path, fileSize: Double(data.count))
  }

  static func path(_ identifier: String) -> String {
    let url = file(for: identifier)
    lock.lock()
    defer { lock.unlock() }
    guard FileManager.default.fileExists(atPath: url.path) else {
      misses += 1
      return ""
    }
    if let values = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
       let modified = values.contentModificationDate,
       Date().timeIntervalSince(modified) > ttl {
      misses += 1
      return ""
    }
    hits += 1
    return url.path
  }

  static func remove(_ identifier: String) -> Bool {
    do {
      try FileManager.default.removeItem(at: file(for: identifier))
      return true
    } catch {
      return false
    }
  }

  static func clear() -> Bool {
    lock.lock()
    hits = 0
    misses = 0
    lock.unlock()
    let url = directory
    if let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
      for file in files { try? FileManager.default.removeItem(at: file) }
    }
    return true
  }

  static func clearExpired() -> Double {
    let url = directory
    var removed = 0
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.contentModificationDateKey]
    ) else {
      return 0
    }
    for file in files where file.pathExtension == "pdf" {
      if let values = try? file.resourceValues(forKeys: [.contentModificationDateKey]),
         let modified = values.contentModificationDate,
         Date().timeIntervalSince(modified) > ttl {
        try? FileManager.default.removeItem(at: file)
        removed += 1
      }
    }
    return Double(removed)
  }

  static func stats() -> PdfCacheStats {
    let url = directory
    var count = 0.0
    var bytes = 0.0
    if let files = try? FileManager.default.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.fileSizeKey]
    ) {
      for file in files where file.pathExtension == "pdf" {
        count += 1
        if let values = try? file.resourceValues(forKeys: [.fileSizeKey]) {
          bytes += Double(values.fileSize ?? 0)
        }
      }
    }
    lock.lock()
    let lookups = hits + misses
    let ratio = lookups == 0 ? 0 : Double(hits) / Double(lookups)
    lock.unlock()
    return PdfCacheStats(fileCount: count, totalBytes: bytes, hitRatio: ratio)
  }

  private static func evictIfNeeded(adding extra: UInt64) {
    let url = directory
    guard var files = try? FileManager.default.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
    ) else {
      return
    }
    files = files.filter { $0.pathExtension == "pdf" }
    files.sort { a, b in
      let left = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      let right = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      return left < right
    }
    var total = files.reduce(UInt64(0)) { sum, file in
      sum + UInt64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    var index = 0
    while (files.count - index > maxFiles || total + extra > maxBytes) && index < files.count {
      let size = UInt64((try? files[index].resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      try? FileManager.default.removeItem(at: files[index])
      total -= size
      index += 1
    }
  }
}

extension HybridPdfPaths {
  static func ranges(_ json: String) -> [(Int, Int)] {
    guard let data = json.data(using: .utf8),
          let values = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
      return []
    }
    return values.compactMap { value in
      guard let pair = value as? [Any], let start = pair.first as? NSNumber else { return nil }
      let end = (pair.count > 1 ? pair[1] as? NSNumber : start) ?? start
      return (start.intValue, end.intValue)
    }
  }
}
