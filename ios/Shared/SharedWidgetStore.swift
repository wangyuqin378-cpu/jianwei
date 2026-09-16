import CryptoKit
import Darwin
import Foundation

enum SharedWidgetStoreError: Error {
    case appGroupUnavailable
    case lockUnavailable
}

struct SharedWidgetStore: Sendable {
    static let maximumThumbnailSide = 800
    // Bump the recipe when encoding quality or metadata handling changes.
    static let thumbnailRenditionVersion = "jpeg-\(maximumThumbnailSide)-q84-metadata-free-v1"
    private let baseURL: URL

    init(baseURL: URL? = nil) throws {
        if let baseURL {
            self.baseURL = baseURL
        } else if let groupURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SharedConstants.appGroupIdentifier
        ) {
            self.baseURL = groupURL
        } else {
            throw SharedWidgetStoreError.appGroupUnavailable
        }
    }

    var thumbnailDirectoryURL: URL {
        baseURL.appendingPathComponent(SharedConstants.thumbnailDirectory, isDirectory: true)
    }

    func load() throws -> WidgetQueueState {
        try withLock {
            try loadWithoutLock()
        }
    }

    func prepareThumbnail(
        source: Data, candidateToken: UUID, previousReceipt: WidgetThumbnailReceipt?,
        render: (Data) throws -> Data
    ) throws -> (data: Data, receipt: WidgetThumbnailReceipt) {
        let sourceDigest = Self.digest(source)
        // No decoding/encoding or hashing under the widget's cross-process
        // lock. Files are atomically replaced; verify both ends so a stale
        // receipt, changed source or damaged shared image cannot produce a hit.
        if let previousReceipt,
           previousReceipt.renditionVersion == Self.thumbnailRenditionVersion,
           previousReceipt.sourceDigest == sourceDigest,
           let cached = try? Data(contentsOf: thumbnailURL(for: candidateToken)),
           previousReceipt.thumbnailDigest == Self.digest(cached) {
            return (cached, previousReceipt)
        }
        let data = try render(source)
        return (data, WidgetThumbnailReceipt(
            sourceDigest: sourceDigest, thumbnailDigest: Self.digest(data),
            renditionVersion: Self.thumbnailRenditionVersion
        ))
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    @discardableResult
    func replaceCards(
        _ cards: [WidgetCardSnapshot], thumbnails: [UUID: Data],
        thumbnailReceipts: [UUID: WidgetThumbnailReceipt] = [:],
        preservingPresentationsFor retainedCardIDs: Set<UUID> = []
    ) throws -> Bool {
        let verifiedReceipts = thumbnailReceipts.filter { token, receipt in
            guard let data = thumbnails[token] else { return false }
            return receipt.renditionVersion == Self.thumbnailRenditionVersion &&
                receipt.thumbnailDigest == Self.digest(data)
        }
        return try withLock {
            var state = try loadWithoutLock()
            // A widget can surface yesterday's runner-up while the app is
            // preparing today's narrower cache. Validate under the same lock
            // as swaps, before touching either the state or its thumbnails.
            let presentedIDs = Set(state.presentations.map(\.cardID)).intersection(retainedCardIDs)
            guard presentedIDs.isSubset(of: Set(cards.map(\.id))) else { return false }
            try FileManager.default.createDirectory(
                at: thumbnailDirectoryURL,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            var previousThumbnails: [UUID: Data?] = [:]
            do {
                for (candidateToken, data) in thumbnails {
                    let target = thumbnailURL(for: candidateToken)
                    let previous = FileManager.default.fileExists(atPath: target.path)
                        ? try Data(contentsOf: target)
                        : nil
                    // Foreground and background projection retries include
                    // history too. Do not rewrite unchanged images while holding
                    // the cross-process lock needed by the widget.
                    guard previous != data else { continue }
                    // Preserve an explicit missing-file rollback entry for a
                    // new image; assigning an outer nil would remove the entry.
                    previousThumbnails[candidateToken] = .some(previous)
                    try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                }
                state.mergeCards(cards)
                let retainedCandidates = Set(cards.map(\.candidateToken))
                for token in thumbnails.keys where retainedCandidates.contains(token) {
                    if let receipt = verifiedReceipts[token] {
                        state.thumbnailReceipts[token] = receipt
                    } else {
                        // Legacy callers may replace an image without a receipt.
                        state.thumbnailReceipts.removeValue(forKey: token)
                    }
                }
                try writeWithoutLock(state)
            } catch {
                // A failed projection must not retain a newly copied private
                // thumbnail that the shared state never accepted.
                for (candidateToken, previous) in previousThumbnails {
                    let target = thumbnailURL(for: candidateToken)
                    if let previous {
                        try? previous.write(
                            to: target,
                            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                        )
                    } else if FileManager.default.fileExists(atPath: target.path) {
                        try? FileManager.default.removeItem(at: target)
                    }
                }
                throw error
            }
            // State now references the new images. A cleanup error must still
            // surface for retry, but cannot roll those committed images back.
            try removeOrphanedThumbnails(keeping: Set(cards.map(\.candidateToken)))
            return true
        }
    }

    func clear() throws {
        try withLock {
            let stateURL = baseURL.appendingPathComponent(SharedConstants.widgetStateFilename)
            if FileManager.default.fileExists(atPath: stateURL.path) {
                try FileManager.default.removeItem(at: stateURL)
            }
            if FileManager.default.fileExists(atPath: thumbnailDirectoryURL.path) {
                try FileManager.default.removeItem(at: thumbnailDirectoryURL)
            }
        }
    }

    @discardableResult
    func advance(on day: String, now: Date = Date()) throws -> WidgetAdvanceResult {
        try withLock {
            var state = try loadWithoutLock()
            let result = state.advance(on: day, now: now)
            if case .advanced = result { try writeWithoutLock(state) }
            return result
        }
    }

    @discardableResult
    func activate(cardID: UUID, on day: String, now: Date = Date()) throws -> Bool {
        try withLock {
            var state = try loadWithoutLock()
            let changed = state.activate(cardID: cardID, on: day, now: now)
            if changed { try writeWithoutLock(state) }
            return changed
        }
    }

    @discardableResult
    func undo(on day: String, now: Date = Date()) throws -> Bool {
        try withLock {
            var state = try loadWithoutLock()
            let changed = state.undo(on: day, now: now)
            if changed { try writeWithoutLock(state) }
            return changed
        }
    }

    func thumbnailURL(for candidateToken: UUID) -> URL {
        thumbnailDirectoryURL.appendingPathComponent(candidateToken.uuidString.lowercased() + ".jpg")
    }

    private func loadWithoutLock() throws -> WidgetQueueState {
        let url = baseURL.appendingPathComponent(SharedConstants.widgetStateFilename)
        guard FileManager.default.fileExists(atPath: url.path) else { return .empty }
        let data = try Data(contentsOf: url)
        // An atomic write makes corruption unlikely, but a downgraded Beta or
        // interrupted migration must not permanently brick history and swaps.
        // Returning an empty queue lets the next repository synchronization
        // rebuild the shared projection and overwrite the unreadable file.
        return (try? Self.decoder().decode(WidgetQueueState.self, from: data)) ?? .empty
    }

    private func writeWithoutLock(_ state: WidgetQueueState) throws {
        try FileManager.default.createDirectory(
            at: baseURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let data = try Self.encoder().encode(state)
        try data.write(
            to: baseURL.appendingPathComponent(SharedConstants.widgetStateFilename),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    private func removeOrphanedThumbnails(keeping candidateTokens: Set<UUID>) throws {
        guard FileManager.default.fileExists(atPath: thumbnailDirectoryURL.path) else { return }
        let files = try FileManager.default.contentsOfDirectory(
            at: thumbnailDirectoryURL,
            includingPropertiesForKeys: nil
        )
        let names = Set(candidateTokens.map { $0.uuidString.lowercased() + ".jpg" })
        for file in files where !names.contains(file.lastPathComponent) {
            try FileManager.default.removeItem(at: file)
        }
    }

    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: baseURL, withIntermediateDirectories: true)
        let lockURL = baseURL.appendingPathComponent(SharedConstants.widgetLockFilename)
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw SharedWidgetStoreError.lockUnavailable }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw SharedWidgetStoreError.lockUnavailable }
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
