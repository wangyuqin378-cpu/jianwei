import StoreKitTest
import XCTest
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

    func testMonthlyProductCanBePurchasedAndRestored() async throws {
        continueAfterFailure = false
        let session = try SKTestSession(configurationFileNamed: "Jianwei")
        session.disableDialogs = true
        session.clearTransactions()
        defer { session.clearTransactions() }

        let store = SubscriptionStore(productID: "cn.jianwei.ios.pro.monthly")

        await store.refresh()
        if store.state == .productUnavailable {
            throw XCTSkip(
                "iOS 26.5 的 xcodebuild StoreKit 配置同步回归；请在 Xcode IDE 中运行本测试。"
            )
        }
        XCTAssertEqual(store.state, .notSubscribed)
        XCTAssertNotNil(store.displayPrice)

        try await store.purchase(appAccountToken: UUID())
        XCTAssertEqual(store.state, .subscribed)
        let purchasedJWS = await store.entitlementJWS()
        XCTAssertNotNil(purchasedJWS)

        let restoredStore = SubscriptionStore(productID: "cn.jianwei.ios.pro.monthly")
        try await restoredStore.restore()
        XCTAssertEqual(restoredStore.state, .subscribed)
        let restoredJWS = await restoredStore.entitlementJWS()
        XCTAssertNotNil(restoredJWS)
    }
}
