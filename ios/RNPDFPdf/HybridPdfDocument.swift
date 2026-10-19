import Foundation
import NitroModules
import PDFKit
import UIKit
import Vision

/// Maps between PDFKit page space (bottom-left origin) and display space:
/// points from the top-left of the crop box as displayed, rotation applied.
struct PdfPageSpace {
  let size: CGSize
  private let transform: CGAffineTransform

  init(_ page: PDFPage) {
    let box = page.bounds(for: .cropBox)
    let rotation = ((page.rotation % 360) + 360) % 360
    size = rotation % 180 == 0 ? box.size : CGSize(width: box.height, height: box.width)
    transform = page.transform(for: .cropBox)
  }

  func toDisplay(_ rect: CGRect) -> PdfRect {
    let rotated = rect.applying(transform)
    return PdfRect(x: rotated.minX, y: size.height - rotated.maxY, width: rotated.width, height: rotated.height)
  }

  func toPage(_ rect: PdfRect) -> CGRect {
    let flipped = CGRect(x: rect.x, y: size.height - rect.y - rect.height, width: rect.width, height: rect.height)
    return flipped.applying(transform.inverted())
  }

  func toPage(_ point: PdfPoint) -> CGPoint {
    CGPoint(x: point.x, y: size.height - point.y).applying(transform.inverted())
  }
}

public final class HybridPdfDocument: HybridPdfDocumentSpec {
  private let lock = NSLock()
  private var document: PDFDocument?
  /// Documents whose pages were inserted; PDFKit pages keep a reference to their source.
  private var insertedSources: [PDFDocument] = []
  private var filePath = ""
  private var fileSize = 0
  private var dirty = false
  private var encrypted = false

  /// Opens `rawPath`. An empty password is tried first, then `password`.
  public func openFile(_ rawPath: String, password: String?) throws {
    let path = HybridPdfPaths.normalize(rawPath)
    let pdf = try HybridPdfDocument.load(path, password: password)
    let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.intValue ?? 0
    lock.lock()
    document = pdf
    filePath = path
    fileSize = size
    encrypted = pdf.isEncrypted
    lock.unlock()
  }

  static func load(_ path: String, password: String?) throws -> PDFDocument {
    guard FileManager.default.fileExists(atPath: path) else {
      throw pdfError("invalid-source", "File not found: \(path)")
    }
    guard let pdf = PDFDocument(url: URL(fileURLWithPath: path)) else {
      throw pdfError("unsupported-pdf", "Not a PDF or the file is damaged: \(path)")
    }
    if pdf.isLocked && !pdf.unlock(withPassword: "") {
      guard let password, !password.isEmpty else {
        throw pdfError("password-required", "This PDF needs a password: \(path)")
      }
      guard pdf.unlock(withPassword: password) else {
        throw pdfError("password-incorrect", "The password is incorrect: \(path)")
      }
    }
    return pdf
  }

  /// Approximates PDFKit's footprint by file size so Hermes sees the native cost of an open document.
  public var memorySize: Int {
    lock.lock()
    defer { lock.unlock() }
    return document == nil ? 0 : fileSize
  }

  private func withDocument<T>(_ body: (PDFDocument) throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    guard let document else {
      throw pdfError("document-closed", "The PDF document is closed")
    }
    return try body(document)
  }

  private func edit(_ body: (PDFDocument) throws -> Void) throws {
    try withDocument { document in
      try body(document)
      dirty = true
    }
  }

  private static func page(_ document: PDFDocument, _ index: Int) throws -> PDFPage {
    guard index >= 0, index < document.pageCount, let page = document.page(at: index) else {
      throw pdfError("invalid-page", "Page \(index) is out of range (0-\(document.pageCount - 1))")
    }
    return page
  }

  private static func index(_ value: Double, _ name: String) throws -> Int {
    guard value.isFinite, value.rounded() == value, abs(value) < 1e9 else {
      throw pdfError("invalid-argument", "\(name) must be an integer")
    }
    return Int(value)
  }

  public var pageCount: Double {
    (try? withDocument { Double($0.pageCount) }) ?? 0
  }

  public var path: String { filePath }

