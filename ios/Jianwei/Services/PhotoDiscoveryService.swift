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

#if DEBUG
struct PhotoLibraryQuerySummary: Sendable {
    let genericRecentCount: Int
    let typedRecentCount: Int
    let visibleImageCountUpToLimit: Int
    let newestCapturedAt: Date?
    let newestModifiedAt: Date?
    let newestIsScreenshot: Bool
}
#endif

protocol AutomaticPhotoSource: Sendable {
    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference]
    func imageData(for reference: PhotoAssetReference) async throws -> Data
}

actor PhotoDiscoveryService: AutomaticPhotoSource {
    private let imageManager: PHImageManager
    private let imageRequestTimeout: TimeInterval

    init(imageManager: PHImageManager = .default(), imageRequestTimeout: TimeInterval = 20) {
        self.imageManager = imageManager
        self.imageRequestTimeout = imageRequestTimeout
    }

    func authorizationState() -> PhotoAccessState {
        Self.map(PHPhotoLibrary.authorizationStatus(for: .readWrite))
    }

    func requestAccess() async -> PhotoAccessState {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return Self.map(status)
    }

    func recentAssets(
        days: Int = 90, limit: Int = 500, excludingLocalIdentifiers excluded: Set<String> = []
    ) throws -> [PhotoAssetReference] {
        try Task.checkCancellation()
        guard limit > 0 else { return [] }
        let state = authorizationState()
        guard state == .full || state == .limited else { throw ProductError.permissionDenied }
        // The limit is for unseen candidates, not the first page of the album.
        // At most `excluded.count` metadata rows can be skipped. PhotoKit loads
        // these lazily; no image bytes are requested during this query.
        let (expandedLimit, overflow) = limit.addingReportingOverflow(excluded.count)
        let fetchLimit = overflow ? Int.max : expandedLimit
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        let recentOptions = PHFetchOptions()
        recentOptions.predicate = NSPredicate(format: "creationDate >= %@", cutoff as NSDate)
        recentOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        recentOptions.fetchLimit = fetchLimit
        let recent = try Self.references(from: PHAsset.fetchAssets(with: .image, options: recentOptions),
                                         limit: limit, excluding: excluded)

        guard recent.count < limit else { return recent }
        let fallbackOptions = PHFetchOptions()
        fallbackOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        fallbackOptions.fetchLimit = fetchLimit
        let fallback = try Self.references(from: PHAsset.fetchAssets(with: .image, options: fallbackOptions),
                                           limit: limit - recent.count,
                                           excluding: excluded.union(recent.map(\.localIdentifier)))
        return Self.prioritizedReferences(recent: recent, fallback: fallback, limit: limit)
    }

    static func prioritizedReferences(
        recent: [PhotoAssetReference],
        fallback: [PhotoAssetReference],
        limit: Int
    ) -> [PhotoAssetReference] {
        guard limit > 0 else { return [] }
        var seen = Set<String>()
        return (recent + fallback).compactMap { reference in
            guard seen.insert(reference.localIdentifier).inserted else { return nil }
            return reference
        }.prefix(limit).map { $0 }
    }

    #if DEBUG
    func debugQuerySummary(days: Int = 90, limit: Int = 500) throws -> PhotoLibraryQuerySummary {
        let state = authorizationState()
        guard state == .full || state == .limited else { throw ProductError.permissionDenied }
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date())!

        let genericOptions = PHFetchOptions()
        genericOptions.predicate = NSPredicate(
            format: "mediaType == %d AND creationDate >= %@",
            PHAssetMediaType.image.rawValue,
            cutoff as NSDate
        )
        genericOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        genericOptions.fetchLimit = limit
        let genericRecent = PHAsset.fetchAssets(with: genericOptions)

        let typedOptions = PHFetchOptions()
        typedOptions.predicate = NSPredicate(format: "creationDate >= %@", cutoff as NSDate)
        typedOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        typedOptions.fetchLimit = limit
        let typedRecent = PHAsset.fetchAssets(with: .image, options: typedOptions)

        let allOptions = PHFetchOptions()
        allOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        allOptions.fetchLimit = limit
        let visibleImages = PHAsset.fetchAssets(with: .image, options: allOptions)
        let newest = visibleImages.firstObject

        return PhotoLibraryQuerySummary(
            genericRecentCount: genericRecent.count,
            typedRecentCount: typedRecent.count,
            visibleImageCountUpToLimit: visibleImages.count,
            newestCapturedAt: newest?.creationDate,
            newestModifiedAt: newest?.modificationDate,
            newestIsScreenshot: newest?.mediaSubtypes.contains(.photoScreenshot) ?? false
        )
    }
    #endif

    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        try Task.checkCancellation()
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [reference.localIdentifier], options: nil)
        guard let asset = result.firstObject else { throw ProductError.photoUnavailable }
        return try await imageData(for: asset)
    }

    func imageData(for asset: PHAsset) async throws -> Data {
        try Task.checkCancellation()
        let request = PhotoImageDataRequest(manager: imageManager)
        let data = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard request.install(continuation, timeout: imageRequestTimeout) else { return }
                let options = PHImageRequestOptions()
                options.deliveryMode = .highQualityFormat
                options.resizeMode = .none
                options.isNetworkAccessAllowed = true
                options.isSynchronous = false
                let id = imageManager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                    if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                        request.finish(.failure(CancellationError()))
                    } else if let error = info?[PHImageErrorKey] as? Error {
                        let nsError = error as NSError
                        request.finish(.failure(nsError.domain == NSURLErrorDomain && nsError.code == URLError.timedOut.rawValue
                            ? ProductError.photoReadTimedOut : error))
                    } else if let data {
                        request.finish(.success(data))
                    } else {
                        request.finish(.failure(ProductError.photoUnavailable))
                    }
                }
                request.register(id)
            }
        } onCancel: {
            request.finish(.failure(CancellationError()), cancelUnderlying: true)
        }
        try Task.checkCancellation()
        return data
    }

    private static func references(
        from result: PHFetchResult<PHAsset>, limit: Int, excluding: Set<String>
    ) throws -> [PhotoAssetReference] {
        try Task.checkCancellation()
        guard limit > 0 else { return [] }
        var references: [PhotoAssetReference] = []
        result.enumerateObjects { asset, _, stop in
            if Task.isCancelled { stop.pointee = true; return }
            guard !excluding.contains(asset.localIdentifier) else { return }
            references.append(PhotoAssetReference(
                localIdentifier: asset.localIdentifier,
                capturedAt: asset.creationDate,
                modifiedAt: asset.modificationDate,
                isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot)
            ))
            if references.count == limit { stop.pointee = true }
        }
        try Task.checkCancellation()
        return references
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

