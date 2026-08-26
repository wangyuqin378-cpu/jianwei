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

    @MainActor
    func testRestoreRequestsAppStoreSync() async throws {
        var didRequestSync = false
        let store = SubscriptionStore(syncPurchases: {
            didRequestSync = true
        })

        try await store.restore()

        XCTAssertTrue(didRequestSync)
    }
}
