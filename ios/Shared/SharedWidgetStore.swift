import Darwin
import Foundation

enum SharedWidgetStoreError: Error {
    case appGroupUnavailable
    case lockUnavailable
}

struct SharedWidgetStore: Sendable {
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
            let url = baseURL.appendingPathComponent(SharedConstants.widgetStateFilename)
            guard FileManager.default.fileExists(atPath: url.path) else { return .empty }
            return try Self.decoder().decode(WidgetQueueState.self, from: Data(contentsOf: url))
        }
    }

    func replaceCards(_ cards: [WidgetCardSnapshot], thumbnails: [UUID: Data]) throws {
        try withLock {
            try FileManager.default.createDirectory(
                at: thumbnailDirectoryURL,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            for (candidateToken, data) in thumbnails {
                let target = thumbnailURL(for: candidateToken)
                try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
            var state = try loadWithoutLock()
            state.mergeCards(cards)
            try writeWithoutLock(state)
            try removeOrphanedThumbnails(keeping: Set(cards.map(\.candidateToken)))
        }
    }

    @discardableResult
    func advance(on day: String) throws -> Bool {
        try withLock {
            var state = try loadWithoutLock()
            let changed = state.advance(on: day)
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
        return try Self.decoder().decode(WidgetQueueState.self, from: Data(contentsOf: url))
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
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: thumbnailDirectoryURL,
            includingPropertiesForKeys: nil
        ) else { return }
        let names = Set(candidateTokens.map { $0.uuidString.lowercased() + ".jpg" })
        for file in files where !names.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
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