  public var isEncrypted: Bool {
    lock.lock()
    defer { lock.unlock() }
    return encrypted
  }

  public var hasUnsavedChanges: Bool {
    lock.lock()
    defer { lock.unlock() }
    return dirty
  }

  public func pageSize(index: Double) throws -> PageSize {
    let pageIndex = try Self.index(index, "index")
    return try withDocument { document in
      let space = PdfPageSpace(try Self.page(document, pageIndex))
      return PageSize(width: space.size.width, height: space.size.height)
    }
  }

  public func pageMetrics(index: Double) throws -> PageMetrics {
    let pageIndex = try Self.index(index, "index")
    return try withDocument { document in
      let page = try Self.page(document, pageIndex)
      let space = PdfPageSpace(page)
      let rotation = ((page.rotation % 360) + 360) % 360
      return PageMetrics(page: Double(pageIndex), width: space.size.width, height: space.size.height, rotation: Double(rotation))
    }
  }

  public func getOutline() throws -> Promise<[OutlineItem]> {
    Promise.parallel {
      try self.withDocument { document in
        var items: [OutlineItem] = []
        func visit(_ node: PDFOutline, level: Int) {
          guard level <= 32, items.count < 10_000 else { return }
          for childIndex in 0..<node.numberOfChildren {
            guard let child = node.child(at: childIndex) else { continue }
            var page = -1
            if let target = child.destination?.page ?? (child.action as? PDFActionGoTo)?.destination.page {
              let found = document.index(for: target)
              page = found == NSNotFound ? -1 : found
            }
            items.append(OutlineItem(title: child.label ?? "", page: Double(page), level: Double(level)))
            visit(child, level: level + 1)
          }
        }
        if let root = document.outlineRoot {
          visit(root, level: 0)
        }
        return items
      }
    }
  }

  // MARK: Rendering

  struct RenderRequest {
    var maxWidth: Double = 0
    var maxHeight: Double = 0
    var scale: Double = 2
    var png = false
    var quality: Double = 90
    var background = UIColor.white
    var outputPath = ""
  }

  private static func positive(_ value: Double?) throws -> Double? {
    if let value, !value.isFinite || value <= 0 {
      throw pdfError("invalid-argument", "Sizes and scale must be positive numbers")
    }
    return value
  }

  private static func quality(_ value: Double?) throws -> Double {
    guard let value else { return 90 }
    guard value.isFinite, value >= 0, value <= 100 else {
      throw pdfError("invalid-argument", "quality must be between 0 and 100")
    }
    return value
  }

  static func color(_ value: String?, fallback: UIColor) throws -> UIColor {
    guard let value, !value.isEmpty else { return fallback }
    var hex = value
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6 || hex.count == 8, let packed = UInt64(hex, radix: 16) else {
      throw pdfError("invalid-argument", "Colours must be #RRGGBB or #RRGGBBAA, got \(value)")
    }
    let rgba = hex.count == 6 ? (packed << 8) | 0xFF : packed
    return UIColor(
      red: CGFloat((rgba >> 24) & 0xFF) / 255,
      green: CGFloat((rgba >> 16) & 0xFF) / 255,
      blue: CGFloat((rgba >> 8) & 0xFF) / 255,
      alpha: CGFloat(rgba & 0xFF) / 255
    )
  }

