import Foundation
import Security

actor DeviceIdentityStore {
    private enum Key {
        static let installationID = "installation-id"
        static let deviceID = "device-id"
        static let deviceToken = "device-token"
    }

    private static let keychain = KeychainStore(service: "cn.jianwei.ios.identity")
    private static let installationIDLock = NSLock()

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func installationID() throws -> UUID {
        try Self.installationIDForSubscription()
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
        if let deviceID = try Self.keychain.string(for: Key.deviceID),
           let token = try Self.keychain.string(for: Key.deviceToken) {
            return Registration(deviceID: deviceID, token: token)
        }
        let installationID = try installationID()
        let registration = try await api.register(installationID: installationID)
        try Self.keychain.set(registration.deviceID, for: Key.deviceID)
        try Self.keychain.set(registration.token, for: Key.deviceToken)
        return registration
    }

    func invalidateServerCredential() throws {
        try Self.keychain.remove(Key.deviceID)
        try Self.keychain.remove(Key.deviceToken)
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
        try remove(account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(value.utf8)
        ]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            throw ProductError.invalidServerResponse
        }
    }

    func remove(_ account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ProductError.invalidServerResponse
        }
    }
}