/// PhotoKit need not call its handler after cancellation. Complete the Swift
/// task ourselves, and cancel an ID even if it arrives after cancellation.
/// The lock covers callback/timeout/cancellation races; never invoke Photos or
/// resume a continuation under it (cancelImageRequest can call back inline).
private final class PhotoImageDataRequest: @unchecked Sendable {
    private let lock = NSLock()
    private let manager: PHImageManager
    private var continuation: CheckedContinuation<Data, Error>?
    private var result: Result<Data, Error>?
    private var requestID: PHImageRequestID?
    private var cancelUnderlying = false
    private var deadline: DispatchWorkItem?

    init(manager: PHImageManager) { self.manager = manager }

    func install(_ continuation: CheckedContinuation<Data, Error>, timeout: TimeInterval) -> Bool {
        let deadline = DispatchWorkItem { [weak self] in
            self?.finish(.failure(ProductError.photoReadTimedOut), cancelUnderlying: true)
        }
        let earlyResult = lock.withLock { () -> Result<Data, Error>? in
            if let result { return result }
            self.continuation = continuation
            self.deadline = deadline
            return nil
        }
        if let earlyResult {
            continuation.resume(with: earlyResult)
            return false
        }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: deadline)
        return true
    }

    func register(_ id: PHImageRequestID) {
        let shouldCancel = lock.withLock {
            if cancelUnderlying { return true }
            if result == nil { requestID = id }
            return false
        }
        if shouldCancel { manager.cancelImageRequest(id) }
    }

    func finish(_ result: Result<Data, Error>, cancelUnderlying: Bool = false) {
        let completion = lock.withLock { () -> (CheckedContinuation<Data, Error>?, PHImageRequestID?)? in
            guard self.result == nil else { return nil }
            self.result = result
            self.cancelUnderlying = cancelUnderlying
            let continuation = self.continuation
            self.continuation = nil
            deadline?.cancel()
            deadline = nil
            let id = cancelUnderlying ? requestID : nil
            requestID = nil
            return (continuation, id)
        }
        guard let completion else { return }
        if let id = completion.1 { manager.cancelImageRequest(id) }
        completion.0?.resume(with: result)
    }
}
