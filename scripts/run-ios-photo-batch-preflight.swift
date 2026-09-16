#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
@preconcurrency import Vision

private struct Arguments {
    let photosDirectory: URL
    let sanitizedDirectory: URL
    let outputFile: URL
    let startNumber: Int?
    let endNumber: Int?

    init() throws {
        let values = CommandLine.arguments
        guard let photosIndex = values.firstIndex(of: "--photos-dir"), photosIndex + 1 < values.count,
              let sanitizedIndex = values.firstIndex(of: "--sanitized-dir"), sanitizedIndex + 1 < values.count,
              let outputIndex = values.firstIndex(of: "--output"), outputIndex + 1 < values.count else {
            throw PreflightError.invalidArguments
        }
        photosDirectory = URL(fileURLWithPath: values[photosIndex + 1], isDirectory: true)
        sanitizedDirectory = URL(fileURLWithPath: values[sanitizedIndex + 1], isDirectory: true)
        outputFile = URL(fileURLWithPath: values[outputIndex + 1])
        startNumber = values.firstIndex(of: "--start").flatMap { index in
            index + 1 < values.count ? Int(values[index + 1]) : nil
        }
        endNumber = values.firstIndex(of: "--end").flatMap { index in
            index + 1 < values.count ? Int(values[index + 1]) : nil
        }
        guard (startNumber == nil) == (endNumber == nil),
              startNumber == nil || startNumber! <= endNumber! else {
            throw PreflightError.invalidArguments
        }
    }
}

private enum PreflightError: LocalizedError {
    case invalidArguments
    case unreadableImage(String)
    case imageEncodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            return "usage: swift run-ios-photo-batch-preflight.swift --photos-dir DIR --sanitized-dir DIR --output FILE [--start N --end N]"
        case let .unreadableImage(name):
            return "cannot decode image: \(name)"
        case let .imageEncodingFailed(name):
            return "cannot encode sanitized JPEG: \(name)"
        }
    }
}

private struct PhotoResult: Codable {
    let fileName: String
    let sanitizedFile: String
    let pixelWidth: Int
    let pixelHeight: Int
    let sanitizedBytes: Int
    let perceptualHash: String
    let qualityScore: Double
    let labels: [String]
    let faceCount: Int
    let textBlockCount: Int
    let recognizedCharacterCount: Int
    let sensitiveFlags: [String]
    let currentAppEligible: Bool
    var exactDuplicateOf: String?
    var nearDuplicateCluster: Int?
    var nearestVisualFile: String?
    var nearestVisualDistance: Float?
}

private struct Report: Codable {
    let schemaVersion: Int
    let generatedAt: String
    let sourcePhotoCount: Int
    let policy: String
    let exactHashPolicy: String
    let nearDuplicatePolicy: String
    let photos: [PhotoResult]
}

private struct ProcessedPhoto {
    var result: PhotoResult
    let featurePrint: VNFeaturePrintObservation?
}

private let humanLabels: Set<String> = [
    "person", "people", "human", "selfie", "portrait", "adult", "child", "baby",
    "man", "woman", "boy", "girl"
]
private let minimumUsableQualityScore = 0.35

private let arguments = try Arguments()
private let fileManager = FileManager.default
try fileManager.createDirectory(at: arguments.sanitizedDirectory, withIntermediateDirectories: true)
try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: arguments.sanitizedDirectory.path)
try fileManager.createDirectory(at: arguments.outputFile.deletingLastPathComponent(), withIntermediateDirectories: true)

let sourceFiles = try fileManager.contentsOfDirectory(
    at: arguments.photosDirectory,
    includingPropertiesForKeys: [.isRegularFileKey],
    options: [.skipsHiddenFiles]
).filter { url in
    guard ["jpg", "jpeg"].contains(url.pathExtension.lowercased()) else { return false }
    if let start = arguments.startNumber, let end = arguments.endNumber {
        guard let number = photoNumber(url.lastPathComponent) else { return false }
        return (start...end).contains(number)
    }
    return true
}.sorted { $0.lastPathComponent < $1.lastPathComponent }

