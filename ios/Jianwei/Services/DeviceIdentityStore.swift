import Foundation
import Security

actor DeviceIdentityStore {
    private enum Key {
        static let installationID = "installation-id"
        static let deviceID = "device-id"
        static let deviceToken = "device-token"
    }

    private let api: APIClient
    private let keychain = KeychainStore(service: "cn.jianwei.ios.identity")

    init(api: APIClient) { self.api = api }

    func credentials() async throws -> Registration {
        if let deviceID = try keychain.string(for: Key.deviceID),
           let token = try keychain.string(for: Key.deviceToken) {
            return Registration(deviceID: deviceID, token: token)
        }
        let installationID: UUID
        if let stored = try keychain.string(for: Key.installationID).flatMap(UUID.init(uuidString:)) {
            installationID = stored
        } else {
            installationID = UUID()
            try keychain.set(installationID.uuidString.lowercased(), for: Key.installationID)
        }
        let registration = try await api.register(installationID: installationID)
        try keychain.set(registration.deviceID, for: Key.deviceID)
        try keychain.set(registration.token, for: Key.deviceToken)
        return registration
    }

    func invalidateServerCredential() throws {
        try keychain.remove(Key.deviceID)
        try keychain.remove(Key.deviceToken)
    }
}

private struct KeychainStore: Sendable {
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
