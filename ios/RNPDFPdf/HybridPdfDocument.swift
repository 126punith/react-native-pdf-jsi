import Foundation
import NitroModules
import PDFKit
import UIKit
import Vision

public final class HybridPdfDocument: HybridPdfDocumentSpec {
  private let lock = NSLock()
  private var document: PDFDocument?
  private var filePath = ""
  private var quality: Double = 2
  private var renderCount = 0
  private var lastRenderMs: Double = 0
  private var totalRenderMs: Double = 0

  public func openFile(_ rawPath: String) throws {
    let path = HybridPdfPaths.normalize(rawPath)
    guard let pdf = PDFDocument(url: URL(fileURLWithPath: path)) else {
      throw RuntimeError.error(withMessage: "Failed to open PDF: \(path)")
    }
    lock.lock()
    document = pdf
    filePath = path
    lock.unlock()
  }

  private func withDocument<T>(_ body: (PDFDocument) throws -> T) throws -> T {
    lock.lock()
    guard let document else {
      lock.unlock()
      throw RuntimeError.error(withMessage: "PDF document is not open")
    }
    defer { lock.unlock() }
    return try body(document)
  }

  public var pageCount: Double {
    (try? withDocument { Double($0.pageCount) }) ?? 0
  }

  public var path: String { filePath }

  public var cacheMetrics: CacheMetrics {
    CacheMetrics(pageCacheSize: 0, totalCacheSizeKb: 0, hitRatio: 0)
  }

  public var performanceMetrics: PerformanceMetrics {
    lock.lock()
    let renders = renderCount
    let average = renders == 0 ? 0 : totalRenderMs / Double(renders)
    let last = lastRenderMs
    lock.unlock()
    return PerformanceMetrics(lastRenderTime: last, avgRenderTime: average, cacheHitRatio: 0, memoryUsageMB: 0)
  }

  public func pageSize(index: Double) throws -> PageSize {
    try withDocument { document in
      guard let page = document.page(at: Int(index)) else {
        throw RuntimeError.error(withMessage: "Page index out of range")
      }
      let bounds = page.bounds(for: .mediaBox)
      return PageSize(width: bounds.width, height: bounds.height)
    }
  }

  public func pageMetrics(index: Double) throws -> PageMetrics {
    try withDocument { document in
      guard let page = document.page(at: Int(index)) else {
        throw RuntimeError.error(withMessage: "Page index out of range")
      }
      let bounds = page.bounds(for: .mediaBox)
      return PageMetrics(
        pageNumber: index,
        width: bounds.width,
        height: bounds.height,
        rotation: Double(page.rotation),
        scale: quality,
        renderTimeMs: 0,
        cacheSizeKb: 0
      )
    }
  }

  public func setRenderQuality(quality: Double) throws {
    lock.lock()
    self.quality = quality
    lock.unlock()
  }

  public func clearCache() throws {
    lock.lock()
    renderCount = 0
    lastRenderMs = 0
    totalRenderMs = 0
    lock.unlock()
  }

  public func optimizeMemory() throws {
    try clearCache()
  }

  public func renderPage(index: Double, scale: Double) throws -> Promise<RenderResult> {
    let pageIndex = Int(index)
    let safeScale = scale > 0 ? scale : 1
    return Promise.parallel {
      let started = Date()
      let size = try self.withDocument { document -> CGSize in
        guard let page = document.page(at: pageIndex) else {
          throw RuntimeError.error(withMessage: "Page index out of range")
        }
        let bounds = page.bounds(for: .mediaBox)
        let imageSize = CGSize(width: bounds.width * safeScale, height: bounds.height * safeScale)
        _ = page.thumbnail(of: imageSize, for: .mediaBox)
        return imageSize
      }
      let elapsed = Date().timeIntervalSince(started) * 1000
      self.lock.lock()
      self.lastRenderMs = elapsed
      self.totalRenderMs += elapsed
      self.renderCount += 1
      self.lock.unlock()
      return RenderResult(
        success: true,
        pageNumber: index,
        width: size.width,
        height: size.height,
        scale: safeScale,
        cached: false,
        renderTimeMs: elapsed
      )
    }
  }

  public func preloadPages(startPage: Double, endPage: Double) throws -> Promise<Bool> {
    let start = Int(min(startPage, endPage))
    let end = Int(max(startPage, endPage))
    return Promise.parallel {
      try self.withDocument { document in
        for page in start...end {
          if document.page(at: page) == nil {
            throw RuntimeError.error(withMessage: "Page index out of range")
          }
        }
      }
      return true
    }
  }

  public func searchText(term: String, startPage: Double, endPage: Double) throws -> Promise<[SearchResult]> {
    return Promise.parallel {
      try self.withDocument { document in
        guard !term.isEmpty else { return [] }
        let from = Int(min(startPage, endPage))
        let to = Int(max(startPage, endPage))
        return document.findString(term, withOptions: .caseInsensitive).compactMap { selection in
          guard let page = selection.pages.first else {
            return nil
          }
          let pageIndex = document.index(for: page)
          if pageIndex == NSNotFound || pageIndex < from || pageIndex > to {
            return nil
          }
          let bounds = selection.bounds(for: page)
          let rect = "\(bounds.minX),\(bounds.minY),\(bounds.maxX),\(bounds.maxY)"
          return SearchResult(page: Double(pageIndex), text: selection.string ?? term, rect: rect)
        }
      }
    }
  }