private var processed: [ProcessedPhoto] = []
for sourceURL in sourceFiles {
    let name = sourceURL.lastPathComponent
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: 1280,
              kCGImageSourceShouldCacheImmediately: true
          ] as CFDictionary) else {
        throw PreflightError.unreadableImage(name)
    }

    let sanitized = try encodeSanitizedJPEG(image: image, fileName: name)
    let sanitizedURL = arguments.sanitizedDirectory
        .appendingPathComponent(sourceURL.deletingPathExtension().lastPathComponent)
        .appendingPathExtension("jpg")
    try sanitized.write(to: sanitizedURL, options: [.atomic])
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: sanitizedURL.path)

    let observations = try observe(image)
    let sample = try grayscaleSample(image)
    let quality = qualityScore(sample)
    var flags = sensitiveFlags(
        faceDetected: observations.faceCount > 0,
        recognizedText: observations.recognizedText,
        textBlockCount: observations.textBlockCount,
        labels: observations.labels
    )
    if observations.documentRectangleDetected && observations.recognizedText.filter({ !$0.isWhitespace }).count >= 60 {
        flags.insert("document")
    }
    if quality < minimumUsableQualityScore { flags.insert("blurred") }
    let hash = averageHash(sample)
    let result = PhotoResult(
        fileName: name,
        sanitizedFile: sanitizedURL.path,
        pixelWidth: image.width,
        pixelHeight: image.height,
        sanitizedBytes: sanitized.count,
        perceptualHash: String(format: "%016llx", hash),
        qualityScore: rounded(quality),
        labels: observations.labels,
        faceCount: observations.faceCount,
        textBlockCount: observations.textBlockCount,
        recognizedCharacterCount: observations.recognizedText.filter({ !$0.isWhitespace }).count,
        sensitiveFlags: flags.sorted(),
        currentAppEligible: quality >= minimumUsableQualityScore && flags.isEmpty,
        exactDuplicateOf: nil,
        nearDuplicateCluster: nil,
        nearestVisualFile: nil,
        nearestVisualDistance: nil
    )
    processed.append(ProcessedPhoto(result: result, featurePrint: observations.featurePrint))
}

var firstByHash: [String: String] = [:]
for index in processed.indices {
    let hash = processed[index].result.perceptualHash
    if let first = firstByHash[hash] {
        processed[index].result.exactDuplicateOf = first
    } else {
        firstByHash[hash] = processed[index].result.fileName
    }
}

private var parent = Array(processed.indices)
func root(_ value: Int) -> Int {
    var cursor = value
    while parent[cursor] != cursor { cursor = parent[cursor] }
    return cursor
}
func unite(_ left: Int, _ right: Int) {
    let leftRoot = root(left)
    let rightRoot = root(right)
    if leftRoot != rightRoot { parent[rightRoot] = leftRoot }
}

let nearDuplicateThreshold: Float = 0.45
for left in processed.indices {
    var nearest: (index: Int, distance: Float)?
    for right in processed.indices where right != left {
        guard let leftPrint = processed[left].featurePrint,
              let rightPrint = processed[right].featurePrint else { continue }
        var distance: Float = 0
        try leftPrint.computeDistance(&distance, to: rightPrint)
        if nearest == nil || distance < nearest!.distance {
            nearest = (right, distance)
        }
        if right > left && distance <= nearDuplicateThreshold {
            unite(left, right)
        }
    }
    if let nearest {
        processed[left].result.nearestVisualFile = processed[nearest.index].result.fileName
        processed[left].result.nearestVisualDistance = rounded(nearest.distance)
    }
}

var clusterNumberByRoot: [Int: Int] = [:]
var clusterCounts: [Int: Int] = [:]
for index in processed.indices { clusterCounts[root(index), default: 0] += 1 }
var nextCluster = 1
for index in processed.indices {
    let groupRoot = root(index)
    guard clusterCounts[groupRoot, default: 0] > 1 else { continue }
    if clusterNumberByRoot[groupRoot] == nil {
        clusterNumberByRoot[groupRoot] = nextCluster
        nextCluster += 1
    }
    processed[index].result.nearDuplicateCluster = clusterNumberByRoot[groupRoot]
}

let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
private let report = Report(
    schemaVersion: 1,
    generatedAt: formatter.string(from: Date()),
    sourcePhotoCount: processed.count,
    policy: "mirrors-ios-photo-privacy-analyzer-v1-without-recognized-text-output",
    exactHashPolicy: "current app rejects only identical 64-bit average hashes already indexed",
    nearDuplicatePolicy: "evaluation-only Vision feature-print clusters at distance <= 0.45",
    photos: processed.map(\.result)
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(report)
try data.write(to: arguments.outputFile, options: [.atomic])
try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: arguments.outputFile.path)
print("PHOTO_PREFLIGHT=PASS photos=\(processed.count) eligible=\(processed.filter { $0.result.currentAppEligible }.count) nearDuplicateClusters=\(nextCluster - 1)")

