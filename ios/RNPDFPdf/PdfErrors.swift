import Foundation
import NitroModules

/// Errors reach JS as `[code] message`; `toPdfError` in src/errors.ts reads the code.
func pdfError(_ code: String, _ message: String) -> RuntimeError {
  RuntimeError.error(withMessage: "[\(code)] \(message)")
}

/// Keeps a coded error as it is and wraps anything else with `fallback`.
func pdfError(from error: Error, fallback: String) -> RuntimeError {
  let text = String(describing: error)
  if text.range(of: #"\[[a-z-]+\]"#, options: .regularExpression) != nil {
    return RuntimeError.error(withMessage: text)
  }
  return pdfError(fallback, (error as NSError).localizedDescription)
}
