import CoreGraphics
import Foundation
import UIKit
@preconcurrency import Vision

struct PrivacyAnalysis: Sendable {
    let perceptualHash: UInt64
    let qualityScore: Double
    let labels: [String]
    let sensitiveFlags: Set<String>
}

struct PrivacyVisionObservations: Sendable {
    let faceDetected: Bool
    let humanDetected: Bool
    let recognizedText: String
    let textBlockCount: Int
    let labels: [String]
    let documentRectangleDetected: Bool

    #if DEBUG
    static let authorizedFixtureSafe = PrivacyVisionObservations(
        faceDetected: false,
        humanDetected: false,
        recognizedText: "",
        textBlockCount: 0,
        labels: [],
        documentRectangleDetected: false
    )
    #endif
}

actor PhotoPrivacyAnalyzer {
    private let observationProvider: @Sendable (CGImage) throws -> PrivacyVisionObservations

    init() {
        observationProvider = Self.observe
    }

    #if DEBUG
    init(testingObservations: PrivacyVisionObservations) {
        observationProvider = { _ in testingObservations }
    }

    init(testingObservationProvider: @escaping @Sendable (CGImage) throws -> PrivacyVisionObservations) {
        observationProvider = testingObservationProvider
    }
    #endif

    func analyze(jpeg: Data, initialFlags: Set<String> = []) throws -> PrivacyAnalysis {
        guard let image = UIImage(data: jpeg)?.cgImage else { throw ProductError.photoUnavailable }
        let observations: PrivacyVisionObservations
        do {
            try Task.checkCancellation()
            observations = try observationProvider(image)
            try Task.checkCancellation()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // A failed mandatory on-device check must remain retryable and
            // must not be presented as a network/provider failure or uploaded.
            throw ProductError.localPhotoAnalysisUnavailable
        }
        var flags = initialFlags
        flags.formUnion(Self.sensitiveFlags(
            faceDetected: observations.faceDetected,
            humanDetected: observations.humanDetected,
            recognizedText: observations.recognizedText,
            textBlockCount: observations.textBlockCount,
            labels: observations.labels
        ))
        if observations.documentRectangleDetected &&
            observations.recognizedText.filter({ !$0.isWhitespace }).count >= 60 {
            flags.insert("document")
        }
        let sample = try Self.grayscaleSample(image)
        let quality = Self.qualityScore(sample)
        if quality < Self.minimumUsableQualityScore { flags.insert("blurred") }
        return PrivacyAnalysis(
            perceptualHash: Self.averageHash(sample),
            qualityScore: quality,
            labels: observations.labels,
            sensitiveFlags: flags
        )
    }

    private static func observe(_ image: CGImage) throws -> PrivacyVisionObservations {
        let face = VNDetectFaceRectanglesRequest()
        let human = VNDetectHumanRectanglesRequest()
        human.upperBodyOnly = false
        let text = VNRecognizeTextRequest()
        text.recognitionLevel = .fast
        text.usesLanguageCorrection = false
        text.recognitionLanguages = ["zh-Hans", "en-US"]
        let rectangles = VNDetectRectanglesRequest()
        rectangles.maximumObservations = 3
        rectangles.minimumConfidence = 0.65
        rectangles.minimumSize = 0.45
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try performPrivacyRequests([face, human, text, rectangles], with: handler)
        let segmentation = VNGeneratePersonSegmentationRequest()
        segmentation.qualityLevel = .balanced
        segmentation.outputPixelFormat = kCVPixelFormatType_OneComponent8
        // Person segmentation is part of the privacy boundary, not an optional
        // ranking signal. If Vision cannot complete it, fail closed so the
        // photo never reaches a model merely because the local check failed.
        try performPrivacyRequests([segmentation], with: handler)
        let segmentedPersonDetected = Self.hasVisiblePerson(in: segmentation.results?.first?.pixelBuffer)

        let recognizedText = (text.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
        // Classification improves ranking, but is not a privacy boundary. Some
        // simulator and device configurations cannot create the optional model
        // context; face, text and document checks must still run and fail closed.
        let labels = Self.classify(with: handler)
        return PrivacyVisionObservations(
            faceDetected: !(face.results ?? []).isEmpty,
            humanDetected: !(human.results ?? []).isEmpty || segmentedPersonDetected,
            recognizedText: recognizedText,
            textBlockCount: text.results?.count ?? 0,
            labels: labels,
            documentRectangleDetected: (rectangles.results ?? []).contains {
                $0.boundingBox.width * $0.boundingBox.height >= 0.58
            }
        )
    }

    private static func performPrivacyRequests(_ requests: [VNRequest], with handler: VNImageRequestHandler) throws {
        #if targetEnvironment(simulator)
        // The simulator advertises a GPU even when these Vision models cannot
        // create its inference context. Run the same mandatory checks on a
        // supported CPU; never substitute observations or relax privacy rules.
        // Physical devices retain Vision's automatic hardware selection.
        for request in requests {
            for (stage, devices) in try request.supportedComputeStageDevices {
                if let cpu = devices.first(where: { if case .cpu = $0 { true } else { false } }) {
                    request.setComputeDevice(cpu, for: stage)
                }
            }
        }
        #endif
        try handler.perform(requests)
    }

    private static func classify(with handler: VNImageRequestHandler) -> [String] {
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

    private static func hasVisiblePerson(in mask: CVPixelBuffer?) -> Bool {
        guard let mask else { return false }
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(mask) else { return false }
        let width = CVPixelBufferGetWidth(mask)
        let height = CVPixelBufferGetHeight(mask)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
        guard width > 0, height > 0, bytesPerRow >= width else { return false }
        let pixels = baseAddress.assumingMemoryBound(to: UInt8.self)
        var foreground = 0
        var sampled = 0
        for y in stride(from: 0, to: height, by: 2) {
            for x in stride(from: 0, to: width, by: 2) {
                sampled += 1
                if pixels[y * bytesPerRow + x] >= 128 { foreground += 1 }
            }
        }
        return sampled > 0 && Double(foreground) / Double(sampled) >= 0.002
    }

    static func sensitiveFlags(
        faceDetected: Bool,
        humanDetected: Bool = false,
        recognizedText: String,
        textBlockCount: Int,
        labels: [String]
    ) -> Set<String> {
        let normalized = recognizedText.precomposedStringWithCompatibilityMapping
        let compact = normalized.filter { !$0.isWhitespace }
        let identifierText = compact.filter { !identifierSeparators.contains($0) }
        var flags = Set<String>()
        let characterCount = compact.count
        if faceDetected { flags.insert("face") }
        if humanDetected { flags.insert("person") }
        if characterCount >= 80 || textBlockCount >= 10 { flags.insert("high_text_density") }
        if characterCount >= 160 { flags.insert("document") }

        let identityMarkerCount = identityMarkers.filter { compact.localizedCaseInsensitiveContains($0) }.count
        if identifierText.range(of: "(?<!\\d)\\d{17}[0-9Xx](?!\\d)", options: .regularExpression) != nil ||
            identityExplicitMarkers.contains(where: compact.localizedCaseInsensitiveContains) ||
            identityMarkerCount >= 3 {
            flags.insert("id_card")
        }
        let bankMarker = bankMarkers.contains(where: compact.localizedCaseInsensitiveContains)
        let bankNumber = identifierText.range(of: "(?<!\\d)\\d{13,19}(?!\\d)", options: .regularExpression) != nil
        let groupedNumber = normalized.range(
            of: "(?<!\\d)\\d{4}[\\s\\-－‐‑‒–—―·•・]+\\d{4}[\\s\\-－‐‑‒–—―·•・]+\\d{4}[\\s\\-－‐‑‒–—―·•・]+\\d{4}(?!\\d)",
            options: .regularExpression
        ) != nil
        if (bankMarker && bankNumber) || groupedNumber { flags.insert("bank_card") }
        if receiptMarkers.contains(where: compact.localizedCaseInsensitiveContains) { flags.insert("receipt") }
        if labels.contains(where: { humanLabels.contains($0.lowercased()) }) {
            flags.insert("person")
        }
        return flags
    }

    private static func grayscaleSample(_ image: CGImage) throws -> [UInt8] {
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
        guard rendered else { throw ProductError.photoUnavailable }
        return pixels
    }

    static let minimumUsableQualityScore = 0.35

    static func qualityScore(_ pixels: [UInt8]) -> Double {
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

    private static func averageHash(_ pixels: [UInt8]) -> UInt64 {
        var downsampled = [Double](repeating: 0, count: 64)
        for y in 0..<8 {
            for x in 0..<8 {
                var total = 0.0
                for dy in 0..<8 { for dx in 0..<8 { total += Double(pixels[(y * 8 + dy) * 64 + x * 8 + dx]) } }
                downsampled[y * 8 + x] = total / 64
            }
        }
        let mean = downsampled.reduce(0, +) / 64
        return downsampled.enumerated().reduce(into: UInt64(0)) { hash, entry in
            if entry.element >= mean { hash |= UInt64(1) << UInt64(entry.offset) }
        }
    }

    private static let identifierSeparators = Set("-－‐‑‒–—―·•・")
    private static let identityExplicitMarkers = ["居民身份证", "公民身份号码", "身份证号"]
    private static let identityMarkers = ["姓名", "性别", "民族", "出生", "住址", "公民身份号码", "签发机关", "有效期限"]
    private static let bankMarkers = ["银联", "银行卡", "信用卡", "银行", "DEBIT", "CREDIT", "VISA", "MASTERCARD", "MASTER CARD", "AMERICAN EXPRESS", "AMEX"]
    private static let receiptMarkers = ["发票", "收据", "小票", "invoice", "receipt"]
    private static let humanLabels: Set<String> = [
        "person", "people", "human", "selfie", "portrait", "adult", "child", "baby",
        "man", "woman", "boy", "girl"
    ]
}
