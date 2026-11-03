// PDF 页面 OCR(macOS Vision)
//
// 用法:
//   ocr <pdf> <outdir> [maxWidth] [--pages start-end] [--auto-rotate] [--save-images dir]
//
// 说明:
// - 竖排古籍在 Vision 中直接识别效果很差;--auto-rotate 会分别尝试 0/90/270 度,
//   按识别出的中文字符数选最优结果。
// - 每页一个文件,便于断点续跑;输出 page-0001.txt。

import AppKit
import Foundation
import PDFKit
import Vision

func stderr(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

func cjkScore(_ text: String) -> Int {
    text.unicodeScalars.reduce(0) { score, scalar in
        let value = scalar.value
        if (0x3400...0x4DBF).contains(value) || (0x4E00...0x9FFF).contains(value) {
            return score + 1
        }
        return score
    }
}

func recognize(_ image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
        try handler.perform([request])
    } catch {
        stderr("ocr failed: \(error)")
        return ""
    }

    let observations = (request.results ?? []).sorted { left, right in
        let ly = left.boundingBox.midY
        let ry = right.boundingBox.midY
        if abs(ly - ry) > 0.01 { return ly > ry }
        return left.boundingBox.minX < right.boundingBox.minX
    }

    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func rotated(_ image: CGImage, degrees: CGFloat) -> CGImage? {
    let radians = degrees * .pi / 180
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    let cosine = abs(cos(radians))
    let sine = abs(sin(radians))
    let newWidth = Int(width * cosine + height * sine)
    let newHeight = Int(width * sine + height * cosine)

    guard let context = CGContext(
        data: nil,
        width: newWidth,
        height: newHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    context.translateBy(x: CGFloat(newWidth) / 2, y: CGFloat(newHeight) / 2)
    context.rotate(by: radians)
    context.draw(image, in: CGRect(x: -width / 2, y: -height / 2, width: width, height: height))
    return context.makeImage()
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    stderr("usage: ocr <pdf> <outdir> [maxWidth] [--pages start-end] [--auto-rotate] [--save-images dir]")
    exit(2)
}

let pdfURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
let maxWidth = args.count >= 4 && Double(args[3]) != nil ? (Double(args[3]) ?? 1800) : 1800
let autoRotate = args.contains("--auto-rotate")

var startPage = 0
var endPage = Int.max
if let index = args.firstIndex(of: "--pages"), index + 1 < args.count {
    let parts = args[index + 1].split(separator: "-")
    if parts.count == 2, let start = Int(parts[0]), let end = Int(parts[1]) {
        startPage = max(0, start - 1)
        endPage = end
    }
}

var saveImagesDir: URL?
if let index = args.firstIndex(of: "--save-images"), index + 1 < args.count {
    saveImagesDir = URL(fileURLWithPath: args[index + 1])
    try? FileManager.default.createDirectory(at: saveImagesDir!, withIntermediateDirectories: true)
}

let renderOnly = args.contains("--render-only")
if renderOnly && saveImagesDir == nil {
    saveImagesDir = outDir
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
}

try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// 图片输入模式:便于调试旋转/OCR,不依赖 PDF
let inputURL = URL(fileURLWithPath: args[1])
let imageExtensions = ["png", "jpg", "jpeg", "tiff"]
if imageExtensions.contains(inputURL.pathExtension.lowercased()) {
    guard let nsImage = NSImage(contentsOf: inputURL) else {
        stderr("cannot open image: \(inputURL.path)")
        exit(1)
    }
    var rect = NSRect(origin: .zero, size: nsImage.size)
    guard let cgImage = nsImage.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        stderr("cannot decode image: \(inputURL.path)")
        exit(1)
    }

    var best = ""
    var bestScore = -1
    for degrees in [0, 90, 270] as [CGFloat] {
        guard let candidate = degrees == 0 ? cgImage : rotated(cgImage, degrees: degrees) else { continue }
        let text = recognize(candidate)
        let score = cjkScore(text)
        if score > bestScore {
            bestScore = score
            best = text
        }
    }
    let file = outDir.appendingPathComponent(inputURL.deletingPathExtension().lastPathComponent + ".txt")
    try? best.write(to: file, atomically: true, encoding: .utf8)
    print("image chars=\(best.count) cjk=\(max(bestScore, 0))")
    exit(0)
}

guard let document = PDFDocument(url: inputURL) else {
    stderr("cannot open pdf: \(inputURL.path)")
    exit(1)
}

let pageCount = document.pageCount
print("pages=\(pageCount)")

let upper = min(endPage, pageCount)
for index in startPage..<upper {
    guard let page = document.page(at: index) else { continue }

    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else { continue }
    let scale = maxWidth / Double(bounds.width)
    let size = NSSize(width: maxWidth, height: Double(bounds.height) * scale)

    let image = page.thumbnail(of: size, for: .mediaBox)
    var rect = NSRect(origin: .zero, size: image.size)
    guard let original = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        stderr("page \(index + 1): render failed")
        continue
    }

    if let dir = saveImagesDir {
        let rep = NSBitmapImageRep(cgImage: original)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: dir.appendingPathComponent(String(format: "page-%04d.png", index + 1)))
        }
    }

    if renderOnly {
        print("rendered \(index + 1)/\(pageCount)")
        continue
    }

    var best = ""
    var bestScore = -1
    let orientations: [CGFloat] = autoRotate ? [0, 90, 270] : [0]

    for degrees in orientations {
        guard let candidate = degrees == 0 ? original : rotated(original, degrees: degrees) else { continue }
        let text = recognize(candidate)
        let score = cjkScore(text)
        if score > bestScore {
            bestScore = score
            best = text
        }
    }

    let file = outDir.appendingPathComponent(String(format: "page-%04d.txt", index + 1))
    try? best.write(to: file, atomically: true, encoding: .utf8)
    print("page \(index + 1)/\(pageCount) chars=\(best.count) cjk=\(max(bestScore, 0))")
}
