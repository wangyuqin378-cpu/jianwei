import Foundation
import Observation
import StoreKit

enum ManagedSubscriptionState: Equatable, Sendable {
    case loading
    case subscribed
    case notSubscribed
    case productUnavailable

    var title: String {
        switch self {
        case .loading: "正在检查"
        case .subscribed: "已订阅"
        case .notSubscribed: "未订阅"
        case .productUnavailable: "暂不可购买"
        }
    }
}

@MainActor
@Observable
final class SubscriptionStore {
    private(set) var state: ManagedSubscriptionState = .loading
    private(set) var product: Product?
    private(set) var currentTransactionJWS: String?

    private let productID: String
    private let syncPurchases: @MainActor () async throws -> Void
    @ObservationIgnored private var transactionUpdatesTask: Task<Void, Never>?

    init(
        productID: String? = nil,
        bundle: Bundle = .main,
        syncPurchases: @escaping @MainActor () async throws -> Void = { try await AppStore.sync() }
    ) {
        self.productID = productID
            ?? bundle.object(forInfoDictionaryKey: "JianweiMonthlyProductID") as? String
            ?? "cn.jianwei.ios.pro.monthly"
        self.syncPurchases = syncPurchases
        transactionUpdatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self, !Task.isCancelled else { return }
                await self.consume(transaction: result)
            }
        }
    }

    deinit {
        transactionUpdatesTask?.cancel()
    }

    var displayPrice: String? { product?.displayPrice }

    func refresh() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E") {
            product = nil
            currentTransactionJWS = nil
            state = .subscribed
            return
        }
        #endif
        if product == nil {
            product = try? await Product.products(for: [productID]).first
        }
        await refreshEntitlement()
    }

    func purchase(appAccountToken: UUID) async throws {
        if product == nil { await refresh() }
        guard let product else { throw ProductError.subscriptionUnavailable }
        switch try await product.purchase(options: [.appAccountToken(appAccountToken)]) {
        case let .success(result):
            guard case let .verified(transaction) = result else {
                throw ProductError.subscriptionVerificationFailed
            }
            await transaction.finish()
            await refreshEntitlement()
        case .pending:
            throw ProductError.subscriptionPending
        case .userCancelled:
            return
        @unknown default:
            throw ProductError.subscriptionUnavailable
        }
    }

    func restore() async throws {
        try await syncPurchases()
        await refreshEntitlement()
    }

    func entitlementJWS() async -> String? {
        await refreshEntitlement()
        return currentTransactionJWS
    }

    private func refreshEntitlement() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E") {
            currentTransactionJWS = nil
            state = .subscribed
            return
        }
        #endif
        currentTransactionJWS = nil
        for await result in Transaction.currentEntitlements {
            guard case let .verified(transaction) = result,
                  transaction.productID == productID,
                  transaction.revocationDate == nil,
                  transaction.expirationDate.map({ $0 > Date() }) ?? true else { continue }
            currentTransactionJWS = result.jwsRepresentation
            state = .subscribed
            return
        }
        state = product == nil ? .productUnavailable : .notSubscribed
    }

    private func consume(transaction result: VerificationResult<Transaction>) async {
        guard case let .verified(transaction) = result,
              transaction.productID == productID else { return }
        await transaction.finish()
        await refreshEntitlement()
    }
}