private struct Observations {
    let faceCount: Int
    let recognizedText: String
    let textBlockCount: Int
    let labels: [String]
    let documentRectangleDetected: Bool
    let featurePrint: VNFeaturePrintObservation?
}

private func observe(_ image: CGImage) throws -> Observations {
    let face = VNDetectFaceRectanglesRequest()
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .fast
    text.usesLanguageCorrection = false
    text.recognitionLanguages = ["zh-Hans", "en-US"]
    let rectangles = VNDetectRectanglesRequest()
    rectangles.maximumObservations = 3
    rectangles.minimumConfidence = 0.65
    rectangles.minimumSize = 0.45
    let feature = VNGenerateImageFeaturePrintRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    try handler.perform([face, text, rectangles, feature])
    let recognizedText = (text.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
    let labels = classify(with: handler)
    return Observations(
        faceCount: face.results?.count ?? 0,
        recognizedText: recognizedText,
        textBlockCount: text.results?.count ?? 0,
        labels: labels,
        documentRectangleDetected: (rectangles.results ?? []).contains {
            $0.boundingBox.width * $0.boundingBox.height >= 0.58
        },
        featurePrint: feature.results?.first as? VNFeaturePrintObservation
    )
}

private func classify(with handler: VNImageRequestHandler) -> [String] {
    let classification = VNClassifyImageRequest()
    do {
        try handler.perform([classification])
        return (classification.results ?? [])
            .filter { $0.confidence >= 0.65 }
            .sorted { $0.confidence > $1.confidence }
            .prefix(8)
            .map(\.identifier)
    } catch {
        return []
    }
}

private func encodeSanitizedJPEG(image: CGImage, fileName: String) throws -> Data {
    let mutable = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        mutable,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else { throw PreflightError.imageEncodingFailed(fileName) }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.84] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw PreflightError.imageEncodingFailed(fileName) }
    return try stripJPEGMetadata(mutable as Data, fileName: fileName)
}

private func stripJPEGMetadata(_ data: Data, fileName: String) throws -> Data {
    let bytes = [UInt8](data)
    guard bytes.count >= 4, bytes[0] == 0xff, bytes[1] == 0xd8,
          bytes.suffix(2).elementsEqual([0xff, 0xd9]) else {
        throw PreflightError.imageEncodingFailed(fileName)
    }
    var output = Data(bytes.prefix(2))
    var offset = 2
    while offset < bytes.count {
        let markerStart = offset
        guard bytes[offset] == 0xff else { throw PreflightError.imageEncodingFailed(fileName) }
        while offset < bytes.count, bytes[offset] == 0xff { offset += 1 }
        guard offset < bytes.count else { throw PreflightError.imageEncodingFailed(fileName) }
        let marker = bytes[offset]
        offset += 1
        if marker == 0xd9 {
            output.append(contentsOf: bytes[markerStart..<offset])
            return output
        }
        guard marker != 0xd8, marker != 0x00 else { throw PreflightError.imageEncodingFailed(fileName) }
        if marker == 0x01 || (0xd0...0xd7).contains(marker) {
            output.append(contentsOf: bytes[markerStart..<offset])
            continue
        }
        guard offset + 1 < bytes.count else { throw PreflightError.imageEncodingFailed(fileName) }
        let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
        guard length >= 2, offset + length <= bytes.count else { throw PreflightError.imageEncodingFailed(fileName) }
        let segmentEnd = offset + length
        if marker == 0xda {
            output.append(contentsOf: bytes[markerStart..<segmentEnd])
            output.append(contentsOf: bytes[segmentEnd..<bytes.count])
            return output
        }
        if !(0xe0...0xef).contains(marker), marker != 0xfe {
            output.append(contentsOf: bytes[markerStart..<segmentEnd])
        }
        offset = segmentEnd
    }
    throw PreflightError.imageEncodingFailed(fileName)
}

private func grayscaleSample(_ image: CGImage) throws -> [UInt8] {
    var pixels = [UInt8](repeating: 0, count: 64 * 64)
    let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress,
            width: 64,
            height: 64,
            bitsPerComponent: 8,
            bytesPerRow: 64,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return false }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 64))
        return true
    }
    guard rendered else { throw PreflightError.unreadableImage("grayscale sample") }
    return pixels
}

