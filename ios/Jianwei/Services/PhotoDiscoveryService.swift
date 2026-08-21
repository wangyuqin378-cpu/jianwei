import Foundation
@preconcurrency import Photos

enum PhotoAccessState: String, Sendable {
    case full
    case limited
    case denied
    case notDetermined
}

struct PhotoAssetReference: Hashable, Sendable {
    let localIdentifier: String
    let capturedAt: Date?
    let modifiedAt: Date?
    let isScreenshot: Bool
}

actor PhotoDiscoveryService {
    private let imageManager = PHImageManager.default()

    func authorizationState() -> PhotoAccessState {
        Self.map(PHPhotoLibrary.authorizationStatus(for: .readWrite))
    }

    func requestAccess() async -> PhotoAccessState {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return Self.map(status)
    }

    func recentAssets(days: Int = 90, limit: Int = 500) throws -> [PhotoAssetReference] {
        let state = authorizationState()
        guard state == .full || state == .limited else { throw ProductError.permissionDenied }
        let options = PHFetchOptions()
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        options.predicate = NSPredicate(format: "mediaType == %d AND creationDate >= %@", PHAssetMediaType.image.rawValue, cutoff as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = limit
        let result = PHAsset.fetchAssets(with: options)
        var references: [PhotoAssetReference] = []
        result.enumerateObjects { asset, _, _ in
            references.append(PhotoAssetReference(
                localIdentifier: asset.localIdentifier,
                capturedAt: asset.creationDate,
                modifiedAt: asset.modificationDate,
                isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot)
            ))
        }
        return references
    }

    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [reference.localIdentifier], options: nil)
        guard let asset = result.firstObject else { throw ProductError.photoUnavailable }
        return try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .none
            options.isNetworkAccessAllowed = true
            options.isSynchronous = false
            imageManager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                    continuation.resume(throwing: CancellationError())
                } else if let error = info?[PHImageErrorKey] as? Error {
                    continuation.resume(throwing: error)
                } else if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: ProductError.photoUnavailable)
                }
            }
        }
    }

    private static func map(_ status: PHAuthorizationStatus) -> PhotoAccessState {
        switch status {
        case .authorized: .full
        case .limited: .limited
        case .denied, .restricted: .denied
        case .notDetermined: .notDetermined
        @unknown default: .denied
        }
    }
}
