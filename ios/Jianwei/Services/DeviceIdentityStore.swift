import Foundation
import Security

actor DeviceIdentityStore {
    private enum Key {
        static let installationID = "installation-id"
        static let deviceID = "device-id"
        static let deviceToken = "device-token"
        static let previousDeviceID = "previous-device-id"
        static let previousDeviceToken = "previous-device-token"
    }

    private static let keychain = KeychainStore(service: "cn.jianwei.ios.identity")
    private static let installationIDLock = NSLock()

    private let api: APIClient
    private let keychain: any SecretStore
    private let recoveryTransaction: @Sendable () async -> String?
    private var registrationTask: (id: UUID, task: Task<Registration, Error>)?
    private var isDeleting = false

    init(api: APIClient, recoveryTransaction: @escaping @Sendable () async -> String? = { nil }) {
        self.api = api
        self.keychain = DeviceIdentityStore.keychain
        self.recoveryTransaction = recoveryTransaction
    }

    init(api: APIClient, keychain: any SecretStore, recoveryTransaction: @escaping @Sendable () async -> String? = { nil }) {
        self.api = api
        self.keychain = keychain
        self.recoveryTransaction = recoveryTransaction
    }

    func installationID() throws -> UUID {
        try Self.installationIDLock.withLock {
            if let stored = try keychain.string(for: Key.installationID).flatMap(UUID.init(uuidString:)) {
                return stored
            }
            let id = UUID()
            try keychain.set(id.uuidString.lowercased(), for: Key.installationID)
            return id
        }
    }

    nonisolated static func installationIDForSubscription() throws -> UUID {
        try installationIDLock.withLock {
            if let stored = try keychain.string(for: Key.installationID).flatMap(UUID.init(uuidString:)) {
                return stored
            }
            let id = UUID()
            try keychain.set(id.uuidString.lowercased(), for: Key.installationID)
            return id
        }
    }

    func credentials() async throws -> Registration {
        guard !isDeleting else { throw CancellationError() }
        if let registrationTask { return try await registrationTask.task.value }
        if let deviceID = try keychain.string(for: Key.deviceID),
           let token = try keychain.string(for: Key.deviceToken) {
            return Registration(deviceID: deviceID, token: token)
        }
        // Share registration so deletion can finish an already-started request
        // before deleting its result, instead of orphaning a late identity.
        let task = Task { try await registerAndStoreCredentials() }
        let registrationID = UUID()
        registrationTask = (registrationID, task)
        defer {
            if registrationTask?.id == registrationID { registrationTask = nil }
        }
        return try await task.value
    }

    private func registerAndStoreCredentials() async throws -> Registration {
        let installationID = try installationID()
        let previousToken = try keychain.string(for: Key.previousDeviceToken)
        let registration: Registration
        do {
            registration = try await api.register(
                installationID: installationID,
                currentBearer: previousToken
            )
        } catch ProductError.serverCredentialExpired {
            // Never rotate the purchase's appAccountToken to fix a lost bearer:
            // it strands an active subscription and orphans cloud deletion.
            // The server verifies the receipt against this SAME installation.
            guard let receipt = await recoveryTransaction() else { throw ProductError.managedIdentityRecoveryRequired }
            try Task.checkCancellation()
            do {
                registration = try await api.register(
                    installationID: installationID,
                    currentBearer: previousToken,
                    appStoreTransaction: receipt
                )
            } catch ProductError.serverCredentialExpired {
                throw ProductError.managedIdentityRecoveryRequired
            }
        }
        try keychain.set(registration.deviceID, for: Key.deviceID)
        try keychain.set(registration.token, for: Key.deviceToken)
        try keychain.remove(Key.previousDeviceID)
        try keychain.remove(Key.previousDeviceToken)
        return registration
    }

    func invalidateServerCredential() throws {
        if let deviceID = try keychain.string(for: Key.deviceID) {
            try keychain.set(deviceID, for: Key.previousDeviceID)
        }
        if let token = try keychain.string(for: Key.deviceToken) {
            try keychain.set(token, for: Key.previousDeviceToken)
        }
        try keychain.remove(Key.deviceID)
        try keychain.remove(Key.deviceToken)
    }

    /// Returns false only when there is no locally retained cloud credential.
    /// Never creates/re-registers an identity merely to delete it. The purchase
    /// installation UUID and the separately stored provider Key are retained.
    func deleteExistingCloudData() async throws -> Bool {
        guard !isDeleting else { throw CancellationError() }
        isDeleting = true
        defer { isDeleting = false }
        if let registrationTask {
            defer {
                if self.registrationTask?.id == registrationTask.id { self.registrationTask = nil }
            }
            _ = try await registrationTask.task.value
        }
        let deviceID = try keychain.string(for: Key.deviceID) ?? keychain.string(for: Key.previousDeviceID)
        let token = try keychain.string(for: Key.deviceToken) ?? keychain.string(for: Key.previousDeviceToken)
        guard deviceID != nil || token != nil else { return false }
        guard let deviceID, !deviceID.isEmpty, let token, !token.isEmpty else {
            // Legacy partial credentials are not proof that cloud data is gone.
            throw ProductError.managedIdentityRecoveryRequired
        }
        try await api.deleteDeviceData(bearer: token, expectedDeviceID: deviceID)
        try keychain.remove(Key.deviceToken)
        try keychain.remove(Key.previousDeviceToken)
        try keychain.remove(Key.deviceID)
        try keychain.remove(Key.previousDeviceID)
        return true
    }
}

protocol SecretStore: Sendable {
    func string(for account: String) throws -> String?
    func set(_ value: String, for account: String) throws
    func remove(_ account: String) throws
}

struct KeychainStore: SecretStore, Sendable {
    let service: String

    func string(for account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw ProductError.invalidServerResponse
        }
        return value
    }

    func set(_ value: String, for account: String) throws {
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(value.utf8)
        ]
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        if addStatus == errSecSuccess { return }

        if addStatus == errSecDuplicateItem {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account
            ]
            let updates: [String: Any] = [
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                kSecValueData as String: Data(value.utf8)
            ]
            guard SecItemUpdate(query as CFDictionary, updates as CFDictionary) == errSecSuccess else {
                throw ProductError.secureStorageUnavailable
            }
            return
        }

        throw ProductError.secureStorageUnavailable
    }

    func remove(_ account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ProductError.secureStorageUnavailable
        }
    }
}