  static func hex(_ color: UIColor?) -> String {
    guard let color else { return "" }
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return "" }
    let parts = [red, green, blue].map { Int(($0 * 255).rounded()) }
    let a = Int((alpha * 255).rounded())
    return a >= 255
      ? String(format: "#%02X%02X%02X", parts[0], parts[1], parts[2])
      : String(format: "#%02X%02X%02X%02X", parts[0], parts[1], parts[2], a)
  }

  private static func targetSize(_ size: CGSize, _ request: RenderRequest) -> CGSize {
    var factor = request.scale > 0 ? request.scale : 2
    if request.maxWidth > 0 || request.maxHeight > 0 {
      let byWidth = request.maxWidth > 0 ? request.maxWidth / size.width : .infinity
      let byHeight = request.maxHeight > 0 ? request.maxHeight / size.height : .infinity
      factor = min(byWidth, byHeight)
    }
    let maxPixels = 64.0 * 1024 * 1024
    let pixels = size.width * factor * size.height * factor
    if pixels > maxPixels {
      factor *= (maxPixels / pixels).squareRoot()
    }
    return CGSize(width: max(1, (size.width * factor).rounded()), height: max(1, (size.height * factor).rounded()))
  }

  static func draw(_ page: PDFPage, size: CGSize, background: UIColor) -> UIImage {
    let space = PdfPageSpace(page)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      background.withAlphaComponent(1).setFill()
      context.fill(CGRect(origin: .zero, size: size))
      let cg = context.cgContext
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: size.width / space.size.width, y: -size.height / space.size.height)
      page.draw(with: .cropBox, to: cg)
    }
  }

  static var renderDirectory: URL = {
    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("pdf-jsi/renders", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
    if let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) {
      for file in files {
        let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
        if modified < cutoff { try? FileManager.default.removeItem(at: file) }
      }
    }
    return url
  }()

  private func render(_ pageIndex: Int, _ request: RenderRequest) throws -> RenderedImage {
    let image: UIImage = try withDocument { document in
      let page = try Self.page(document, pageIndex)
      return autoreleasepool {
        Self.draw(page, size: Self.targetSize(PdfPageSpace(page).size, request), background: request.background)
      }
    }
    guard let data = request.png ? image.pngData() : image.jpegData(compressionQuality: CGFloat(request.quality / 100)) else {
      throw pdfError("page-render-failed", "Failed to encode page \(pageIndex)")
    }
    let output: String
    if request.outputPath.isEmpty {
      let stem = URL(fileURLWithPath: filePath).deletingPathExtension().lastPathComponent
      let name = "\(stem.prefix(48))-p\(pageIndex)-\(UUID().uuidString.prefix(8)).\(request.png ? "png" : "jpg")"
      output = Self.renderDirectory.appendingPathComponent(name).path
    } else {
      output = HybridPdfPaths.normalize(request.outputPath)
    }
    do {
      try FileManager.default.createDirectory(
        at: URL(fileURLWithPath: output).deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try data.write(to: URL(fileURLWithPath: output), options: .atomic)
    } catch {
      throw pdfError("io-error", "Failed to write \(output): \(error.localizedDescription)")
    }
    let pixelWidth = Double(image.cgImage?.width ?? Int(image.size.width))
    let pixelHeight = Double(image.cgImage?.height ?? Int(image.size.height))
    return RenderedImage(page: Double(pageIndex), uri: URL(fileURLWithPath: output).absoluteString, path: output,
                         width: pixelWidth, height: pixelHeight)
  }

  public func renderPage(index: Double, options: RenderOptions?) throws -> Promise<RenderedImage> {
    let pageIndex = try Self.index(index, "index")
    var request = RenderRequest()
    if let options {
      request.maxWidth = try Self.positive(options.maxWidth) ?? 0
      request.maxHeight = try Self.positive(options.maxHeight) ?? 0
      request.scale = try Self.positive(options.scale) ?? 2
      request.png = options.format == .png
      request.quality = try Self.quality(options.quality)
      request.background = try Self.color(options.background, fallback: .white)
      request.outputPath = options.outputPath ?? ""
    }
    let finalRequest = request
    return Promise.parallel { try self.render(pageIndex, finalRequest) }
  }

  public func renderThumbnails(options: ThumbnailOptions?) throws -> Promise<[RenderedImage]> {
    var request = RenderRequest()
    var pages: [Int]?
    var outputDir = ""
    if let options {
      request.maxWidth = try Self.positive(options.maxWidth) ?? 0
      request.maxHeight = try Self.positive(options.maxHeight) ?? 0
      request.png = options.format == .png
      request.quality = try Self.quality(options.quality)
      request.background = try Self.color(options.background, fallback: .white)
      outputDir = HybridPdfPaths.normalize(options.outputDir ?? "")
      pages = try options.pages?.map { try Self.index($0, "pages") }
    }
    if request.maxWidth <= 0 && request.maxHeight <= 0 {
      request.maxWidth = 200
    }
    let base = request
    return Promise.parallel {
      let targets = try pages ?? Array(0..<self.withDocument { $0.pageCount })
      return try targets.map { page in
        var pageRequest = base
        if !outputDir.isEmpty {
          pageRequest.outputPath = URL(fileURLWithPath: outputDir)
            .appendingPathComponent("thumb-\(page).\(base.png ? "png" : "jpg")").path
        }
        return try autoreleasepool { try self.render(page, pageRequest) }
      }
    }
  }

  // MARK: Text

  public func searchText(term: String, startPage: Double, endPage: Double) throws -> Promise<[SearchResult]> {
    let start = try Self.index(startPage, "startPage")
    let end = try Self.index(endPage, "endPage")
    return Promise.parallel {
      try self.withDocument { document in
        guard !term.isEmpty else { return [] }
        let from = max(0, min(start, end))
        let to = min(max(start, end), document.pageCount - 1)
        return document.findString(term, withOptions: .caseInsensitive).compactMap { selection in
          guard let page = selection.pages.first else { return nil }
          let pageIndex = document.index(for: page)
          if pageIndex == NSNotFound || pageIndex < from || pageIndex > to {
            return nil
          }
          let rect = PdfPageSpace(page).toDisplay(selection.bounds(for: page))
          return SearchResult(page: Double(pageIndex), text: selection.string ?? term, rect: rect)
        }
      }
    }
  }

  public func extractText(index: Double) throws -> Promise<String> {
    let pageIndex = try Self.index(index, "index")
    return Promise.parallel {
      try self.withDocument { document in
        try Self.page(document, pageIndex).string ?? ""
      }
    }
  }

  public func extractTextFromPages(pageIndicesJson: String) throws -> Promise<String> {
    return Promise.parallel {
      try self.withDocument { document in
        let indices = HybridPdfPaths.intArray(pageIndicesJson)
        var object: [String: String] = [:]
        for index in indices {
          let page = try Self.page(document, index)
          autoreleasepool {
            object[String(index)] = page.string ?? ""
          }
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
          autoreleasepool {
            object[String(index)] = document.page(at: index)?.string ?? ""
          }
        }
        let data = try JSONSerialization.data(withJSONObject: object)
        return String(data: data, encoding: .utf8) ?? "{}"
      }
    }
  }

  public func recognizeText(index: Double, fast: Bool) throws -> Promise<String> {
    let pageIndex = try Self.index(index, "index")
    return Promise.parallel {
      let image: UIImage = try self.withDocument { document in
        let page = try Self.page(document, pageIndex)
        let scale: CGFloat = fast ? 1.5 : (200.0 / 72.0)
        let size = PdfPageSpace(page).size
        return Self.draw(page, size: CGSize(width: size.width * scale, height: size.height * scale), background: .white)
      }
      return try HybridPdfOcr.recognize(image, fast: fast)
    }
  }

  // MARK: Editing

  public func rotatePage(index: Double, degrees: Double) throws -> Promise<Void> {
    let pageIndex = try Self.index(index, "index")
    let turn = try Self.index(degrees, "degrees")
    guard turn % 90 == 0 else {
      throw pdfError("invalid-argument", "Rotation must be a multiple of 90 degrees, got \(turn)")
    }
    return Promise.parallel {
      try self.edit { document in
        let page = try Self.page(document, pageIndex)
        page.rotation = (((page.rotation + turn) % 360) + 360) % 360
      }
    }
  }

  public func deletePage(index: Double) throws -> Promise<Void> {
    let pageIndex = try Self.index(index, "index")
    return Promise.parallel {
      try self.edit { document in
        _ = try Self.page(document, pageIndex)
        guard document.pageCount > 1 else {
          throw pdfError("invalid-argument", "Cannot delete the only page of a PDF")
        }
        document.removePage(at: pageIndex)
      }
    }
  }

  public func movePage(from: Double, to: Double) throws -> Promise<Void> {
    let source = try Self.index(from, "from")
    let target = try Self.index(to, "to")
    return Promise.parallel {
      try self.withDocument { document in
        let page = try Self.page(document, source)
        _ = try Self.page(document, target)
        guard source != target else { return }
        document.removePage(at: source)
        document.insert(page, at: target)
        self.dirty = true
      }
    }
  }

  public func insertPages(fromPath: String, atIndex: Double, pages: [Double]?, password: String?) throws -> Promise<Void> {
    let at = try Self.index(atIndex, "atIndex")
    let indices = try pages?.map { try Self.index($0, "pages") }
    if let indices, indices.isEmpty {
      throw pdfError("invalid-argument", "pages must not be empty")
    }
    return Promise.parallel {
      let sourcePath = HybridPdfPaths.normalize(fromPath)
      let source = try HybridPdfDocument.load(sourcePath, password: password)
      try self.edit { document in
        guard at >= 0, at <= document.pageCount else {
          throw pdfError("invalid-page", "Insert position \(at) is out of range (0-\(document.pageCount))")
        }
        let wanted = indices ?? Array(0..<source.pageCount)
        let copies: [PDFPage] = try wanted.map { index in
          guard index >= 0, index < source.pageCount, let page = source.page(at: index) else {
            throw pdfError("invalid-page", "Page \(index) does not exist in \(sourcePath)")
          }
          return (page.copy() as? PDFPage) ?? page
        }
        for (offset, page) in copies.enumerated() {
          document.insert(page, at: at + offset)
        }
        self.insertedSources.append(source)
      }
    }
  }

  private static func annotationType(_ raw: String?) -> AnnotationType {
    switch raw ?? "" {
    case "Highlight": return .highlight
    case "Ink": return .ink
    case "FreeText": return .freetext
    case "Text": return .note
    case "Stamp": return .stamp
    case "Underline": return .underline
    case "StrikeOut": return .strikeout
    case "Square": return .square
    case "Circle": return .circle
    case "Line": return .line
    case "Link": return .link
    case "Widget": return .widget
    case "Popup": return .popup
    default: return .other
    }
  }

  public func addAnnotation(annotation input: AnnotationInput) throws -> Promise<Double> {
    let pageIndex = try Self.index(input.page, "page")
    guard input.rect.width > 0, input.rect.height > 0 else {
      throw pdfError("invalid-argument", "Annotation rect must have a positive width and height")
    }
    return Promise.parallel {
      try self.withDocument { document in
        let page = try Self.page(document, pageIndex)
        let space = PdfPageSpace(page)
        let bounds = space.toPage(input.rect)
        let annotation: PDFAnnotation
        switch input.type {
        case .highlight:
          annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
          annotation.color = try Self.color(input.color, fallback: UIColor(red: 1, green: 0.92, blue: 0.23, alpha: 0.5))
        case .ink:
          guard let strokes = input.strokes, !strokes.isEmpty else {
            throw pdfError("invalid-argument", "Ink annotations need at least one stroke")
          }
          annotation = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
          annotation.color = try Self.color(input.color, fallback: UIColor(red: 0.9, green: 0.22, blue: 0.21, alpha: 1))
          let border = PDFBorder()
          border.lineWidth = 2
          annotation.border = border
          for stroke in strokes where !stroke.points.isEmpty {
            let path = UIBezierPath()
            for (offset, point) in stroke.points.enumerated() {
              let pagePoint = space.toPage(point)
              let local = CGPoint(x: pagePoint.x - bounds.minX, y: pagePoint.y - bounds.minY)
              if offset == 0 { path.move(to: local) } else { path.addLine(to: local) }
            }
            annotation.add(path)
          }
        case .freetext:
          annotation = PDFAnnotation(bounds: bounds, forType: .freeText, withProperties: nil)
          annotation.contents = input.text ?? ""
          annotation.font = UIFont.systemFont(ofSize: 12)
          annotation.fontColor = try Self.color(input.color, fallback: .black)
          annotation.color = .clear
        case .note:
          annotation = PDFAnnotation(bounds: bounds, forType: .text, withProperties: nil)
          annotation.color = try Self.color(input.color, fallback: UIColor(red: 1, green: 0.84, blue: 0, alpha: 1))
        case .stamp:
          annotation = PDFAnnotation(bounds: bounds, forType: .stamp, withProperties: nil)
          annotation.color = try Self.color(input.color, fallback: UIColor(red: 0.83, green: 0.18, blue: 0.18, alpha: 1))
          if let text = input.text, !text.isEmpty {
            annotation.stampName = text
          }
        }
        if let text = input.text, input.type != .freetext {
          annotation.contents = text
        }
        page.addAnnotation(annotation)
        self.dirty = true
        return Double(page.annotations.firstIndex(of: annotation) ?? page.annotations.count - 1)
      }
    }
  }

  public func getAnnotations(page: Double) throws -> Promise<[PdfAnnotation]> {
    let pageIndex = try Self.index(page, "page")
    return Promise.parallel {
      try self.withDocument { document in
        let pdfPage = try Self.page(document, pageIndex)
        let space = PdfPageSpace(pdfPage)
        return pdfPage.annotations.enumerated().map { offset, annotation in
          PdfAnnotation(
            page: Double(pageIndex),
            index: Double(offset),
            type: Self.annotationType(annotation.type),
            rect: space.toDisplay(annotation.bounds),
            color: Self.hex(annotation.color),
            contents: annotation.contents ?? ""
          )
        }
      }
    }
  }

  public func removeAnnotation(page: Double, index: Double) throws -> Promise<Void> {
    let pageIndex = try Self.index(page, "page")
    let annotationIndex = try Self.index(index, "index")
    return Promise.parallel {
      try self.edit { document in
        let pdfPage = try Self.page(document, pageIndex)
        guard annotationIndex >= 0, annotationIndex < pdfPage.annotations.count else {
          throw pdfError("invalid-argument", "Annotation \(annotationIndex) does not exist on page \(pageIndex)")
        }
        pdfPage.removeAnnotation(pdfPage.annotations[annotationIndex])
      }
    }
  }

  private static func widgets(_ document: PDFDocument) -> [(Int, PDFAnnotation)] {
    var result: [(Int, PDFAnnotation)] = []
    for index in 0..<document.pageCount {
      guard let page = document.page(at: index) else { continue }
      for annotation in page.annotations where annotation.type == "Widget" {
        result.append((index, annotation))
      }
    }
    return result
  }

  private static func fieldType(_ widget: PDFAnnotation) -> FormFieldType {
    switch widget.widgetFieldType {
    case .text: return .text
    case .choice: return widget.isListChoice ? .listbox : .combobox
    case .signature: return .signature
    case .button:
      switch widget.widgetControlType {
      case .checkBoxControl: return .checkbox
      case .radioButtonControl: return .radio
      default: return .pushbutton
      }
    default: return .unknown
    }
  }

  public func getFormFields() throws -> Promise<[PdfFormField]> {
    Promise.parallel {
      try self.withDocument { document in
        var fields: [PdfFormField] = []
        var byName: [String: Int] = [:]
        for (pageIndex, widget) in Self.widgets(document) {
          guard let name = widget.fieldName, !name.isEmpty else { continue }
          let type = Self.fieldType(widget)
          let checked = (type == .checkbox || type == .radio) && widget.buttonWidgetState == .onState
          let exportValue = widget.buttonWidgetStateString
          var value = widget.widgetStringValue ?? ""
          if type == .radio { value = checked ? exportValue : "" }
          if type == .checkbox { value = checked ? (exportValue.isEmpty ? "Yes" : exportValue) : "Off" }
          if let existing = byName[name] {
            let old = fields[existing]
            var options = old.options
            if type == .radio, !exportValue.isEmpty, !options.contains(exportValue) { options.append(exportValue) }
            fields[existing] = PdfFormField(
              name: name, type: old.type, value: checked && type == .radio ? value : old.value,
              checked: old.checked || checked, options: options, page: old.page, readOnly: old.readOnly)
            continue
          }
          var options = widget.choices ?? []
          if type == .radio, !exportValue.isEmpty { options = [exportValue] }
          byName[name] = fields.count
          fields.append(PdfFormField(name: name, type: type, value: value, checked: checked, options: options,
                                     page: Double(pageIndex), readOnly: widget.isReadOnly))
        }
        return fields
      }
    }
  }

  public func setFormFieldValues(values: Dictionary<String, String>) throws -> Promise<Void> {
    Promise.parallel {
      try self.withDocument { document in
        var found = Set<String>()
        for (_, widget) in Self.widgets(document) {
          guard let name = widget.fieldName, let value = values[name] else { continue }
          found.insert(name)
          if widget.isReadOnly { continue }
          switch Self.fieldType(widget) {
          case .checkbox:
            let truthy = ["true", "1", "yes", "on", "checked"].contains(value.lowercased())
            let on = truthy || (!widget.buttonWidgetStateString.isEmpty && value == widget.buttonWidgetStateString)
            widget.buttonWidgetState = on ? .onState : .offState
          case .radio:
            widget.buttonWidgetState = value == widget.buttonWidgetStateString ? .onState : .offState
          case .text, .combobox, .listbox:
            widget.widgetStringValue = value
          default:
            continue
          }
          self.dirty = true
        }
        if let missing = values.keys.first(where: { !found.contains($0) }) {
          throw pdfError("invalid-argument", "No form field named \"\(missing)\"")
        }
      }
    }
  }

  public func flattenForms() throws -> Promise<Void> {
    Promise.parallel {
      guard #available(iOS 16.0, *) else {
        throw pdfError("unsupported-operation", "Flattening forms needs iOS 16 or later")
      }
      try self.withDocument { document in
        guard let data = document.dataRepresentation(options: [PDFDocumentWriteOption.burnInAnnotationsOption: true]),
              let flattened = PDFDocument(data: data) else {
          throw pdfError("unknown", "Failed to flatten the PDF")
        }
        self.document = flattened
        self.dirty = true
      }
    }
  }

  public func save(outputPath: String, options: SaveOptions?) throws -> Promise<String> {
    let output = HybridPdfPaths.normalize(outputPath)
    guard !output.isEmpty else {
      throw pdfError("invalid-argument", "save() needs an output path")
    }
    var writeOptions: [AnyHashable: Any] = [:]
    if let options {
      if let user = options.userPassword { writeOptions[PDFDocumentWriteOption.userPasswordOption] = user }
      if let owner = options.ownerPassword { writeOptions[PDFDocumentWriteOption.ownerPasswordOption] = owner }
      if let permissions = options.permissions {
        guard options.ownerPassword != nil || options.userPassword != nil else {
          throw pdfError("invalid-argument", "permissions need a userPassword or ownerPassword")
        }
        writeOptions[kCGPDFContextAllowsPrinting as String] = permissions.print ?? true
        writeOptions[kCGPDFContextAllowsCopying as String] = permissions.copy ?? true
      }
    }
    let finalOptions = writeOptions
    return Promise.parallel {
      let data: Data = try self.withDocument { document in
        guard let data = document.dataRepresentation(options: finalOptions) else {
          throw pdfError("io-error", "Failed to serialise the PDF")
        }
        return data
      }
      do {
        try FileManager.default.createDirectory(
          at: URL(fileURLWithPath: output).deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try data.write(to: URL(fileURLWithPath: output), options: .atomic)
      } catch {
        throw pdfError("io-error", "Failed to write \(output): \(error.localizedDescription)")
      }
      self.lock.lock()
      self.dirty = false
      self.lock.unlock()
      return output
    }
  }

  public func close() throws {
    lock.lock()
    document = nil
    insertedSources.removeAll()
    lock.unlock()
  }
}

enum HybridPdfOcr {
  static func recognize(_ image: UIImage, fast: Bool) throws -> String {
    guard let cgImage = image.cgImage else {
      throw pdfError("page-render-failed", "Failed to decode page image")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fast ? .fast : .accurate
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
      try handler.perform([request])
    } catch {
      throw pdfError("unknown", "OCR failed: \(error.localizedDescription)")
    }
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
  }
}

enum HybridPdfPaths {
  static func normalize(_ filePath: String) -> String {
    if filePath.hasPrefix("file://") {
      return URL(string: filePath)?.path ?? String(filePath.dropFirst("file://".count))
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
