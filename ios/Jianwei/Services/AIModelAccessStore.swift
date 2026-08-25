import Foundation

struct ModelAccessRequest: Sendable {
    let mode: ModelAccessMode
    let apiKey: String?
    let appStoreTransaction: String?
}

actor AIModelAccessStore {
    private enum Key {
        static let qwenAPIKey = "qwen-api-key"
    }

    private let keychain: any SecretStore

    init(keychain: any SecretStore = KeychainStore(service: "cn.jianwei.ios.model-access")) {
        self.keychain = keychain
    }

    func hasQwenAPIKey() throws -> Bool {
        try keychain.string(for: Key.qwenAPIKey) != nil
    }

    func saveQwenAPIKey(_ rawValue: String) throws {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: "^sk-[A-Za-z0-9_-]{17,197}$", options: .regularExpression) != nil else {
            throw ProductError.invalidAPIKey
        }
        try keychain.set(value, for: Key.qwenAPIKey)
    }

    func removeQwenAPIKey() throws {
        try keychain.remove(Key.qwenAPIKey)
    }

    func request(for mode: ModelAccessMode, managedTransaction: String? = nil) throws -> ModelAccessRequest {
        switch mode {
        case .managed:
            return ModelAccessRequest(
                mode: .managed,
                apiKey: nil,
                appStoreTransaction: managedTransaction
            )
        case .qwenUserKey:
            guard let key = try keychain.string(for: Key.qwenAPIKey) else {
                throw ProductError.apiKeyRequired
            }
            return ModelAccessRequest(mode: .qwenUserKey, apiKey: key, appStoreTransaction: nil)
        }
    }
}
