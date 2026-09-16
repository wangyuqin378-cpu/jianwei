import Foundation
import ImageIO
import UIKit

struct SanitizedImage: Sendable {
    let jpeg: Data
    let pixelSize: CGSize
}

struct ImageSanitizer: Sendable {
    func sanitize(_ sourceData: Data, maximumSide: CGFloat = 1280) throws -> SanitizedImage {
        guard maximumSide > 0,
              let source = CGImageSourceCreateWithData(
                sourceData as CFData,
                [kCGImageSourceShouldCache: false] as CFDictionary
              ),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let rawWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let rawHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber,
              rawWidth.doubleValue > 0,
              rawHeight.doubleValue > 0 else {
            throw ProductError.photoUnavailable
        }

        // ImageIO creates the thumbnail while decoding. UIImage(data:) would
        // first materialize the full-resolution photo, which can terminate the
        // app on very large panoramas before the 1280 px resize is reached.
        let sourceMaximumSide = max(rawWidth.doubleValue, rawHeight.doubleValue)
        let thumbnailMaximumSide = max(1, min(Double(maximumSide), sourceMaximumSide))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(ceil(thumbnailMaximumSide)),
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw ProductError.photoUnavailable
        }
        let target = CGSize(width: thumbnail.width, height: thumbnail.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let normalized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            UIColor.black.setFill()
            UIRectFill(CGRect(origin: .zero, size: target))
            UIImage(cgImage: thumbnail).draw(in: CGRect(origin: .zero, size: target))
        }
        guard let encoded = normalized.jpegData(compressionQuality: 0.84) else {
            throw ProductError.photoUnavailable
        }
        let stripped = try JPEGMetadataStripper.strip(encoded)
        try JPEGMetadataStripper.requireNoMetadata(stripped)
        return SanitizedImage(jpeg: stripped, pixelSize: target)
    }
}

enum JPEGMetadataStripper {
    static func strip(_ data: Data) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count >= 4, bytes[0] == 0xff, bytes[1] == 0xd8,
              bytes[bytes.count - 2] == 0xff, bytes[bytes.count - 1] == 0xd9 else {
            throw ProductError.photoUnavailable
        }
        var output = Data(bytes.prefix(2))
        var offset = 2
        while offset < bytes.count {
            let markerStart = offset
            guard bytes[offset] == 0xff else { throw ProductError.photoUnavailable }
            while offset < bytes.count, bytes[offset] == 0xff { offset += 1 }
            guard offset < bytes.count else { throw ProductError.photoUnavailable }
            let marker = bytes[offset]
            offset += 1
            if marker == 0xd9 {
                guard offset == bytes.count else { throw ProductError.photoUnavailable }
                output.append(contentsOf: bytes[markerStart..<offset])
                return output
            }
            guard marker != 0xd8, marker != 0x00 else { throw ProductError.photoUnavailable }
            if marker == 0x01 || (0xd0...0xd7).contains(marker) {
                output.append(contentsOf: bytes[markerStart..<offset])
                continue
            }
            guard offset + 1 < bytes.count else { throw ProductError.photoUnavailable }
            let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
            guard length >= 2, offset + length <= bytes.count else { throw ProductError.photoUnavailable }
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
        throw ProductError.photoUnavailable
    }

    static func requireNoMetadata(_ data: Data) throws {
        let bytes = [UInt8](data)
        guard bytes.count >= 4, bytes[0] == 0xff, bytes[1] == 0xd8,
              bytes.suffix(2).elementsEqual([0xff, 0xd9]) else { throw ProductError.photoUnavailable }
        var offset = 2
        while offset < bytes.count {
            guard bytes[offset] == 0xff else { throw ProductError.photoUnavailable }
            while offset < bytes.count, bytes[offset] == 0xff { offset += 1 }
            guard offset < bytes.count else { throw ProductError.photoUnavailable }
            let marker = bytes[offset]
            offset += 1
            if marker == 0xd9 { return }
            guard marker != 0xd8, marker != 0x00 else { throw ProductError.photoUnavailable }
            if marker == 0x01 || (0xd0...0xd7).contains(marker) { continue }
            guard offset + 1 < bytes.count else { throw ProductError.photoUnavailable }
            let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
            guard length >= 2, offset + length <= bytes.count else { throw ProductError.photoUnavailable }
            if (0xe0...0xef).contains(marker) || marker == 0xfe { throw ProductError.photoUnavailable }
            if marker == 0xda { return }
            offset += length
        }
        throw ProductError.photoUnavailable
    }
}