  public func extractText(index: Double) throws -> Promise<String> {
    let pageIndex = Int(index)
    return Promise.parallel {
      try self.withDocument { document in
        document.page(at: pageIndex)?.string ?? ""
      }
    }
  }

  public func extractTextFromPages(pageIndicesJson: String) throws -> Promise<String> {
    return Promise.parallel {
      try self.withDocument { document in
        let indices = HybridPdfPaths.intArray(pageIndicesJson)
        var object: [String: String] = [:]
        for index in indices {
          object[String(index)] = document.page(at: index)?.string ?? ""
        }
        let data = try JSONSerialization.data(withJSONObject: object)
        return String(data: data, encoding: .utf8) ?? "{}"
      }
    }
  }

  public func extractAllText() throws -> Promise<String> {
    return Promise.parallel {
      try self.withDocument { document in
        var object: [String: String] = [:]
        for index in 0..<document.pageCount {
          object[String(index)] = document.page(at: index)?.string ?? ""
        }
        let data = try JSONSerialization.data(withJSONObject: object)
        return String(data: data, encoding: .utf8) ?? "{}"
      }
    }
  }

  public func recognizeText(index: Double, fast: Bool) throws -> Promise<String> {
    let pageIndex = Int(index)
    return Promise.parallel {
      let image: UIImage = try self.withDocument { document in
        guard let page = document.page(at: pageIndex) else {
          throw RuntimeError.error(withMessage: "Page index out of range")
        }
        let bounds = page.bounds(for: .mediaBox)
        let scale: CGFloat = fast ? 1.5 : (200.0 / 72.0)
        return page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
      }
      return try HybridPdfOcr.recognize(image)
    }
  }

  public func exportPageToImage(index: Double, scale: Double) throws -> Promise<String> {
    let pageIndex = Int(index)
    let safeScale = scale > 0 ? scale : 1
    return Promise.parallel {
      let path = self.filePath
      let image: UIImage = try self.withDocument { document in
        guard let page = document.page(at: pageIndex) else {
          throw RuntimeError.error(withMessage: "Page index out of range")
        }
        let bounds = page.bounds(for: .mediaBox)
        return page.thumbnail(of: CGSize(width: bounds.width * safeScale, height: bounds.height * safeScale), for: .mediaBox)
      }
      let output = HybridPdfPaths.sibling(path, suffix: "-page-\(pageIndex).jpg")
      guard let data = image.jpegData(compressionQuality: 0.9) else {
        throw RuntimeError.error(withMessage: "JPEG encode failed")
      }
      try data.write(to: URL(fileURLWithPath: output))
      return output
    }
  }

  public func exportToImages(scale: Double) throws -> Promise<String> {
    let safeScale = scale > 0 ? scale : 1
    return Promise.parallel {
      let path = self.filePath
      let images: [UIImage] = try self.withDocument { document in
        (0..<document.pageCount).compactMap { index in
          guard let page = document.page(at: index) else { return nil }
          let bounds = page.bounds(for: .mediaBox)
          return page.thumbnail(of: CGSize(width: bounds.width * safeScale, height: bounds.height * safeScale), for: .mediaBox)
        }
      }
      var paths: [String] = []
      for (index, image) in images.enumerated() {
        let output = HybridPdfPaths.sibling(path, suffix: "-page-\(index).jpg")
        guard let data = image.jpegData(compressionQuality: 0.9) else {
          throw RuntimeError.error(withMessage: "JPEG encode failed")
        }
        try data.write(to: URL(fileURLWithPath: output))
        paths.append(output)
      }
      let data = try JSONSerialization.data(withJSONObject: paths)
      return String(data: data, encoding: .utf8) ?? "[]"
    }
  }

  public func rotatePage(pageNumber: Double, degrees: Double) throws -> Promise<Bool> {
    let pageIndex = Int(pageNumber)
    let turns = ((Int(degrees) % 360) + 360) % 360 / 90
    return Promise.parallel {
      try self.withDocument { document in
        guard let page = document.page(at: pageIndex) else { return false }
        page.rotation = (page.rotation + turns * 90) % 360
        return document.write(to: URL(fileURLWithPath: self.filePath))
      }
    }
  }

  public func deletePage(pageNumber: Double) throws -> Promise<Bool> {
    let pageIndex = Int(pageNumber)
    return Promise.parallel {
      try self.withDocument { document in
        guard pageIndex >= 0, pageIndex < document.pageCount else { return false }
        document.removePage(at: pageIndex)
        return document.write(to: URL(fileURLWithPath: self.filePath))
      }
    }
  }

  public func close() throws {
    lock.lock()
    document = nil
    lock.unlock()
  }
}

enum HybridPdfOcr {
  static func recognize(_ image: UIImage) throws -> String {
    guard let cgImage = image.cgImage else {
      throw RuntimeError.error(withMessage: "Failed to decode page image")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
  }
}

enum HybridPdfPaths {
  static func normalize(_ filePath: String) -> String {
    if filePath.hasPrefix("file://") {
      return String(filePath.dropFirst("file://".count))
    }
    return filePath
  }

  static func sibling(_ path: String, suffix: String) -> String {
    let url = URL(fileURLWithPath: normalize(path))
    let name = url.deletingPathExtension().lastPathComponent
    return url.deletingLastPathComponent().appendingPathComponent(name + suffix).path
  }

  static func intArray(_ json: String) -> [Int] {
    guard let data = json.data(using: .utf8),
          let values = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
      return []
    }
    return values.compactMap { value in
      if let number = value as? NSNumber { return number.intValue }
      return nil
    }
  }
}