private func qualityScore(_ pixels: [UInt8]) -> Double {
    guard pixels.count == 64 * 64 else { return 0 }
    let mean = pixels.map(Double.init).reduce(0, +) / Double(pixels.count)
    var variance = 0.0
    var localSharpness = [Double]()
    localSharpness.reserveCapacity(62 * 62)
    for y in 1..<63 {
        for x in 1..<63 {
            let index = y * 64 + x
            let value = Double(pixels[index])
            variance += (value - mean) * (value - mean)
            let laplacian = abs(
                value * 4
                    - Double(pixels[index - 1])
                    - Double(pixels[index + 1])
                    - Double(pixels[index - 64])
                    - Double(pixels[index + 64])
            )
            localSharpness.append(laplacian)
        }
    }
    localSharpness.sort(by: >)
    let strongestCount = max(32, localSharpness.count / 20)
    let strongestMean = localSharpness.prefix(strongestCount).reduce(0, +) / Double(strongestCount)
    let sharpness = min(1, max(0, strongestMean / 96))
    let contrast = min(1, max(0, sqrt(variance / Double(pixels.count)) / 64))
    return min(1, max(0, sharpness * 0.8 + contrast * 0.2))
}

private func averageHash(_ pixels: [UInt8]) -> UInt64 {
    var downsampled = [Double](repeating: 0, count: 64)
    for y in 0..<8 {
        for x in 0..<8 {
            var total = 0.0
            for dy in 0..<8 {
                for dx in 0..<8 { total += Double(pixels[(y * 8 + dy) * 64 + x * 8 + dx]) }
            }
            downsampled[y * 8 + x] = total / 64
        }
    }
    let mean = downsampled.reduce(0, +) / 64
    return downsampled.enumerated().reduce(into: UInt64(0)) { hash, entry in
        if entry.element >= mean { hash |= UInt64(1) << UInt64(entry.offset) }
    }
}

private func sensitiveFlags(
    faceDetected: Bool,
    recognizedText: String,
    textBlockCount: Int,
    labels: [String]
) -> Set<String> {
    let normalized = recognizedText.precomposedStringWithCompatibilityMapping
    let compact = normalized.filter { !$0.isWhitespace }
    let identifierSeparators = Set("-－‐‑‒–—―·•・")
    let identifierText = compact.filter { !identifierSeparators.contains($0) }
    var flags = Set<String>()
    if faceDetected { flags.insert("face") }
    if compact.count >= 80 || textBlockCount >= 10 { flags.insert("high_text_density") }
    if compact.count >= 160 { flags.insert("document") }
    let identityExplicitMarkers = ["居民身份证", "公民身份号码", "身份证号"]
    let identityMarkers = ["姓名", "性别", "民族", "出生", "住址", "公民身份号码", "签发机关", "有效期限"]
    let identityMarkerCount = identityMarkers.filter { compact.localizedCaseInsensitiveContains($0) }.count
    if identifierText.range(of: #"(?<!\d)\d{17}[0-9Xx](?!\d)"#, options: .regularExpression) != nil ||
        identityExplicitMarkers.contains(where: compact.localizedCaseInsensitiveContains) || identityMarkerCount >= 3 {
        flags.insert("id_card")
    }
    let bankMarkers = ["银联", "银行卡", "信用卡", "银行", "DEBIT", "CREDIT", "VISA", "MASTERCARD", "MASTER CARD", "AMERICAN EXPRESS", "AMEX"]
    let bankNumber = identifierText.range(of: #"(?<!\d)\d{13,19}(?!\d)"#, options: .regularExpression) != nil
    let groupedNumber = normalized.range(
        of: #"(?<!\d)\d{4}[\s\-－‐‑‒–—―·•・]+\d{4}[\s\-－‐‑‒–—―·•・]+\d{4}[\s\-－‐‑‒–—―·•・]+\d{4}(?!\d)"#,
        options: .regularExpression
    ) != nil
    if (bankMarkers.contains(where: compact.localizedCaseInsensitiveContains) && bankNumber) || groupedNumber {
        flags.insert("bank_card")
    }
    if ["发票", "收据", "小票", "invoice", "receipt"].contains(where: compact.localizedCaseInsensitiveContains) {
        flags.insert("receipt")
    }
    if labels.contains(where: { humanLabels.contains($0.lowercased()) }) {
        flags.insert("person")
    }
    return flags
}

private func rounded(_ value: Double) -> Double { (value * 10_000).rounded() / 10_000 }
private func rounded(_ value: Float) -> Float { (value * 10_000).rounded() / 10_000 }

private func photoNumber(_ fileName: String) -> Int? {
    guard fileName.range(of: #"^R000\d{4}\.JPG$"#, options: [.regularExpression, .caseInsensitive]) != nil else {
        return nil
    }
    return Int(fileName.dropFirst(4).prefix(4))
}
