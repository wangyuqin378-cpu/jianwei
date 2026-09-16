#!/usr/bin/env swift

import AppKit
import CoreImage
import Foundation

enum ControlError: Error, CustomStringConvertible {
    case usage
    case unreadable(String)
    case renderFailed(String)

    var description: String {
        switch self {
        case .usage:
            return "usage: swift build-blurred-quality-controls.swift --source-dir DIR --output-dir DIR [--radius 18]"
        case .unreadable(let file):
            return "could not read \(file)"
        case .renderFailed(let file):
            return "could not render \(file)"
        }
    }
}

func option(_ name: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
    return arguments[index + 1]
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard
        let sourcePath = option("--source-dir", in: arguments),
        let outputPath = option("--output-dir", in: arguments)
    else { throw ControlError.usage }
    let radius = Double(option("--radius", in: arguments) ?? "18") ?? 18
    let fileManager = FileManager.default
    let sourceURL = URL(fileURLWithPath: sourcePath, isDirectory: true)
    let outputURL = URL(fileURLWithPath: outputPath, isDirectory: true)
    try fileManager.createDirectory(at: outputURL, withIntermediateDirectories: true)
    let files = try fileManager.contentsOfDirectory(
        at: sourceURL,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    ).filter { ["jpg", "jpeg"].contains($0.pathExtension.lowercased()) }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    let context = CIContext(options: [.useSoftwareRenderer: false])

    for source in files {
        guard let image = CIImage(contentsOf: source) else { throw ControlError.unreadable(source.path) }
        let blurred = image
            .clampedToExtent()
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: radius])
            .cropped(to: image.extent)
        guard let cgImage = context.createCGImage(blurred, from: image.extent) else {
            throw ControlError.renderFailed(source.path)
        }
        let bitmap = NSBitmapImageRep(cgImage: cgImage)
        guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.88]) else {
            throw ControlError.renderFailed(source.path)
        }
        try jpeg.write(to: outputURL.appendingPathComponent(source.lastPathComponent), options: .atomic)
    }
    print("BLURRED_CONTROLS=PASS photos=\(files.count) radius=\(radius)")
} catch {
    FileHandle.standardError.write(Data("BLURRED_CONTROLS=FAIL \(error)\n".utf8))
    exit(1)
}
