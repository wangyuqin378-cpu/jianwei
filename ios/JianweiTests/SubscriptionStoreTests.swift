import XCTest
import StoreKit
import StoreKitTest
@testable import Jianwei

@MainActor
final class SubscriptionStoreTests: XCTestCase {
    func testLocalConfigurationMatchesLaunchOffer() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "Jianwei", withExtension: "storekit")
        )
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        let groups = try XCTUnwrap(root["subscriptionGroups"] as? [[String: Any]])
        let group = try XCTUnwrap(groups.first)
        let subscriptions = try XCTUnwrap(group["subscriptions"] as? [[String: Any]])
        let monthly = try XCTUnwrap(subscriptions.first)
        let offer = try XCTUnwrap(monthly["introductoryOffer"] as? [String: Any])

        XCTAssertEqual(monthly["productID"] as? String, "cn.jianwei.ios.pro.monthly")
        XCTAssertEqual(monthly["displayPrice"] as? String, "8")
        XCTAssertEqual(monthly["recurringSubscriptionPeriod"] as? String, "P1M")
        XCTAssertEqual(offer["paymentMode"] as? String, "free")
        XCTAssertEqual(offer["subscriptionPeriod"] as? String, "P1W")
    }

    @MainActor
    func testRestoreRequestsAppStoreSync() async throws {
        var didRequestSync = false
        let store = SubscriptionStore(syncPurchases: {
            didRequestSync = true
        })

        try await store.restore()

        XCTAssertTrue(didRequestSync)
    }

    func testStoreKitGracePeriodRetainsAccessAfterTransactionExpires() async throws {
        let session = try makeStoreKitSession()
        defer {
            session.clearTransactions()
            session.resetToDefaultState()
        }
        let productID = "cn.jianwei.ios.pro.monthly"
        // Set the rate before purchase: changing it later does not reschedule
        // the existing transaction's original expiration in StoreKit Test.
        session.timeRate = .monthlyRenewalEveryThirtySeconds
        let purchased = try await buyLocalProduct(productID, session: session)
        await purchased.finish()
        try session.enableAutoRenewForTransaction(identifier: UInt(purchased.id))
        let products = try await Product.products(for: [productID])
        let product = try XCTUnwrap(products.first)
        let store = SubscriptionStore(productID: productID)
        await store.refresh()
        XCTAssertEqual(store.state, .subscribed)

        session.shouldEnterBillingRetryOnRenewal = true
        session.billingGracePeriodIsEnabled = true
        let grace = try await waitForStatus(.inGracePeriod, product: product)
        guard case let .verified(transaction) = grace.transaction else {
            return XCTFail("The local StoreKit grace transaction must be verified.")
        }
        XCTAssertLessThanOrEqual(try XCTUnwrap(transaction.expirationDate), Date())
        let proof = await store.entitlementJWS()
        XCTAssertNotNil(proof, "Apple still grants access in grace, even though the billing period expired.")
        XCTAssertEqual(store.state, .subscribed)

        _ = try await waitForStatus(.inBillingRetryPeriod, product: product)
        let endedProof = await store.entitlementJWS()
        XCTAssertNil(endedProof, "Billing retry without grace must not retain access.")
        XCTAssertEqual(store.state, .notSubscribed)
    }

    func testStoreKitCancellationKeepsAccessUntilExpiry() async throws {
        let session = try makeStoreKitSession()
        defer {
            session.clearTransactions()
            session.resetToDefaultState()
        }
        let productID = "cn.jianwei.ios.pro.monthly"
        let purchased = try await buyLocalProduct(productID, session: session)
        await purchased.finish()
        let products = try await Product.products(for: [productID])
        let product = try XCTUnwrap(products.first)
        let store = SubscriptionStore(productID: productID)
        await store.refresh()
        XCTAssertEqual(store.state, .subscribed)

        try session.disableAutoRenewForTransaction(identifier: UInt(purchased.id))
        let cancelledProof = await store.entitlementJWS()
        XCTAssertNotNil(cancelledProof, "Cancelling renewal does not forfeit the paid period.")
        XCTAssertEqual(store.state, .subscribed)

        try session.expireSubscription(productIdentifier: productID)
        _ = try await waitForStatus(.expired, product: product)
        let expiredProof = await store.entitlementJWS()
        XCTAssertNil(expiredProof)
        XCTAssertEqual(store.state, .notSubscribed)
    }

    func testStoreKitRefundRevokesActiveEntitlement() async throws {
        let session = try makeStoreKitSession()
        defer {
            session.clearTransactions()
            session.resetToDefaultState()
        }
        let productID = "cn.jianwei.ios.pro.monthly"
        let purchased = try await buyLocalProduct(productID, session: session)
        await purchased.finish()
        let products = try await Product.products(for: [productID])
        let product = try XCTUnwrap(products.first)
        let store = SubscriptionStore(productID: productID)
        await store.refresh()
        XCTAssertEqual(store.state, .subscribed)

        try session.refundTransaction(identifier: UInt(purchased.id))
        _ = try await waitForStatus(.revoked, product: product)
        let refundedProof = await store.entitlementJWS()
        XCTAssertNil(refundedProof)
        XCTAssertEqual(store.state, .notSubscribed)
    }

    private func buyLocalProduct(_ productID: String, session: SKTestSession) async throws -> StoreKit.Transaction {
        do {
            let transaction = try await session.buyProduct(identifier: productID)
            XCTAssertEqual(transaction.environment, .xcode, "These tests must never use a real purchase environment.")
            return transaction
        } catch StoreKitError.notEntitled {
            // Some simulator runtimes reject SKTestSession before loading its
            // configuration. Report missing integration coverage, not a pass.
            throw XCTSkip("The runtime rejected local StoreKit Test configuration (notEntitled). Re-run this integration test on a working runtime; iOS 17 is validated for this project.")
        }
    }

    private func makeStoreKitSession() throws -> SKTestSession {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Jianwei", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        return session
    }

    private func waitForStatus(
        _ expected: Product.SubscriptionInfo.RenewalState,
        product: Product
    ) async throws -> Product.SubscriptionInfo.Status {
        let subscription = try XCTUnwrap(product.subscription)
        let deadline = ContinuousClock.now.advanced(by: .seconds(45))
        var lastStates: [UInt64] = []
        while ContinuousClock.now < deadline {
            let statuses = try await subscription.status
            lastStates = statuses.map { UInt64($0.state.rawValue) }
            if let status = statuses.first(where: { $0.state == expected }) { return status }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw NSError(domain: "StoreKitLifecycleTest", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "StoreKit did not reach \(expected) within 45 seconds; last states: \(lastStates)."])
    }
}
