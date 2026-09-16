import Foundation
@preconcurrency import Photos
import UIKit
import SwiftUI
@preconcurrency import Vision
import XCTest
@testable import Jianwei

final class DiscoverySafetyTests: XCTestCase, @unchecked Sendable {
    private let day = "2026-09-05"

    func testCancelledManagedPhotoResumesSameRequestAfterRepositoryRestart() async throws {
        try await assertManagedPhotoResumesAfterCancellation(previousCount: 0)
    }

    func testCancelledNinthManagedPhotoResumesWithNoNewPhotoBudget() async throws {
        try await assertManagedPhotoResumesAfterCancellation(previousCount: 8)
    }

    func testCancelledNinthManagedPhotoPublishesRecoveredCardWithoutNewBudget() async throws {
        try await assertManagedPhotoResumesAfterCancellation(previousCount: 8, ready: true)
    }

    private func assertManagedPhotoResumesAfterCancellation(previousCount: Int, ready: Bool = false) async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let started = expectation(description: "Managed request dispatched")
        SafetyResumableInsightURLProtocol.reset(started: started)
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyResumableInsightURLProtocol.self)
        let target = ChinaDay.string(from: Date())
        try await environment.repository.savePreparation(DailyPreparationRecord(
            day: target, status: .preparing, inspectedPhotoCount: 72, aiPhotoCount: previousCount))
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let jpeg = await makeJPEG()
        let task = Task {
            try await environment.pipeline.analyze(sourceData: jpeg, localIdentifier: "interrupted-photo",
                capturedAt: nil, targetDay: target, discoveryRun: run)
        }
        await fulfillment(of: [started], timeout: 5)
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled analysis returned a card") }
        catch is CancellationError {} catch { XCTFail("Unexpected cancellation error: \(error)") }
        await environment.repository.endAutomaticDiscoveryRun(run)

        let reopened = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyResumableInsightURLProtocol.self)
        let before = await reopened.repository.snapshot()
        let checkpoint = try XCTUnwrap(before.candidates.first { $0.localIdentifier == "interrupted-photo" },
            "The request identity and sanitized bytes must survive cancellation/process restart")
        XCTAssertEqual(checkpoint.state, .uploaded)
        XCTAssertEqual(before.dailyPreparations[target]?.aiPhotoCount, previousCount + 1)
        let cached = await reopened.repository.imageData(candidateToken: checkpoint.id)
        XCTAssertNotNil(cached)
        let removed = try await reopened.repository.removeOrphanedImages()
        XCTAssertEqual(removed, 0, "Startup cleanup must retain an unfinished request")
        SafetyResumableInsightURLProtocol.allowCompletion(ready: ready)
        let runner = try makeRunner(environment: reopened, root: root)
        _ = await runner.run(maximumCandidates: 0, targetDay: target)
        let after = await reopened.repository.snapshot()
        XCTAssertEqual(after.candidates.first { $0.id == checkpoint.id }?.state, ready ? .selected : .exhausted)
        XCTAssertNil(after.candidates.first { $0.id == checkpoint.id }?.managedDispatch)
        XCTAssertEqual(after.dailyPreparations[target]?.aiPhotoCount, previousCount + 1,
            "Recovering a reserved photo is not another unique photo")
        XCTAssertEqual(after.dailyPreparations[target]?.inspectedPhotoCount, 72)
        let requests = SafetyResumableInsightURLProtocol.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests.first?.idempotencyKey, requests.last?.idempotencyKey)
        XCTAssertEqual(requests.first?.jpegBase64, requests.last?.jpegBase64)
        if ready {
            XCTAssertEqual(after.dailyPreparations[target]?.status, .ready)
            XCTAssertEqual(after.cards.count, 1)
            XCTAssertEqual(after.dailyPreparations[target]?.selectedCardID, after.cards.first?.id)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget")).load()
            XCTAssertEqual(widget.card(for: target)?.id, after.cards.first?.id)
        } else if previousCount == 8 { XCTAssertEqual(after.dailyPreparations[target]?.status, .noNewCard) }
        _ = await runner.run(maximumCandidates: 0, targetDay: target)
        XCTAssertEqual(SafetyResumableInsightURLProtocol.requests.count, 2, "Terminal decisions must not replay")
    }

    func testManagedCheckpointCommitFailureRollsBackImageIdentityAndAllowance() async throws {
        let root = temporaryRoot()
        let stateURL = root.appendingPathComponent("state.json")
        defer {
            try? FileManager.default.setAttributes([.immutable: false], ofItemAtPath: stateURL.path)
            try? FileManager.default.removeItem(at: root)
        }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate()
        try FileManager.default.setAttributes([.immutable: true], ofItemAtPath: stateURL.path)
        do {
            _ = try await repository.checkpointManagedPhoto(candidate: candidate, sanitizedJPEG: makeJPEG(), day: day, run: run)
            XCTFail("A failed atomic commit cannot authorize a dispatch")
        } catch { XCTAssertFalse(error is CancellationError) }
        let current = await repository.snapshot()
        let reopened = try LocalRepository(rootURL: root)
        let persisted = await reopened.snapshot()
        XCTAssertTrue(current.candidates.isEmpty)
        XCTAssertTrue(persisted.candidates.isEmpty)
        XCTAssertNil(persisted.dailyPreparations[day])
        let image = await repository.imageData(candidateToken: candidate.id)
        XCTAssertNil(image)
        await repository.endAutomaticDiscoveryRun(run)
    }

    func testNinthManagedReplayServiceFailureRemainsRetryableAndRetainsAllowance() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        SafetyManagedAccessURLProtocol.reset()
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyManagedAccessURLProtocol.self)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 8))
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = try await environment.repository.checkpointManagedPhoto(candidate: makeCandidate(),
            sanitizedJPEG: makeJPEG(), day: day, run: run)
        await environment.repository.endAutomaticDiscoveryRun(run)
        let runner = try makeRunner(environment: environment, root: root)
        for _ in 0..<2 {
            let result = await runner.run(maximumCandidates: 0, targetDay: day)
            XCTAssertEqual(result.accessError, .managedServiceUnavailable)
            let state = await environment.repository.snapshot()
            XCTAssertEqual(state.dailyPreparations[day]?.status, .retryableFailure)
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
            XCTAssertEqual(state.candidates.first?.managedDispatch, candidate.managedDispatch)
        }
        XCTAssertEqual(SafetyManagedAccessURLProtocol.callCount, 2)
    }

    func testMissingManagedCheckpointBytesDoNotTrapExhaustedDayInPreparing() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        SafetyManagedAccessURLProtocol.reset()
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyManagedAccessURLProtocol.self)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 8))
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = try await environment.repository.checkpointManagedPhoto(candidate: makeCandidate(),
            sanitizedJPEG: makeJPEG(), day: day, run: run)
        try await environment.repository.removeImage(candidateToken: candidate.id, discoveryRun: run)
        await environment.repository.endAutomaticDiscoveryRun(run)
        let runner = try makeRunner(environment: environment, root: root)
        _ = await runner.run(maximumCandidates: 0, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
        XCTAssertEqual(SafetyManagedAccessURLProtocol.callCount, 0)
    }

    func testManagedCheckpointExpiryReservesAgainWithoutRefundingPriorUsage() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate(), jpeg = await makeJPEG(), now = Date()
        let first = try await repository.checkpointManagedPhoto(candidate: candidate, sanitizedJPEG: jpeg,
            day: day, run: run, now: now)
        let replay = try await repository.checkpointManagedPhoto(candidate: first, sanitizedJPEG: jpeg,
            day: day, run: run, now: now.addingTimeInterval(3600))
        XCTAssertEqual(first.managedDispatch, replay.managedDispatch)
        do {
            _ = try await repository.checkpointManagedPhoto(candidate: first, sanitizedJPEG: jpeg + Data([0]),
                day: day, run: run, now: now.addingTimeInterval(3600))
            XCTFail("Never associate different bytes with an existing idempotency key")
        } catch { XCTAssertEqual(error as? ProductError, .localStorageUnavailable) }
        let expired = try await repository.checkpointManagedPhoto(candidate: first, sanitizedJPEG: jpeg,
            day: day, run: run, now: now.addingTimeInterval(7 * 86400))
        XCTAssertNotEqual(first.managedDispatch?.reservationID, expired.managedDispatch?.reservationID)
        let state = await repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 2)
        XCTAssertEqual(state.dailyPreparations[day]?.cloudPhotoReservationIDs?.count, 2)
        XCTAssertEqual(state.candidates.count, 1)
        await repository.endAutomaticDiscoveryRun(run)
    }

    func testPausedOrDeletedManagedRequestCannotWriteLateOrResumeWhilePaused() async throws {
        for delete in [false, true] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let started = expectation(description: "Managed request started")
            SafetyResumableInsightURLProtocol.reset(started: started)
            let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
                transport: SafetyResumableInsightURLProtocol.self)
            let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
            let run = try XCTUnwrap(acquired)
            let jpeg = await makeJPEG()
            let task = Task { try await environment.pipeline.analyze(sourceData: jpeg,
                localIdentifier: "paused-photo", capturedAt: nil, targetDay: day, discoveryRun: run) }
            run.installCancellationHandler { task.cancel() }
            await fulfillment(of: [started], timeout: 5)
            if delete { try await environment.repository.deleteLocalData() }
            else { try await environment.repository.setAutomaticDiscovery(false) }
            do { _ = try await task.value; XCTFail("Invalidated request completed") }
            catch { XCTAssertTrue(error is CancellationError) }
            await environment.repository.endAutomaticDiscoveryRun(run)
            let runner = try makeRunner(environment: environment, root: root)
            _ = await runner.run(maximumCandidates: 9, targetDay: day)
            let state = await environment.repository.snapshot()
            XCTAssertTrue(state.cards.isEmpty)
            XCTAssertEqual(state.candidates.count, delete ? 0 : 1)
            XCTAssertEqual(SafetyResumableInsightURLProtocol.requests.count, 1)
            if delete { XCTAssertTrue(state.dailyPreparations.isEmpty) }
            else { XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1) }
        }
    }

    func testPendingManagedRequestDoesNotDispatchOnPersonalKey() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true)
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let jpeg = await makeJPEG()
        let pending = try await environment.repository.checkpointManagedPhoto(candidate: makeCandidate(),
            sanitizedJPEG: jpeg, day: day, run: run)
        await environment.repository.endAutomaticDiscoveryRun(run)
        try await environment.repository.setModelAccessMode(.qwenUserKey)
        let reacquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let personalRun = try XCTUnwrap(reacquired)
        do {
            _ = try await environment.pipeline.retry(candidate: pending, sanitizedJPEG: jpeg, targetDay: day,
                discoveryRun: personalRun)
            XCTFail("A platform checkpoint cannot be dispatched using the personal key")
        } catch { XCTAssertTrue(error is CancellationError) }
        await environment.repository.endAutomaticDiscoveryRun(personalRun)
        let runner = try makeRunner(environment: environment, root: root)
        _ = await runner.run(maximumCandidates: 0, targetDay: day)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.candidates.first?.state, .uploaded)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
    }

    func testBackgroundAvailabilityDoesNotMislabelLowPowerAsUserDenial() {
        XCTAssertEqual(BackgroundPreparationAvailability(refreshStatus: .available, lowPowerMode: false), .available)
        XCTAssertEqual(BackgroundPreparationAvailability(refreshStatus: .denied, lowPowerMode: false), .disabled)
        for status: UIBackgroundRefreshStatus in [.available, .denied] {
            XCTAssertEqual(BackgroundPreparationAvailability(refreshStatus: status, lowPowerMode: true), .lowPower)
        }
        for lowPower in [false, true] {
            XCTAssertEqual(BackgroundPreparationAvailability(refreshStatus: .restricted, lowPowerMode: lowPower), .restricted)
        }
        XCTAssertFalse(BackgroundPreparationAvailability.unknown.needsAttention)
    }

    @MainActor
    func testBackgroundRestrictionsAreReadOnlyAndDoNotBlockForegroundCards() async throws {
        @MainActor final class Observation {
            var value: BackgroundPreparationAvailability
            init(_ value: BackgroundPreparationAvailability) { self.value = value }
        }
        for availability: BackgroundPreparationAvailability in [.disabled, .restricted, .lowPower] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [1, 2, 3])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
            let source = await makeBatchSource(count: 3)
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let observed = Observation(availability)
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full },
                                 backgroundAvailabilityCheck: { observed.value })
            // Run credential/access initialization too, not just disk loading.
            await model.start()
            XCTAssertTrue(model.showsBackgroundPreparationNotice)
            await model.replenishRollingCache()
            let current = try XCTUnwrap(model.currentCard)
            XCTAssertEqual(try widget.load().card(for: ChinaDay.string(from: Date()))?.id, current.id)
            XCTAssertEqual(model.preparedFutureDayCount, 0, "Today's card is not a future cached day")
            XCTAssertFalse(model.preparationPresentation.needsAttention, "OS warning must not replace the ready-card status")
            XCTAssertTrue(model.automaticDiscoveryEnabled)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let before = try encoder.encode(await environment.repository.snapshot())
            let widgetBefore = try encoder.encode(widget.load())
            let historyBefore = model.historyCards.map(\.id)
            for next: BackgroundPreparationAvailability in [.available, .lowPower, .disabled, .restricted, .unknown, .available] {
                observed.value = next
                model.refreshBackgroundPreparationAvailability()
                XCTAssertEqual(model.backgroundPreparationAvailability, next)
                XCTAssertEqual(model.showsBackgroundPreparationNotice, next.needsAttention)
                XCTAssertEqual(model.currentCard?.id, current.id)
                XCTAssertEqual(model.historyCards.map(\.id), historyBefore)
            }
            let after = await environment.repository.snapshot()
            XCTAssertEqual(try encoder.encode(after), before)
            XCTAssertEqual(try encoder.encode(widget.load()), widgetBefore)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 3, "System notifications must not dispatch additional photos")
            XCTAssertEqual(calls.winner, 1)

            try await environment.repository.setAutomaticDiscovery(false)
            observed.value = .disabled
            await model.refreshPresentationState()
            XCTAssertFalse(model.showsBackgroundPreparationNotice, "A paused user does not need a background warning on the home screen")
            XCTAssertEqual(model.backgroundPreparationAvailability, .disabled, "Settings can still report the system state")
        }
    }

    @MainActor
    func testForegroundResumeRepairsFailedOrMissingBackgroundScheduleWithoutPostponingPendingWork() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        try await environment.repository.setAutomaticDiscovery(false)
        let source = await makeBatchSource(count: 0)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let transport = SafetyTaskScheduling(submissionFailures: 1)
        let scheduler = DiscoveryTaskScheduler(transport: transport)
        let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full },
                             backgroundSchedule: { try await scheduler.schedule(repository: environment.repository) })
        await model.start() // Paused: no system schedule or model work during bootstrap.
        try await environment.repository.setAutomaticDiscovery(true)
        await model.refreshPresentationState()
        await model.resumeFromBackground() // Submission fails; foreground work still finishes.
        XCTAssertNil(transport.currentRequest())
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(model.state.dailyPreparations[ChinaDay.string(from: Date())]?.status, .waitingForPhotos,
                       "The failed schedule must not suppress the foreground photo check")
        await model.resumeFromBackground()
        let first = try XCTUnwrap(transport.currentRequest()?.earliestBeginDate)
        XCTAssertEqual(transport.submittedDates().count, 1)
        await model.resumeFromBackground()
        XCTAssertEqual(transport.currentRequest()?.earliestBeginDate, first)
        XCTAssertEqual(transport.submittedDates().count, 1, "Do not slide an eligible pending opportunity")
        transport.removePendingRequest() // The OS discarded the request without running it.
        await model.resumeFromBackground()
        XCTAssertEqual(transport.submittedDates().count, 2)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0, "Scheduling bookkeeping must not generate knowledge")
    }

    @MainActor
    func testForegroundScheduleRecoveryHonorsPauseAccessReadOnlyAndCancellation() async throws {
        for scenario in ["paused", "denied", "readOnly", "cancelled", "cancel-during-schedule"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
            if scenario == "paused" { try await environment.repository.setAutomaticDiscovery(false) }
            let source = await makeBatchSource(count: 0)
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            var scheduled = 0
            let model = AppModel(environment: environment,
                launchArguments: scenario == "readOnly" ? ["-JianweiReadOnlyStateProbe"] : [],
                automaticRunner: runner, photoAccessCheck: { scenario == "denied" ? .denied : .full },
                backgroundSchedule: {
                    scheduled += 1
                    if scenario == "cancel-during-schedule" { withUnsafeCurrentTask { $0?.cancel() } }
                })
            await model.refreshPresentationState()
            let task = Task {
                if scenario == "cancelled" { withUnsafeCurrentTask { $0?.cancel() } }
                await model.replenishRollingCache()
            }
            await task.value
            XCTAssertEqual(scheduled, scenario == "cancel-during-schedule" ? 1 : 0, scenario)
            XCTAssertFalse(model.isWorking, "Cancellation must release the foreground busy state")
            let snapshot = await environment.repository.snapshot()
            XCTAssertTrue(snapshot.dailyPreparations.isEmpty, "A cancelled schedule cannot start preparation")
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0)
        }
    }

    func testBackgroundSchedulingPreservesPendingOpportunityAcrossRelaunches() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let transport = SafetyTaskScheduling()
        let scheduler = DiscoveryTaskScheduler(transport: transport)
        let now = Date(timeIntervalSince1970: 1_788_912_000)
        try await scheduler.schedule(repository: repository, now: now)
        try await scheduler.schedule(repository: repository, now: now.addingTimeInterval(3600))
        let relaunched = DiscoveryTaskScheduler(transport: transport)
        try await relaunched.schedule(repository: repository, now: now.addingTimeInterval(3 * 3600))
        try await relaunched.schedule(repository: repository, now: now.addingTimeInterval(7 * 3600))
        XCTAssertEqual(transport.submittedDates(), [now.addingTimeInterval(6 * 3600)],
                       "Repeated launches must not push an unexecuted request six hours into the future again")
        XCTAssertEqual(transport.currentRequest()?.earliestBeginDate, now.addingTimeInterval(6 * 3600))

        transport.removePendingRequest() // The OS completed or discarded it.
        try await relaunched.schedule(repository: repository, now: now.addingTimeInterval(8 * 3600))
        XCTAssertEqual(transport.submittedDates().count, 2)
        XCTAssertEqual(transport.currentRequest()?.earliestBeginDate, now.addingTimeInterval(14 * 3600))
    }

    func testBackgroundSchedulingRespectsManagedDeferralAndCurrentMode() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let now = Date(timeIntervalSince1970: 1_788_912_000)
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let reservation = try await repository.reserveDiscoveryCloudPhoto(day: day, run: run)
        try await repository.rejectManagedCloudPhotoReservation(day: day, reservationID: reservation, run: run, now: now)
        await repository.endAutomaticDiscoveryRun(run)
        let resumeAt = ChinaDay.adding(days: 1, to: now)
        let transport = SafetyTaskScheduling(pending: PendingDiscoveryTask(earliestBeginDate: now.addingTimeInterval(3600)))
        let scheduler = DiscoveryTaskScheduler(transport: transport)
        try await scheduler.schedule(repository: repository, now: now)
        try await scheduler.schedule(repository: repository, now: now.addingTimeInterval(3600))
        XCTAssertEqual(transport.submittedDates(), [resumeAt], "Repeated launches cannot ignore the managed-service wait")

        try await repository.setModelAccessMode(.qwenUserKey)
        try await scheduler.schedule(repository: repository, now: now.addingTimeInterval(3600))
        XCTAssertEqual(transport.submittedDates(), [resumeAt, now.addingTimeInterval(7 * 3600)],
                       "Switching to BYOK must not retain the platform's later wait")

        try await repository.setModelAccessMode(.managed)
        let immediate = SafetyTaskScheduling(pending: PendingDiscoveryTask(earliestBeginDate: nil))
        let afterWait = DiscoveryTaskScheduler(transport: immediate)
        try await afterWait.schedule(repository: repository, now: resumeAt.addingTimeInterval(3600))
        XCTAssertTrue(immediate.submittedDates().isEmpty, "An expired wait cannot postpone an already-eligible request")
        XCTAssertNotNil(immediate.currentRequest())
    }

    func testBackgroundSchedulingCannotResurrectAfterCancellationPauseOrDeletion() async throws {
        for change in ["cancel", "pause", "delete", "pause-resume", "task-cancel"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setAutomaticDiscovery(true)
            let gate = SafetySuspension()
            let started = expectation(description: "\(change): pending OS callback")
            let transport = SafetyTaskScheduling(firstQueryGate: gate, firstQueryStarted: started)
            let scheduler = DiscoveryTaskScheduler(transport: transport)
            let work = Task { try await scheduler.schedule(repository: repository) }
            await fulfillment(of: [started], timeout: 2)
            switch change {
            case "pause": try await repository.setAutomaticDiscovery(false)
            case "delete": try await repository.deleteLocalData()
            case "pause-resume":
                try await repository.setAutomaticDiscovery(false)
                await scheduler.cancel()
                try await repository.setAutomaticDiscovery(true)
            case "task-cancel": work.cancel()
            default: await scheduler.cancel()
            }
            await gate.resume()
            do { try await work.value }
            catch { XCTAssertTrue(error is CancellationError, change) }
            XCTAssertTrue(transport.submittedDates().isEmpty, change)
            XCTAssertNil(transport.currentRequest(), change)
            if change == "pause-resume" {
                try await scheduler.schedule(repository: repository)
                XCTAssertEqual(transport.submittedDates().count, 1, "Only a fresh action may rearm after resume")
            }
        }
    }

    func testOlderPendingCallbackCannotOverwriteNewerBackgroundSchedule() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let gate = SafetySuspension()
        let started = expectation(description: "older pending OS callback")
        let transport = SafetyTaskScheduling(firstQueryGate: gate, firstQueryStarted: started)
        let scheduler = DiscoveryTaskScheduler(transport: transport)
        let now = Date(timeIntervalSince1970: 1_788_912_000)
        let older = Task { try await scheduler.schedule(repository: repository, now: now) }
        await fulfillment(of: [started], timeout: 2)
        try await scheduler.schedule(repository: repository, now: now.addingTimeInterval(3600))
        await gate.resume()
        try await older.value
        XCTAssertEqual(transport.submittedDates(), [now.addingTimeInterval(7 * 3600)])
        XCTAssertEqual(transport.currentRequest()?.earliestBeginDate, now.addingTimeInterval(7 * 3600))
    }

    func testFailedBackgroundSubmissionCanBeRetriedWithoutFalsePendingState() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let transport = SafetyTaskScheduling(submissionFailures: 1)
        let scheduler = DiscoveryTaskScheduler(transport: transport)
        do {
            try await scheduler.schedule(repository: repository)
            XCTFail("An unavailable OS scheduler must be reported to its caller")
        } catch { XCTAssertTrue(error is SafetyTaskScheduling.Failure) }
        XCTAssertNil(transport.currentRequest())
        XCTAssertTrue(transport.submittedDates().isEmpty)
        try await scheduler.schedule(repository: repository)
        XCTAssertEqual(transport.submittedDates().count, 1)
    }

    func testExpiredBackgroundWorkStillRenewsUnlessPausedOrAccessBlocked() async throws {
        for scenario in ["expired", "expired-pending", "paused", "permission", "key"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setAutomaticDiscovery(scenario != "paused")
            let now = Date(timeIntervalSince1970: 1_788_912_000)
            let transport = SafetyTaskScheduling(pending: scenario == "expired-pending"
                ? PendingDiscoveryTask(earliestBeginDate: now.addingTimeInterval(-3600)) : nil)
            let scheduler = DiscoveryTaskScheduler(transport: transport)
            let accessError: ProductError? = scenario == "permission" ? .permissionDenied
                : scenario == "key" ? .apiKeyRequired : nil
            let expired = Task {
                withUnsafeCurrentTask { $0?.cancel() }
                XCTAssertTrue(Task.isCancelled)
                try await scheduler.rescheduleAfterOpportunity(repository: repository, accessError: accessError, now: now)
                XCTAssertTrue(Task.isCancelled, "Only bookkeeping escapes cancellation, never the expired worker")
            }
            try await expired.value
            XCTAssertEqual(transport.submittedDates().count, scenario.hasPrefix("expired") ? 1 : 0, scenario)
            if scenario.hasPrefix("expired") {
                XCTAssertEqual(transport.currentRequest()?.earliestBeginDate, now.addingTimeInterval(6 * 3600))
            }
        }
    }

    #if DEBUG
    func testReadOnlyProbeCannotStartDiscoveryOutsideTheForegroundModel() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let qwen = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: qwen, sharedStore: widget)
        let source = await makeBatchSource(count: 1)
        let before = try Data(contentsOf: root.appendingPathComponent("state.json"))
        let runner = AutomaticDiscoveryRunner(
            environment: environment, authorizationCheck: { _ in true }, widgetStore: widget,
            photoSource: source, launchArguments: ["-JianweiReadOnlyStateProbe"]
        )

        let summary = await runner.run(maximumCandidates: 9, ignoreDailySelection: true, targetDay: day)
        let refill = await runner.replenishRollingWindow(maximumCandidates: 27)
        XCTAssertEqual(refill.analyzed, 0)
        XCTAssertEqual(summary.inspected, 0)
        XCTAssertEqual(summary.analyzed, 0)
        XCTAssertEqual(summary.cardsCreated, 0)
        XCTAssertEqual(summary.failed, 0)
        let queries = await source.queryLimits()
        let reads = await source.readIDs()
        XCTAssertTrue(queries.isEmpty, "A probe must not even query the photo library")
        XCTAssertTrue(reads.isEmpty)
        let calls = await qwen.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("state.json")), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("widget/widget-state.json").path))

        // A new normal launch must still prepare a card using the same store
        // and photo, without toggling the user's automatic-discovery preference.
        let normal = AutomaticDiscoveryRunner(
            environment: environment, authorizationCheck: { _ in true }, widgetStore: widget,
            photoSource: source, launchArguments: []
        )
        let prepared = await normal.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(prepared.cardsCreated, 1)
        let state = await environment.repository.snapshot()
        XCTAssertTrue(state.automaticDiscoveryEnabled)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(try widget.load().card(for: day)?.id, state.dailyPreparations[day]?.selectedCardID)
    }
    #endif

    func testPhotoReadCancellationFinishesWithoutWaitingForPhotoKitCallback() async throws {
        let manager = SuspendedPhotoImageManager()
        let source = PhotoDiscoveryService(imageManager: manager)
        let completed = expectation(description: "Cancelled photo read finishes")
        let task = Task {
            defer { completed.fulfill() }
            do {
                _ = try await source.imageData(for: PHAsset())
                XCTFail("Cancelled photo read returned image bytes")
            } catch { XCTAssertTrue(error is CancellationError) }
        }
        await fulfillment(of: [manager.started], timeout: 2)
        task.cancel()
        let outcome = await XCTWaiter.fulfillment(of: [completed], timeout: 0.5)
        // Release the old implementation on failure; a red test must not leave
        // an orphaned task or hang the entire test runner.
        manager.deliver(data: nil, info: [PHImageCancelledKey: true])
        await task.value
        XCTAssertEqual(outcome, .completed, "Pause must release discovery even if PhotoKit never calls back")
        XCTAssertEqual(manager.cancelledIDs, [42], "Pause must cancel the actual Photos request")
    }

    func testPhotoReadTimeoutCancelsRequestAndLateCallbackDoesNotCompleteTwice() async throws {
        let manager = SuspendedPhotoImageManager()
        let source = PhotoDiscoveryService(imageManager: manager, imageRequestTimeout: 0.05)
        do {
            _ = try await source.imageData(for: PHAsset())
            XCTFail("A stalled iCloud read should time out")
        } catch {
            XCTAssertEqual(error as? ProductError, .photoReadTimedOut)
        }
        XCTAssertEqual(manager.cancelledIDs, [42])
        manager.deliver(data: Data([1, 2, 3]))
        manager.deliver(data: nil, info: [PHImageCancelledKey: true])
    }

    func testPhotoReadSynchronousCompletionIsNotCancelledAndPreservesBytes() async throws {
        let bytes = Data([1, 2, 3, 4])
        let manager = SuspendedPhotoImageManager(immediateData: bytes)
        let source = PhotoDiscoveryService(imageManager: manager, imageRequestTimeout: 0.05)
        let received = try await source.imageData(for: PHAsset())
        XCTAssertEqual(received, bytes)
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertTrue(manager.cancelledIDs.isEmpty, "A completed request must disarm its deadline")
        manager.deliver(data: nil, info: [PHImageErrorKey: URLError(.networkConnectionLost)])
    }

    func testPhotoKitDownloadTimeoutIsNotReportedAsAITimeout() async throws {
        let manager = SuspendedPhotoImageManager()
        let source = PhotoDiscoveryService(imageManager: manager)
        let task = Task { try await source.imageData(for: PHAsset()) }
        await fulfillment(of: [manager.started], timeout: 2)
        manager.deliver(data: nil, info: [PHImageErrorKey: URLError(.timedOut)])
        do {
            _ = try await task.value
            XCTFail("Photos reported a failed download")
        } catch { XCTAssertEqual(error as? ProductError, .photoReadTimedOut) }
        XCTAssertFalse(ProductError.photoReadTimedOut.errorDescription!.contains("AI"))
        XCTAssertTrue(manager.cancelledIDs.isEmpty, "Photos already completed the request")
    }

    func testLocalVisionFailureRemainsRetryableWithoutUploadOrServiceError() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let visionState = SafetySecrets()
        try visionState.set("unavailable", for: "vision")
        let analyzer = PhotoPrivacyAnalyzer(testingObservationProvider: { _ in
            if try visionState.string(for: "vision") == "unavailable" {
                throw NSError(domain: "com.apple.Vision", code: 9,
                              userInfo: [NSLocalizedDescriptionKey: "Could not create inference context"])
            }
            return .authorizedFixtureSafe
        })
        let qwen = SafetyBatchQwen(qualifiedCalls: [1])
        let environment = try await makeEnvironment(root: root, service: qwen, privacyAnalyzer: analyzer)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let source = await makeBatchSource(count: 1)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: source)
        let failed = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(failed.accessError, .localPhotoAnalysisUnavailable)
        XCTAssertEqual(failed.failed, 1)
        let before = await environment.repository.snapshot()
        XCTAssertEqual(before.dailyPreparations[day]?.status, .retryableFailure)
        XCTAssertEqual(before.dailyPreparations[day]?.aiPhotoCount, 0)
        XCTAssertTrue(before.candidates.isEmpty, "An unavailable local model must not reject the photo permanently")
        XCTAssertTrue(before.cards.isEmpty)
        let beforeCalls = await qwen.calls()
        XCTAssertEqual(beforeCalls.detect, 0, "No photo may cross the failed local check")
        let message = DiscoveryRunMessage.text(for: failed, maximumCandidates: 9)
        XCTAssertTrue(message.contains("本机"))
        XCTAssertFalse(message.contains("网络"))
        XCTAssertFalse(message.contains("服务暂时不可用"))

        try visionState.set("ready", for: "vision")
        let retried = await runner.run(maximumCandidates: 9, targetDay: day)
        let after = await environment.repository.snapshot()
        XCTAssertEqual(retried.cardsCreated, 1)
        XCTAssertEqual(after.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(after.candidates.count, 1)
        XCTAssertEqual(after.candidates.first?.localIdentifier, "synthetic-new-0")
        XCTAssertEqual(try widget.load().card(for: day)?.id, after.dailyPreparations[day]?.selectedCardID)
    }

    @MainActor
    func testUnfinishedDetectionPreservesPhotoForRetryAndKeepsPreviousCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SafetyCompletionURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); SafetyCompletionURLProtocol.reset() }
        SafetyCompletionURLProtocol.reset()
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root,
            service: DirectQwenService(session: session), sharedStore: widget)
        var previousCandidate = makeCandidate()
        previousCandidate.state = .selected
        let previous = makeCard(candidate: previousCandidate, index: 0)
            .withPresentation(status: "shown", scheduledDay: "2026-09-04")
        try await environment.repository.upsert(candidate: previousCandidate, card: previous, sanitizedJPEG: makeJPEG())
        try await environment.repository.setSaved(true, cardID: previous.id)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 1))

        let failed = await runner.run(maximumCandidates: 9, targetDay: day)
        let before = await environment.repository.snapshot()
        let candidate = try XCTUnwrap(before.candidates.first { $0.localIdentifier == "synthetic-new-0" })
        XCTAssertEqual(failed.accessError, .invalidServerResponse)
        XCTAssertEqual(failed.exhausted, 0)
        XCTAssertEqual(candidate.state, .failed, "Incomplete detection cannot permanently exclude the photo")
        XCTAssertEqual(before.dailyPreparations[day]?.status, .retryableFailure)
        XCTAssertEqual(before.dailyPreparations[day]?.aiPhotoCount, 1, "An interrupted call still consumes the existing daily allowance")
        XCTAssertEqual(before.cards, [previous])
        XCTAssertEqual(before.savedCardIDs, [previous.id])
        let beforeWidget = try widget.load()
        XCTAssertEqual(beforeWidget.mostRecentCard(onOrBefore: day)?.id, previous.id)
        XCTAssertEqual(CurrentCardResolver.resolve(cards: before.cards, widgetState: beforeWidget, activeCardID: nil)?.id, previous.id)
        let retainedImage = await environment.repository.imageData(candidateToken: candidate.id)
        XCTAssertNotNil(retainedImage)
        XCTAssertEqual(SafetyCompletionURLProtocol.callCount, 1, "No extra retry inside this run")

        // The next normal run receives a completed, genuinely empty answer.
        // Only now may the same photo reach a terminal no-insight state.
        let retried = await runner.run(maximumCandidates: 9, targetDay: day)
        let restoredRepository = try LocalRepository(rootURL: root)
        let after = await restoredRepository.snapshot()
        XCTAssertEqual(retried.failed, 0)
        XCTAssertEqual(retried.exhausted, 1)
        XCTAssertEqual(after.candidates.first { $0.id == candidate.id }?.state, .exhausted)
        XCTAssertEqual(after.dailyPreparations[day]?.aiPhotoCount, 2, "Retry cannot reset or evade the daily cap")
        XCTAssertEqual(after.cards, [previous])
        XCTAssertEqual(after.savedCardIDs, [previous.id])
        let afterWidget = try widget.load()
        XCTAssertEqual(afterWidget.mostRecentCard(onOrBefore: day)?.id, previous.id)
        XCTAssertEqual(CurrentCardResolver.resolve(cards: after.cards, widgetState: afterWidget, activeCardID: nil)?.id, previous.id)
        XCTAssertEqual(SafetyCompletionURLProtocol.callCount, 2)
    }

    func testVisionErrorMappingPreservesCancellationAndUnreadablePhoto() async throws {
        let analyzer = PhotoPrivacyAnalyzer(testingObservationProvider: { _ in throw CancellationError() })
        do {
            _ = try await analyzer.analyze(jpeg: await makeBatchJPEG(index: 0))
            XCTFail("Cancellation must not become a local model failure")
        } catch { XCTAssertTrue(error is CancellationError) }
        do {
            _ = try await analyzer.analyze(jpeg: Data())
            XCTFail("A corrupt photo must not enter Vision")
        } catch { XCTAssertEqual(error as? ProductError, .photoUnavailable) }
    }

    func testPhotoReadCancelsAnIDReturnedAfterTaskCancellation() async throws {
        let returnID = DispatchSemaphore(value: 0)
        let manager = SuspendedPhotoImageManager(returnIDGate: returnID)
        let source = PhotoDiscoveryService(imageManager: manager)
        let task = Task {
            do {
                _ = try await source.imageData(for: PHAsset())
                XCTFail("Cancelled read must not return bytes")
            } catch { XCTAssertTrue(error is CancellationError) }
        }
        await fulfillment(of: [manager.started], timeout: 2)
        task.cancel()
        returnID.signal()
        await task.value
        XCTAssertEqual(manager.cancelledIDs, [42], "Cancellation cannot lose a not-yet-returned Photos ID")
    }

    func testAlreadyCancelledPhotoReadDoesNotStartSystemRequest() async throws {
        let manager = SuspendedPhotoImageManager(immediateData: Data([1]))
        let source = PhotoDiscoveryService(imageManager: manager)
        let gate = SafetySuspension()
        let task = Task {
            await gate.wait()
            do {
                _ = try await source.imageData(for: PHAsset())
                XCTFail("An already cancelled read should not start")
            } catch { XCTAssertTrue(error is CancellationError) }
        }
        task.cancel()
        await gate.resume()
        await task.value
        XCTAssertFalse(manager.hasStarted)
        XCTAssertTrue(manager.cancelledIDs.isEmpty)
    }

    func testStalledPhotoReadReleasesRunAndCanRetryWithoutCloudCharge() async throws {
        for pause in [false, true] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let qwen = SafetyBatchQwen(qualifiedCalls: [1])
            let environment = try await makeEnvironment(root: root, service: qwen)
            let manager = SuspendedPhotoImageManager()
            let source = PhotoDiscoveryService(imageManager: manager, imageRequestTimeout: pause ? 20 : 0.05)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                widgetStore: widget, photoSource: SafetyRequestPhotoSource(source: source))
            let completed = expectation(description: "Stalled discovery releases its exclusive slot")
            let work = Task {
                let summary = await runner.run(maximumCandidates: 9, targetDay: day)
                completed.fulfill()
                return summary
            }
            await fulfillment(of: [manager.started], timeout: 2)
            if pause { try await environment.repository.setAutomaticDiscovery(false) }
            let outcome = await XCTWaiter.fulfillment(of: [completed], timeout: 1)
            manager.deliver(data: nil, info: [PHImageCancelledKey: true])
            let summary = await work.value
            XCTAssertEqual(outcome, .completed)
            XCTAssertEqual(manager.cancelledIDs, [42])
            let state = await environment.repository.snapshot()
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 0)
            XCTAssertTrue(state.candidates.isEmpty, "A download failure is not a processed or rejected photo")
            XCTAssertTrue(state.cards.isEmpty)
            let noCalls = await qwen.calls()
            XCTAssertEqual(noCalls.detect, 0)
            if !pause {
                XCTAssertEqual(summary.accessError, .photoReadTimedOut)
                XCTAssertEqual(state.dailyPreparations[day]?.status, .retryableFailure)
            }
            try await environment.repository.setAutomaticDiscovery(true)
            let available = SuspendedPhotoImageManager(immediateData: await makeBatchJPEG(index: 0))
            let retry = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                widgetStore: widget,
                photoSource: SafetyRequestPhotoSource(source: PhotoDiscoveryService(imageManager: available)))
            let retried = await retry.run(maximumCandidates: 9, targetDay: day)
            let final = await environment.repository.snapshot()
            XCTAssertEqual(retried.cardsCreated, 1, "The same photo must remain eligible after pause or timeout")
            XCTAssertEqual(final.dailyPreparations[day]?.aiPhotoCount, 1)
            XCTAssertEqual(final.candidates.count, 1)
            XCTAssertEqual(final.candidates.first?.localIdentifier, "synthetic-system-read")
            XCTAssertEqual(try widget.load().card(for: day)?.id, final.dailyPreparations[day]?.selectedCardID)
        }
    }

    func testIsolatedVisionPrivacyCPUCapabilities() async throws {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("Jianwei PhotoKit ") == true else {
            throw XCTSkip("Vision runtime diagnostics are opt-in on the isolated PhotoKit simulator")
        }
        let jpeg = await makeBatchJPEG(index: 0)
        let image = try XCTUnwrap(UIImage(data: jpeg)?.cgImage)
        let factories: [(String, () -> VNRequest)] = [
            ("face", { VNDetectFaceRectanglesRequest() }),
            ("human", { let request = VNDetectHumanRectanglesRequest(); request.upperBodyOnly = false; return request }),
            ("text", {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .fast
                request.usesLanguageCorrection = false
                request.recognitionLanguages = ["zh-Hans", "en-US"]
                return request
            }),
            ("rectangle", { VNDetectRectanglesRequest() }),
            ("segmentation", {
                let request = VNGeneratePersonSegmentationRequest()
                request.qualityLevel = .balanced
                request.outputPixelFormat = kCVPixelFormatType_OneComponent8
                return request
            }),
            ("classification", { VNClassifyImageRequest() })
        ]
        var report: [[String: String]] = []
        for cpu in [false, true] {
            for (name, factory) in factories {
                let request = factory()
                var row = ["request": name, "mode": cpu ? "cpu" : "automatic"]
                do {
                    let devices = try request.supportedComputeStageDevices
                    row["devices"] = devices.map { "\($0.key.rawValue): \($0.value)" }.sorted().joined(separator: "; ")
                    if cpu {
                        for (stage, supported) in devices {
                            if let device = supported.first(where: { if case .cpu = $0 { true } else { false } }) {
                                request.setComputeDevice(device, for: stage)
                            }
                        }
                    }
                    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
                    row["result"] = "success"
                    row["observations"] = String(request.results?.count ?? 0)
                } catch { row["result"] = String(reflecting: error) }
                report.append(row)
                print("JIANWEI_VISION_MATRIX \(row)")
            }
        }
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]),
                                       uniformTypeIdentifier: "public.json")
        attachment.name = "vision-execution-matrix"
        attachment.lifetime = .keepAlways
        add(attachment)
        // Default GPU results are diagnostic, not the app's simulator path.
        // The separate PhotoKit integration test exercises production inference.
        XCTAssertTrue(report.filter { $0["mode"] == "cpu" && $0["request"] != "classification" }
            .allSatisfy { $0["result"] == "success" }, "A required CPU Vision request failed; inspect the matrix")
        #else
        throw XCTSkip("Runtime diagnostics must not operate on the user's device")
        #endif
    }

    func testIsolatedSystemPhotoLibraryReadsAndSanitizesOwnedFixture() async throws {
        try await withSystemPhotoFixture { discovery, reference in
            XCTAssertFalse(reference.isScreenshot)
            let actual = try await discovery.imageData(for: reference)
            let sanitized = try ImageSanitizer().sanitize(actual)
            try JPEGMetadataStripper.requireNoMetadata(sanitized.jpeg)
            XCTAssertLessThanOrEqual(max(sanitized.pixelSize.width, sanitized.pixelSize.height), 1280)
            XCTAssertNotNil(UIImage(data: sanitized.jpeg))
        }
    }

    func testIsolatedSystemPhotoPreparesCardUsingRealPrivacyAnalysis() async throws {
        try await withSystemPhotoFixture { discovery, reference in
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let qwen = SafetyBatchQwen(qualifiedCalls: [1])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: qwen, usesRealVision: true)
            // Diagnose genuine Vision errors directly, rather than hiding them
            // behind the runner's generic retryable status or safe observations.
            let actual = try await discovery.imageData(for: reference)
            let sanitized = try ImageSanitizer().sanitize(actual)
            let privacy = try await PhotoPrivacyAnalyzer().analyze(jpeg: sanitized.jpeg)
            XCTAssertTrue(privacy.sensitiveFlags.isEmpty)
            let runner = AutomaticDiscoveryRunner(environment: environment, widgetStore: widget,
                photoSource: ScopedSystemPhotoSource(source: discovery, identifier: reference.localIdentifier))
            let today = ChinaDay.string(from: Date())
            let summary = await runner.run(maximumCandidates: 9, targetDay: today)
            let state = await environment.repository.snapshot()
            XCTAssertEqual(summary.failed, 0)
            XCTAssertEqual(summary.cardsCreated, 1)
            XCTAssertEqual(state.cards.count, 1)
            XCTAssertEqual(state.candidates.first?.localIdentifier, reference.localIdentifier)
            XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 1)
            XCTAssertEqual(try widget.load().card(for: today)?.id, state.dailyPreparations[today]?.selectedCardID)
            let calls = await qwen.calls()
            XCTAssertEqual(calls.detect, 1, "Only AI is replaced, no user photos or paid API calls")
        }
    }

    func testIsolatedSystemTextPhotoIsFilteredWithoutUploadAndNotSelectedAgain() async throws {
        let jpeg = await MainActor.run {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            return UIGraphicsImageRenderer(size: CGSize(width: 960, height: 800), format: format)
                .jpegData(withCompressionQuality: 1) { context in
                    UIColor.white.setFill()
                    context.fill(CGRect(x: 0, y: 0, width: 960, height: 800))
                    for row in 0..<12 {
                        ("LOCAL PRIVACY TEST DATA \(row)" as NSString).draw(
                            at: CGPoint(x: 32, y: 22 + row * 62),
                            withAttributes: [.font: UIFont.monospacedSystemFont(ofSize: 48, weight: .bold),
                                             .foregroundColor: UIColor.black])
                    }
                }
        }
        try await withSystemPhotoFixture(jpegData: jpeg) { discovery, reference in
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let qwen = SafetyBatchQwen(qualifiedCalls: [1])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: qwen, usesRealVision: true)
            let actual = try await discovery.imageData(for: reference)
            let sanitized = try ImageSanitizer().sanitize(actual)
            let analysis = try await PhotoPrivacyAnalyzer().analyze(jpeg: sanitized.jpeg)
            XCTAssertGreaterThanOrEqual(analysis.qualityScore, 0.35, "Privacy must be the deciding rejection, not blur")
            XCTAssertTrue(analysis.sensitiveFlags.contains("high_text_density"), "Real OCR must detect the generated text")
            let source = ScopedSystemPhotoSource(source: discovery, identifier: reference.localIdentifier)
            let runner = AutomaticDiscoveryRunner(environment: environment, widgetStore: widget, photoSource: source)
            let today = ChinaDay.string(from: Date())
            let summary = await runner.run(maximumCandidates: 9, targetDay: today)
            XCTAssertEqual(summary.filtered, 1)
            XCTAssertEqual(summary.failed, 0)
            let state = await environment.repository.snapshot()
            let candidate = try XCTUnwrap(state.candidates.first)
            XCTAssertEqual(candidate.localIdentifier, reference.localIdentifier)
            XCTAssertEqual(candidate.state, .filtered)
            XCTAssertTrue(candidate.sensitiveFlags.contains("high_text_density"))
            XCTAssertTrue(state.cards.isEmpty)
            XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 0)
            let image = await environment.repository.imageData(candidateToken: candidate.id)
            XCTAssertNil(image, "Filtered image bytes must not remain queued for upload")
            let nextDay = ChinaDay.string(from: ChinaDay.adding(days: 1, to: Date()))
            let repeated = await runner.run(maximumCandidates: 9, targetDay: nextDay)
            XCTAssertEqual(repeated.inspected, 0, "A terminal privacy rejection must not be selected on a later day")
            let calls = await qwen.calls()
            XCTAssertEqual(calls.detect, 0)
            XCTAssertEqual(calls.knowledge, 0)
            XCTAssertEqual(calls.edit, 0)
            XCTAssertEqual(calls.winner, 0)
        }
    }

    private func withSystemPhotoFixture(
        jpegData: Data? = nil,
        _ operation: (PhotoDiscoveryService, PhotoAssetReference) async throws -> Void
    ) async throws {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("Jianwei PhotoKit ") == true else {
            throw XCTSkip("Writes a generated fixture only in an explicitly named Jianwei PhotoKit simulator")
        }
        let discovery = PhotoDiscoveryService()
        let access = await discovery.authorizationState()
        XCTAssertEqual(access, .full, "Grant Photos on this isolated simulator before this test")
        guard access == .full else { throw ProductError.permissionDenied }
        let identifiers = SafetySecrets()
        let jpeg: Data
        if let jpegData { jpeg = jpegData } else { jpeg = await makeBatchJPEG(index: 0) }
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.creationDate = Date()
            request.addResource(with: .photo, data: jpeg, options: nil)
            try? identifiers.set(request.placeholderForCreatedAsset?.localIdentifier ?? "", for: "fixture")
        }
        let identifier = try XCTUnwrap(identifiers.string(for: "fixture"))
        // System deletion needs a separate confirmation UI. Keep the owned
        // fixture in this disposable simulator, never automate a user's album.
        let attachment = XCTAttachment(string: identifier)
        attachment.name = "owned-synthetic-photokit-fixture"
        attachment.lifetime = .keepAlways
        add(attachment)
        let references = try await discovery.recentAssets(days: 90, limit: 500)
        let reference = try XCTUnwrap(references.first { $0.localIdentifier == identifier })
        try await operation(discovery, reference)
        #else
        throw XCTSkip("Never modifies a physical device's photo library")
        #endif
    }

    func testPauseResumeDoesNotReviveOldRunOrReleaseItsExclusiveSlot() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let old = try XCTUnwrap(acquired)
        try await repository.setAutomaticDiscovery(false)
        try await repository.setAutomaticDiscovery(true)
        XCTAssertThrowsError(try old.check()) { XCTAssertTrue($0 is CancellationError) }
        let overlapping = await repository.acquireAutomaticDiscoveryRun { _ in true }
        XCTAssertNil(overlapping)
        await repository.endAutomaticDiscoveryRun(old)
        let replacement = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let current = try XCTUnwrap(replacement)
        await repository.endAutomaticDiscoveryRun(old)
        try await repository.validateAutomaticDiscoveryRun(current)
        await repository.endAutomaticDiscoveryRun(current)
    }

    func testCancelBeforeTaskRegistrationStillCancelsTheTask() async throws {
        let run = AutomaticDiscoveryRun { _ in true }
        let gate = SafetySuspension()
        let work = Task {
            await gate.wait()
            return Task.isCancelled
        }
        run.cancel()
        run.installCancellationHandler { work.cancel() }
        await gate.resume()
        let cancelled = await work.value
        XCTAssertTrue(cancelled)
    }

    func testDeletionRejectsEveryLateWriteIncludingFailureImagesAndCheckpoints() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate()
        let card = makeCard(candidate: candidate, index: 0)
        try await repository.deleteLocalData()
        // Re-enabling exercises the ABA race: checking the Boolean is not enough.
        try await repository.setAutomaticDiscovery(true)
        let writes: [@Sendable () async throws -> Void] = [
            { try await repository.upsert(candidate: candidate, discoveryRun: run) },
            { try await repository.upsert(candidate: candidate, card: card, sanitizedJPEG: Data([1]), discoveryRun: run) },
            { try await repository.storeImage(Data([1]), candidateToken: candidate.id, discoveryRun: run) },
            { try await repository.removeImage(candidateToken: candidate.id, discoveryRun: run) },
            { try await repository.deferUnavailableFailedCandidates(candidateIDs: [candidate.id], discoveryRun: run) },
            { try await repository.savePreparation(DailyPreparationRecord(day: "2026-09-05", status: .preparing), discoveryRun: run) },
            { try await repository.finalizeDailySelection(day: "2026-09-05", selectedCardID: card.id,
                candidateIDs: [candidate.id], scannedAt: Date(), discoveryRun: run) },
            { _ = try await repository.adoptKnowledgeCatalogRevision("late", discoveryRun: run) },
            { try await repository.reserveDiscoveryInspection(day: "2026-09-05", run: run) },
            { try await repository.reserveDiscoveryCloudPhoto(day: "2026-09-05", run: run) },
            { _ = try await repository.checkpointManagedPhoto(candidate: candidate, sanitizedJPEG: Data([1]), day: "2026-09-05", run: run) }
        ]
        for write in writes {
            do { try await write(); XCTFail("A stale run wrote after deletion") }
            catch { XCTAssertTrue(error is CancellationError) }
        }
        var wroteWidget = false
        XCTAssertThrowsError(try run.commitWidget { wroteWidget = true })
        XCTAssertFalse(wroteWidget)
        let state = await repository.snapshot()
        let image = await repository.imageData(candidateToken: candidate.id)
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertTrue(state.candidates.isEmpty)
        XCTAssertTrue(state.dailyPreparations.isEmpty)
        XCTAssertNil(image)
        await repository.endAutomaticDiscoveryRun(run)
    }

    func testRevokedLimitedAssetCannotUploadACachedRetry() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        let candidate = makeCandidate()
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { identifier in identifier == nil }
        let run = try XCTUnwrap(acquired)
        let jpeg = await makeJPEG()
        do {
            _ = try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day, discoveryRun: run)
            XCTFail("Removed limited-library asset was uploaded")
        } catch {
            XCTAssertEqual(error as? ProductError, .photoUnavailable)
        }
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
        await environment.repository.endAutomaticDiscoveryRun(run)
    }

    func testRemovingOneLimitedPhotoDoesNotRevokeOtherPhotosOrTheRun() throws {
        let run = AutomaticDiscoveryRun { identifier in identifier != "removed-photo" }
        XCTAssertThrowsError(try run.check(localIdentifier: "removed-photo")) {
            XCTAssertEqual($0 as? ProductError, .photoUnavailable)
        }
        XCTAssertNoThrow(try run.check())
        XCTAssertNoThrow(try run.check(localIdentifier: "still-authorized-photo"))
    }

    func testPauseDuringDetectionStopsTheNextUploadAndRetainsReservedBudget() async throws {
        try await assertSuspendedDetectionStops(after: .pause)
    }

    func testDeleteDuringDetectionDoesNotTurnLateFailureIntoRetryableData() async throws {
        try await assertSuspendedDetectionStops(after: .delete)
    }

    func testRevokeDuringDetectionStopsTheNextUpload() async throws {
        try await assertSuspendedDetectionStops(after: .revoke)
    }

    private enum Interruption { case pause, delete, revoke }

    private func assertSuspendedDetectionStops(after interruption: Interruption) async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .detect, detectionError: interruption == .delete ? .requestFailed(503) : nil)
        let environment = try await makeEnvironment(root: root, service: service)
        let access = SafetyPermission()
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in access.allowed }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate()
        let jpeg = await makeJPEG()
        let day = self.day
        let work = Task {
            try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day, discoveryRun: run)
        }
        await fulfillment(of: [service.entered], timeout: 3)
        switch interruption {
        case .pause:
            try await environment.repository.setAutomaticDiscovery(false)
            try await environment.repository.setAutomaticDiscovery(true)
        case .delete:
            try await environment.repository.deleteLocalData()
        case .revoke:
            access.revoke()
        }
        await service.resume()
        do {
            _ = try await work.value
            XCTFail("A late detection result escaped the invalidated pipeline")
        } catch {
            XCTAssertFalse(error is PipelineFailure, "Cancellation must not create a retryable image")
            if interruption == .revoke {
                XCTAssertEqual(error as? ProductError, .permissionDenied)
            } else {
                XCTAssertTrue(error is CancellationError)
            }
        }
        let calls = await service.calls()
        let state = await environment.repository.snapshot()
        XCTAssertEqual(calls.detect, 1)
        XCTAssertEqual(calls.edit, 0)
        XCTAssertEqual(calls.winner, 0)
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertTrue(state.candidates.isEmpty)
        if interruption == .delete {
            XCTAssertTrue(state.dailyPreparations.isEmpty)
        } else {
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        }
        await environment.repository.endAutomaticDiscoveryRun(run)
    }

    func testPauseWhileEditorialReturnsNilDoesNotUploadTheNextSubject() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .edit)
        let environment = try await makeEnvironment(root: root, service: service)
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate()
        let jpeg = await makeJPEG()
        let day = self.day
        let work = Task {
            try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day, discoveryRun: run)
        }
        await fulfillment(of: [service.entered], timeout: 3)
        try await environment.repository.setAutomaticDiscovery(false)
        await service.resume()
        do { _ = try await work.value; XCTFail("Editorial cancellation was swallowed") }
        catch { XCTAssertTrue(error is CancellationError) }
        let calls = await service.calls()
        XCTAssertEqual(calls.edit, 1)
        XCTAssertEqual(calls.winner, 0)
        await environment.repository.endAutomaticDiscoveryRun(run)
    }

    func testCloudPrivacyRejectionFromAnalyzeAndRetryStaysTerminalAcrossCatalogRevision() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true)
        let jpeg = await makeJPEG()
        for retry in [false, true] {
            let candidate = makeCandidate()
            let rejection: PipelineRejection
            do {
                if retry {
                    _ = try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day)
                } else {
                    _ = try await environment.pipeline.analyze(sourceData: jpeg, localIdentifier: candidate.localIdentifier,
                                                              capturedAt: nil, targetDay: day)
                }
                XCTFail("Cloud privacy must not become exhausted or retryable")
                continue
            } catch let error as PipelineRejection {
                rejection = error
            }
            XCTAssertEqual(rejection.candidate.state, .filtered)
            XCTAssertEqual(rejection.candidate.sensitiveFlags, ["cloud_privacy"])
            try await environment.repository.upsert(candidate: rejection.candidate)
            let reopened = try await environment.repository.adoptKnowledgeCatalogRevision(UUID().uuidString)
            let state = await environment.repository.snapshot()
            XCTAssertEqual(reopened, 0)
            XCTAssertEqual(state.candidates.first { $0.id == rejection.candidate.id }?.state, .filtered)
            XCTAssertTrue(state.processedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
            XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
            let image = await environment.repository.imageData(candidateToken: rejection.candidate.id)
            XCTAssertNil(image)
        }
    }

    @MainActor
    func testUnclassifiedManagedResultKeepsPhotoRetryableAndPreviousCardVisible() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
            sharedStore: widget, transport: SafetyUnclassifiedInsightURLProtocol.self)
        var oldCandidate = makeCandidate()
        oldCandidate.state = .selected
        let oldCard = makeCard(candidate: oldCandidate, index: 0)
            .withPresentation(status: "shown", scheduledDay: "2026-09-04")
        try await environment.repository.upsert(candidate: oldCandidate, card: oldCard, sanitizedJPEG: makeJPEG())
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 1))
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        let candidate = try XCTUnwrap(state.candidates.first { $0.localIdentifier == "synthetic-new-0" })
        XCTAssertEqual(summary.failed, 1)
        XCTAssertEqual(summary.cardsCreated, 0)
        XCTAssertEqual(candidate.state, .failed, "An unclassified server result is not a final judgment about the photo")
        XCTAssertFalse(state.exhaustedLocalIdentifiers.contains("synthetic-new-0"))
        XCTAssertEqual(state.dailyPreparations[day]?.status, .retryableFailure)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1, "Keep the attempted-photo reservation; do not refund unknown usage")
        let retryImage = await environment.repository.imageData(candidateToken: candidate.id)
        XCTAssertNotNil(retryImage)
        XCTAssertEqual(state.cards.map(\.id), [oldCard.id])
        XCTAssertEqual(try widget.load().mostRecentCard(onOrBefore: day)?.id, oldCard.id)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0, "A managed failure must not fall back to the user's Key")
    }

    @MainActor
    func testManagedLegacyRepeatsContinueToFourthPhotoAndKeepHistory() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        SafetyRepeatedInsightURLProtocol.reset()
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
            sharedStore: widget, transport: SafetyRepeatedInsightURLProtocol.self)
        var oldCandidate = makeCandidate()
        oldCandidate.state = .selected
        let old = makeCard(candidate: oldCandidate, index: 0).withPresentation(status: "shown", scheduledDay: "2026-09-04")
        let oldImage = makeJPEG()
        try await environment.repository.upsert(candidate: oldCandidate, card: old, sanitizedJPEG: oldImage)
        try await environment.repository.setSaved(true, cardID: old.id)
        for index in 1...105 {
            let historical = makeCard(candidate: makeCandidate(), index: index)
                .withPresentation(status: "shown", scheduledDay: "2026-09-03")
            try await environment.repository.upsert(card: historical, sanitizedJPEG: nil)
        }
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 4))
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.analyzed, 4, "Three repeats must not fill today's three-card pool")
        XCTAssertEqual(summary.exhausted, 3)
        XCTAssertEqual(summary.failed, 0)
        XCTAssertEqual(summary.knowledgeReady, 1)
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.cards.count, 107, "Include all retained history, not only the most recent 100 cards")
        XCTAssertEqual(state.candidates.filter { $0.state == .exhausted }.count, 3)
        XCTAssertEqual(state.cards.first { $0.id == old.id }, old)
        XCTAssertEqual(state.savedCardIDs, [old.id])
        let retainedImage = await environment.repository.imageData(candidateToken: old.candidateToken)
        XCTAssertEqual(retainedImage, oldImage)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 4)
        XCTAssertEqual(state.dailyPreparations[day]?.qualifiedCardIDs.count, 1)
        let current = try XCTUnwrap(try widget.load().mostRecentCard(onOrBefore: day))
        XCTAssertNotEqual(current.id, old.id)
        XCTAssertEqual(current.body, SafetyRepeatedInsightURLProtocol.novelBody)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
        let again = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(again.analyzed, 0, "Restarting a finished day must not repeat the four charges")
    }

    func testExhaustedCloudBudgetFinalizesPreparingWithoutModelOrPhotoAccess() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 9))
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        XCTAssertEqual(summary.analyzed, 0)
        XCTAssertEqual(summary.failed, 0)
        XCTAssertEqual(calls.detect, 0)
        XCTAssertEqual(calls.winner, 0)
    }

    func testZeroBudgetStillPublishesACarryoverCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 1, environment: environment)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 9))
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 0, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards.first?.id)
    }

    func testPrematureEmptyDayRecoversOnlyOnItsDateAndRetainsSpentAttemptsAcrossRestart() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        let now = ISO8601DateFormatter().date(from: "2026-09-08T00:00:00Z")!
        let oldAttempt = ISO8601DateFormatter().date(from: "2026-09-04T18:25:15Z")!
        let today = "2026-09-08"
        for day in ["2026-09-07", today, "2026-09-09"] {
            try await repository.savePreparation(DailyPreparationRecord(
                day: day, status: .noNewCard, inspectedPhotoCount: 34,
                aiPhotoCount: 9, lastAttemptAt: oldAttempt
            ))
        }
        let original = await repository.snapshot()
        let recovered = try await repository.recoverPrematureEmptyPreparation(now: now)
        XCTAssertTrue(recovered)
        var snapshot = await repository.snapshot()
        XCTAssertEqual(snapshot.dailyPreparations[today]?.status, .queued)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.aiPhotoCount, 0)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.inspectedPhotoCount, 0)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.previousAdvanceAttempt?.aiPhotoCount, 9)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.previousAdvanceAttempt?.inspectedPhotoCount, 34)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.previousAdvanceAttempt?.lastAttemptAt, oldAttempt)
        XCTAssertEqual(snapshot.dailyPreparations["2026-09-07"], original.dailyPreparations["2026-09-07"])
        XCTAssertEqual(snapshot.dailyPreparations["2026-09-09"]?.status, .queued)
        XCTAssertEqual(snapshot.dailyPreparations["2026-09-09"]?.previousAdvanceAttempt?.aiPhotoCount, 9)
        let reopened = try LocalRepository(rootURL: root)
        let run = await reopened.acquireAutomaticDiscoveryRun(authorizationCheck: { _ in true })
        let acquired = try XCTUnwrap(run)
        for _ in 0..<9 { try await reopened.reserveDiscoveryCloudPhoto(day: today, run: acquired) }
        do {
            try await reopened.reserveDiscoveryCloudPhoto(day: today, run: acquired)
            XCTFail("Recovery must not disable the nine-photo allowance")
        } catch { XCTAssertEqual(error as? ProductError, .dailyAnalysisLimitReached) }
        try await reopened.finalizeDailySelection(day: today, selectedCardID: nil, candidateIDs: [],
                                                  aiPhotoCount: 9, scannedAt: now, discoveryRun: acquired)
        await reopened.endAutomaticDiscoveryRun(acquired)
        let retriedRecovery = try await reopened.recoverPrematureEmptyPreparation(now: now)
        XCTAssertFalse(retriedRecovery)
        snapshot = await reopened.snapshot()
        XCTAssertEqual(snapshot.dailyPreparations[today]?.aiPhotoCount, 9)
        XCTAssertEqual(snapshot.dailyPreparations[today]?.previousAdvanceAttempt?.aiPhotoCount, 9)
        XCTAssertEqual(snapshot.cards, original.cards)
        XCTAssertEqual(snapshot.processedLocalIdentifiers, original.processedLocalIdentifiers)
    }

    func testEmptyDayRecoveryDoesNotReopenSameDayReadyPausedOrUnprovenRecords() async throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-08T00:00:00Z")!
        for scenario in ["same-day", "ready", "paused", "unknown-time"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setAutomaticDiscovery(scenario != "paused")
            try await repository.savePreparation(DailyPreparationRecord(
                day: "2026-09-08", status: scenario == "ready" ? .ready : .noNewCard, aiPhotoCount: 9,
                lastAttemptAt: scenario == "unknown-time" ? nil
                    : (scenario == "same-day" ? now : ChinaDay.adding(days: -1, to: now))
            ))
            let bytes = try Data(contentsOf: root.appendingPathComponent("state.json"))
            let recovered = try await repository.recoverPrematureEmptyPreparation(now: now)
            XCTAssertFalse(recovered, scenario)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("state.json")), bytes, scenario)
        }
    }

    @MainActor
    func testForegroundAutomaticallyPublishesAfterLegacyFutureFailureWithoutUserSelectingPhoto() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let now = Date()
        let today = ChinaDay.string(from: now)
        let tomorrow = ChinaDay.string(from: ChinaDay.adding(days: 1, to: now))
        for day in [today, tomorrow] {
            try await environment.repository.savePreparation(DailyPreparationRecord(
                day: day, status: .noNewCard, inspectedPhotoCount: 34, aiPhotoCount: 9,
                lastAttemptAt: ChinaDay.adding(days: -3, to: now)
            ))
        }
        let source = await makeBatchSource(count: 1)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let model = AppModel(environment: environment, launchArguments: ["-JianweiStorefrontPreview"],
                             automaticRunner: runner, photoAccessCheck: { .full })
        await model.start()
        await model.resumeFromBackground()
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1)
        XCTAssertEqual(state.dailyPreparations[today]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 1)
        XCTAssertEqual(state.dailyPreparations[today]?.previousAdvanceAttempt?.aiPhotoCount, 9)
        XCTAssertNotNil(model.currentCard)
        XCTAssertEqual(model.currentCard?.id, try widget.load().card(for: today)?.id)
        XCTAssertEqual(model.historyCards.count, 1)
        XCTAssertEqual(state.dailyPreparations[tomorrow]?.status, .waitingForPhotos)
        XCTAssertEqual(state.dailyPreparations[tomorrow]?.previousAdvanceAttempt?.aiPhotoCount, 9)
    }

    func testRepeatedEmptyDaySchedulingPreservesUsageHistoryAndDoesNotDispatchTomorrow() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        let now = ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z")!
        let runner = try makeRunner(environment: environment, root: root)
        // Finish the ninth suspended attempt through the real runner. This
        // also adopts the catalog before the byte-preservation comparison.
        try await environment.repository.savePreparation(DailyPreparationRecord(
            day: day, status: .preparing, inspectedPhotoCount: 15, aiPhotoCount: 9
        ))
        _ = await runner.run(maximumCandidates: 0, targetDay: day)
        // Compare two disk-loaded snapshots: the store's ISO-8601 encoding
        // intentionally drops subsecond Date precision from the live snapshot.
        let baselineRepository = try LocalRepository(rootURL: root)
        let prepared = await baselineRepository.snapshot()
        XCTAssertEqual(prepared.dailyPreparations[day]?.status, .noNewCard)
        let original = try Data(contentsOf: root.appendingPathComponent("state.json"))

        for _ in 0..<8 {
            let snapshot = await environment.repository.snapshot()
            let target = BackgroundDiscoveryController.nextPreparationDay(state: snapshot, now: now)
            let summary = await runner.run(maximumCandidates: 9, targetDay: target)
            XCTAssertEqual(target, day)
            XCTAssertEqual(summary.analyzed, 0)
            XCTAssertEqual(summary.inspected, 0)
            XCTAssertEqual(summary.failed, 0)
        }

        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(state.dailyPreparations, prepared.dailyPreparations)
        XCTAssertEqual(state.dailyPreparations.count, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
        XCTAssertEqual(calls.detect, 0)
        XCTAssertEqual(calls.edit, 0)
        XCTAssertEqual(calls.winner, 0)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("state.json")), original)
    }

    func testWidgetWriteFailureRetainsPreparedDayAndRestartRepairsWithoutNewAI() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .winner)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let old = try await seedPreviousCard(environment: environment)
        let cards = try await seedCarryover(count: 3, environment: environment)
        try await environment.widgetCoordinator.synchronize()
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true }, widgetStore: widget)
        let day = ChinaDay.string(from: Date())
        let work = Task { await runner.run(maximumCandidates: 9, targetDay: day) }
        await fulfillment(of: [service.entered], timeout: 3)

        // Fail a real shared-cache write after selection has started, without
        // corrupting the previous state or touching any device/App Group data.
        let parkedThumbnails = root.appendingPathComponent("parked-thumbnails")
        try FileManager.default.moveItem(at: widget.thumbnailDirectoryURL, to: parkedThumbnails)
        try Data("synthetic filesystem obstruction".utf8).write(to: widget.thumbnailDirectoryURL)
        await service.resume()
        let failed = await work.value
        let prepared = await environment.repository.snapshot()
        XCTAssertEqual(failed.failed, 1, "A failed widget write cannot be reported as successful background work")
        XCTAssertEqual(failed.accessError, .widgetSyncUnavailable)
        XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: true, accessError: failed.accessError))
        let message = DiscoveryRunMessage.text(for: failed, maximumCandidates: 9, hasCurrentCard: true)
        XCTAssertTrue(message.contains("新知识卡已保存在本机"))
        XCTAssertFalse(message.contains("将按日期展示"), "Do not promise widget delivery after its write failed")
        XCTAssertEqual(failed.cardsCreated, 1, "Keep the already-committed card and accurate preparation count")
        XCTAssertEqual(prepared.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(prepared.dailyPreparations[day]?.selectedCardID, cards[0].id)
        XCTAssertEqual(try widget.load().mostRecentCard(onOrBefore: day)?.id, old.id, "The previous cache must survive the failure")

        try FileManager.default.removeItem(at: widget.thumbnailDirectoryURL)
        try FileManager.default.moveItem(at: parkedThumbnails, to: widget.thumbnailDirectoryURL)
        let restarted = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let recovery = AutomaticDiscoveryRunner(environment: restarted, authorizationCheck: { _ in true }, widgetStore: widget)
        let repaired = await recovery.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(repaired.failed, 0)
        XCTAssertNil(repaired.accessError)
        XCTAssertEqual(repaired.analyzed, 0)
        XCTAssertEqual(repaired.cardsCreated, 0, "Projection recovery is not a second newly generated card")
        XCTAssertEqual(try widget.load().card(for: day)?.id, cards[0].id)
        XCTAssertTrue(try widget.load().cards.contains { $0.id == old.id })
        let state = await restarted.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, prepared.dailyPreparations[day]?.selectedCardID)
        XCTAssertEqual(state.dailyPreparations[day]?.qualifiedCardIDs, prepared.dailyPreparations[day]?.qualifiedCardIDs)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, prepared.dailyPreparations[day]?.aiPhotoCount)
        XCTAssertEqual(state.dailyPreparations[day]?.inspectedPhotoCount, prepared.dailyPreparations[day]?.inspectedPhotoCount)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge, 0)
        XCTAssertEqual(calls.winner, 1, "Repair must not repeat the successful ranking request")
    }

    func testFullRollingCacheRepairsWidgetEvenWithNoNewPhotoBudget() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let old = try await seedPreviousCard(environment: environment)
        try await environment.widgetCoordinator.synchronize()
        let cards = try await seedCarryover(count: 7, environment: environment)
        let now = Date()
        var days: [String] = []
        for (offset, card) in cards.enumerated() {
            let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
            days.append(day)
            try await environment.repository.finalizeDailySelection(
                day: day, selectedCardID: card.id, candidateIDs: [card.candidateToken], scannedAt: now)
        }
        let before = await environment.repository.snapshot()
        let source = await makeBatchSource(count: 1)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let result = await runner.replenishRollingWindow(maximumCandidates: 0)
        XCTAssertEqual(result.failed, 0)
        XCTAssertEqual(result.analyzed, 0)
        XCTAssertEqual(result.cardsCreated, 0)
        let queue = try widget.load()
        for (day, card) in zip(days, cards) {
            XCTAssertEqual(queue.card(for: day)?.id, card.id, "A complete local queue must still repair stale shared state")
        }
        XCTAssertTrue(queue.cards.contains { $0.id == old.id })
        let after = await environment.repository.snapshot()
        XCTAssertEqual(after.dailyPreparations, before.dailyPreparations)
        let queries = await source.queryLimits()
        XCTAssertTrue(queries.isEmpty)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
    }

    func testUnavailableWidgetStorageStopsRefillBeforeNewPhotoOrModelWork() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("widget"), withIntermediateDirectories: true)
        try Data("synthetic filesystem obstruction".utf8).write(to: widget.thumbnailDirectoryURL)
        let before = await environment.repository.snapshot()
        let source = await makeBatchSource(count: 1)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let result = await runner.replenishRollingWindow(maximumCandidates: 27)
        XCTAssertEqual(result.failed, 1)
        XCTAssertEqual(result.accessError, .widgetSyncUnavailable)
        XCTAssertEqual(result.analyzed, 0)
        let after = await environment.repository.snapshot()
        XCTAssertEqual(after.dailyPreparations, before.dailyPreparations)
        let queries = await source.queryLimits()
        let reads = await source.readIDs()
        XCTAssertTrue(queries.isEmpty)
        XCTAssertTrue(reads.isEmpty)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
    }

    @MainActor
    func testHomeReportsWidgetSyncFailureAndClearsItAfterLocalRecovery() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        try await environment.repository.setAutomaticDiscovery(false)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.start()
        let cards = try await seedCarryover(count: 1, environment: environment)
        let card = try XCTUnwrap(cards.first)
        let today = ChinaDay.string(from: Date())
        try await environment.repository.finalizeDailySelection(
            day: today, selectedCardID: card.id, candidateIDs: [card.candidateToken], scannedAt: Date())
        try await environment.repository.setAutomaticDiscovery(true)
        try FileManager.default.removeItem(at: widget.thumbnailDirectoryURL)
        try Data("synthetic filesystem obstruction".utf8).write(to: widget.thumbnailDirectoryURL)

        await model.refreshPresentationState()
        XCTAssertFalse(model.widgetProjectionReady)
        XCTAssertEqual(model.preparationSummary, "小组件等待同步")
        XCTAssertTrue(model.preparationPresentation.needsAttention)
        XCTAssertEqual(model.preparationPresentation.action, .retry)
        XCTAssertEqual(model.state.dailyPreparations[today]?.selectedCardID, card.id)

        try FileManager.default.removeItem(at: widget.thumbnailDirectoryURL)
        await model.refreshPresentationState()
        XCTAssertTrue(model.widgetProjectionReady)
        XCTAssertEqual(model.currentCard?.id, card.id)
        XCTAssertEqual(try widget.load().card(for: today)?.id, card.id)
        XCTAssertFalse(model.preparationPresentation.needsAttention)
        XCTAssertEqual(model.preparationSummary, "今天的知识已就绪")
        XCTAssertEqual(model.preparedFutureDayCount, 0, "Repairing today's projection does not prepare tomorrow")
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
    }

    func testThreeCarryoverCardsSelectWithoutInspectingOrUploadingNewPhotos() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(summary.inspected, 0)
        XCTAssertEqual(summary.analyzed, 0)
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(calls.detect, 0)
        XCTAssertEqual(calls.winner, 1)
        XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
    }

    func testCachedWinnerPublishesWhenSelectionServiceFailsWithoutResendingPhotos() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(winnerError: .requestFailed(503))
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let old = try await seedPreviousCard(environment: environment)
        _ = try await environment.repository.recordFeedback(cardID: cards[2].id, action: .like)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let queue = try widget.load()
        XCTAssertEqual(summary.accessError, .requestFailed(503), "Keep the actual service failure in diagnostics")
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[2].id, "Use existing topic preferences for the local fallback")
        XCTAssertEqual(queue.card(for: day)?.id, cards[2].id)
        XCTAssertTrue(state.cards.contains { $0.id == old.id })
        XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
        XCTAssertEqual(queue.remainingSwaps(on: day), 2)
        _ = await runner.run(maximumCandidates: 9, targetDay: day)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge, 0)
        XCTAssertEqual(calls.winner, 1, "A ready date must not repeat the failed ranking call")
    }

    @MainActor
    func testAutomaticHomeShowsCachedWinnerAndReportsPartialSuccessWhenServiceFails() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(winnerError: .requestFailed(503))
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let old = try await seedPreviousCard(environment: environment)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true }, widgetStore: widget)
        let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        await model.replenishRollingCache(showResult: true)
        XCTAssertEqual(model.currentCard?.id, cards[0].id)
        XCTAssertEqual(model.widgetQueueState.card(for: ChinaDay.string(from: Date()))?.id, cards[0].id)
        XCTAssertTrue(model.historyCards.contains { $0.id == old.id })
        XCTAssertFalse(model.isWorking)
        XCTAssertTrue(model.message?.contains("已准备 1 天的新知识卡") == true)
        XCTAssertTrue(model.message?.contains("后续准备暂时受阻") == true)
        XCTAssertFalse(model.message?.contains("最有趣") == true, "Local availability fallback is not an AI quality judgment")
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge, 0)
        XCTAssertEqual(calls.winner, 1, "Do not try to fill another date after a service failure")
    }

    func testTwoCachedCardsPublishAfterTopUpNetworkFailureWithoutRankingRequest() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(detectionError: .requestFailed(URLError.notConnectedToInternet.rawValue))
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 2, environment: environment)
        let candidate = makeCandidate()
        try await environment.repository.upsert(candidate: candidate)
        try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
        let summary = try await makeRunner(environment: environment, root: root).run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
        XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .failed)
        XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1)
        XCTAssertEqual(calls.winner, 0)
    }

    func testCachedCardsSurviveMissingKeyBeforeTopUpWithoutAnyCloudCalls() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen()
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 2, environment: environment)
        try await environment.modelAccessStore.removeQwenAPIKey()
        let summary = try await makeRunner(environment: environment, root: root).run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.accessError, .apiKeyRequired)
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 0)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect + calls.edit + calls.knowledge + calls.winner, 0)
    }

    func testWinnerAccessFailurePublishesCachedCardAndPreservesHistoryWithoutNewPhotos() async throws {
        for error in [ProductError.apiKeyRejected, .modelAccountBillingUnavailable,
                      .modelFreeQuotaExhausted, .modelAccessUnavailable, .managedIdentityRecoveryRequired] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyQwen(winnerError: error)
            let environment = try await makeEnvironment(root: root, service: service)
            let cards = try await seedCarryover(count: 3, environment: environment)
            var previousCandidate = makeCandidate()
            previousCandidate.state = .selected
            let previous = makeCard(candidate: previousCandidate, index: 99)
                .withPresentation(status: "scheduled", scheduledDay: "2026-09-04")
            try await environment.repository.upsert(candidate: previousCandidate, card: previous, sanitizedJPEG: Data())
            try await environment.repository.savePreparation(DailyPreparationRecord(
                day: day, status: .preparing, inspectedPhotoCount: 12, aiPhotoCount: 9
            ))
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true }, widgetStore: widget)
            let failure = await runner.run(maximumCandidates: 9, targetDay: day)
            XCTAssertEqual(failure.accessError, error)
            XCTAssertEqual(failure.failed, 1)
            XCTAssertFalse(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: failure.accessError))

            let reopened = try LocalRepository(rootURL: root)
            let state = await reopened.snapshot()
            XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
            XCTAssertEqual(state.dailyPreparations[day]?.inspectedPhotoCount, 12)
            XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
            XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
            XCTAssertEqual(state.cards.count, 4)
            XCTAssertTrue(state.cards.filter { $0.id != previous.id }.allSatisfy { $0.scheduledDay == day })
            XCTAssertEqual(state.cards.filter { $0.status == "candidate" }.count, 2)
            let queue = try widget.load()
            let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z"))
            XCTAssertEqual(queue.card(for: day)?.id, cards[0].id)
            XCTAssertEqual(queue.mostRecentCard(onOrBefore: day)?.id, cards[0].id)
            XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue, activeCardID: nil, now: now)?.id, cards[0].id)
            XCTAssertEqual(queue.remainingSwaps(on: day), 2)
            XCTAssertTrue(CardHistoryResolver.resolve(cards: state.cards, presentations: queue.presentations, now: now)
                .contains { $0.id == previous.id })

            await service.clearWinnerError()
            let recovered = await runner.run(maximumCandidates: 9, targetDay: day)
            XCTAssertNil(recovered.accessError)
            XCTAssertEqual(recovered.cardsCreated, 0, "The cached winner already finalized this date")
            XCTAssertEqual(recovered.inspected, 0)
            XCTAssertEqual(recovered.analyzed, 0)
            let ready = await environment.repository.snapshot()
            XCTAssertEqual(ready.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(ready.dailyPreparations[day]?.aiPhotoCount, 9)
            XCTAssertEqual(Set(ready.cards.map(\.id)), Set(cards.map(\.id) + [previous.id]))
            let repeated = await runner.run(maximumCandidates: 9, targetDay: day)
            XCTAssertEqual(repeated.analyzed, 0)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0)
            XCTAssertEqual(calls.edit, 0)
            XCTAssertEqual(calls.winner, 1, "A ready date needs neither another selection nor another photo")
        }
    }

    func testWinnerTransientFailureRetainsItsCauseButDoesNotBlockCachedPublication() async throws {
        for error in [ProductError.requestFailed(429), .requestFailed(URLError.timedOut.rawValue), .invalidServerResponse, .managedServiceUnavailable] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyQwen(winnerError: error)
            let environment = try await makeEnvironment(root: root, service: service)
            let cards = try await seedCarryover(count: 3, environment: environment)
            let runner = try makeRunner(environment: environment, root: root)
            let summary = await runner.run(maximumCandidates: 9, targetDay: day)
            XCTAssertEqual(summary.accessError, error)
            XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: summary.accessError))
            let state = await environment.repository.snapshot()
            XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
            XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
            XCTAssertEqual(summary.analyzed, 0)
        }
    }

    func testEditorialAccountFailureStopsBeforeTheNextObjectOrWinnerRequest() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(editorialError: .modelFreeQuotaExhausted)
        let environment = try await makeEnvironment(root: root, service: service)
        let candidate = makeCandidate()
        try await environment.repository.upsert(candidate: candidate)
        try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(summary.accessError, .modelFreeQuotaExhausted)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1)
        XCTAssertEqual(calls.edit, 1, "A second object cannot cure the same account failure")
        XCTAssertEqual(calls.knowledge, 0)
        XCTAssertEqual(calls.winner, 0)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .waitingForAccess)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .failed)
        XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
        let retainedImage = await environment.repository.imageData(candidateToken: candidate.id)
        XCTAssertNotNil(retainedImage)
    }

    func testAccountFailureWhileToppingUpKeepsQualifiedCardsWithoutAnotherModelCall() async throws {
        for count in [1, 2] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyQwen(detectionError: .modelAccessUnavailable)
            let environment = try await makeEnvironment(root: root, service: service)
            let cards = try await seedCarryover(count: count, environment: environment)
            let candidate = makeCandidate()
            try await environment.repository.upsert(candidate: candidate)
            try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
            let runner = try makeRunner(environment: environment, root: root)
            let summary = await runner.run(maximumCandidates: 9, targetDay: day)
            XCTAssertEqual(summary.accessError, .modelAccessUnavailable)
            XCTAssertEqual(summary.failed, 1, "Skipped selection is not another failed request")
            let state = await environment.repository.snapshot()
            XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
            XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(summary.cardsCreated, 1)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 1)
            XCTAssertEqual(calls.edit, 0)
            XCTAssertEqual(calls.winner, 0, "Already-qualified cards can be selected locally without another paid call")
        }
    }

    func testEmptyWinnerResponsePublishesQualifiedCardEvenAtNinePhotoLimit() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(noWinner: true)
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 9))
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(summary.accessError, .invalidServerResponse)
        XCTAssertEqual(summary.failed, 1)
        XCTAssertEqual(summary.cardsCreated, 1)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(Set(state.dailyPreparations[day]?.qualifiedCardIDs ?? []), Set(cards.map(\.id)))
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
    }

    func testLastLocalInspectionIsSharedWithCachedRetriesAndSurvivesRestart() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(noSubjects: true)
        let environment = try await makeEnvironment(root: root, service: service)
        let candidate = makeCandidate()
        let jpeg = await makeJPEG()
        try await environment.repository.upsert(candidate: candidate)
        try await environment.repository.storeImage(jpeg, candidateToken: candidate.id)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, inspectedPhotoCount: 71))
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        XCTAssertEqual(summary.inspected, 1)
        XCTAssertEqual(summary.analyzed, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.inspectedPhotoCount, 72)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingInspectionBudget(previous: 72), 0)
    }

    func testCloudReservationsCannotExceedNineAfterRestart() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setAutomaticDiscovery(true)
        try await repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 8))
        let acquired = await repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        try await repository.reserveDiscoveryCloudPhoto(day: day, run: run)
        await repository.endAutomaticDiscoveryRun(run)
        let reopened = try LocalRepository(rootURL: root)
        let nextAcquired = await reopened.acquireAutomaticDiscoveryRun { _ in true }
        let next = try XCTUnwrap(nextAcquired)
        do {
            try await reopened.reserveDiscoveryCloudPhoto(day: day, run: next)
            XCTFail("Restart reset the cloud budget")
        } catch {
            XCTAssertEqual(error as? ProductError, .dailyAnalysisLimitReached)
        }
        await reopened.endAutomaticDiscoveryRun(next)
    }

    func testRejectedManagedDispatchDoesNotConsumeFuturePhotoBudgetOrRetryOnRelaunch() async throws {
        for previousCount in [0, 8] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            SafetyDispatchQuotaURLProtocol.reset()
            let service = SafetyQwen()
            let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
                transport: SafetyDispatchQuotaURLProtocol.self)
            let candidate = makeCandidate()
            try await environment.repository.upsert(candidate: candidate)
            try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
            let target = ChinaDay.string(from: ChinaDay.adding(days: 4, to: Date()))
            try await environment.repository.savePreparation(DailyPreparationRecord(
                day: target, status: .queued, aiPhotoCount: previousCount))
            let runner = try makeRunner(environment: environment, root: root)
            let first = await runner.run(maximumCandidates: 9, targetDay: target)
            XCTAssertEqual(first.analyzed, 0, "The gateway rejected this request before any AI call")
            XCTAssertEqual(first.cardsCreated, 0)
            let reopened = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
                transport: SafetyDispatchQuotaURLProtocol.self)
            let relaunched = try makeRunner(environment: reopened, root: root)
            for _ in 0..<3 { _ = await relaunched.run(maximumCandidates: 9, targetDay: target) }
            let state = await reopened.repository.snapshot()
            XCTAssertEqual(state.dailyPreparations[target]?.aiPhotoCount, previousCount)
            XCTAssertEqual(state.dailyPreparations[target]?.status, .retryableFailure)
            XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .failed)
            XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
            XCTAssertEqual(SafetyDispatchQuotaURLProtocol.callCount, 1, "Persist the real-day deferral across relaunches")
        }
    }

    func testDispatchReconciliationReleasesOnlyItsOwnReservationOnce() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: day, aiPhotoCount: 8))
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let id = try await environment.repository.reserveDiscoveryCloudPhoto(day: day, run: run)
        let rejectedAt = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-08T15:59:00Z"))
        for reservation in [UUID(), id, id] {
            try await environment.repository.rejectManagedCloudPhotoReservation(
                day: day, reservationID: reservation, run: run, now: rejectedAt)
        }
        await environment.repository.endAutomaticDiscoveryRun(run)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 8, "Legacy/possibly consumed attempts are not refunded")
        XCTAssertEqual(state.dailyPreparations[day]?.cloudPhotoReservationIDs, [])
        XCTAssertEqual(state.managedDispatchResumeAt, ISO8601DateFormatter().date(from: "2026-09-08T16:00:00Z"))
    }

    func testManagedCooldownExpiresAtNextChinaDayAndDoesNotBlockBYOK() async throws {
        for expired in [false, true] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true)
            let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
            let run = try XCTUnwrap(acquired)
            let id = try await environment.repository.reserveDiscoveryCloudPhoto(day: day, run: run)
            try await environment.repository.rejectManagedCloudPhotoReservation(day: day, reservationID: id, run: run,
                now: expired ? ChinaDay.adding(days: -1, to: Date()) : Date())
            await environment.repository.endAutomaticDiscoveryRun(run)
            if expired {
                let access = try await environment.pipeline.preflightModelAccess()
                XCTAssertEqual(access.mode, .managed)
            } else {
                do { _ = try await environment.pipeline.preflightModelAccess(); XCTFail("Active deferral allowed another dispatch") }
                catch { XCTAssertEqual(error as? ProductError, .managedDailyDispatchLimitReached) }
            }
            try await environment.repository.setModelAccessMode(.qwenUserKey)
            let userKeyAccess = try await environment.pipeline.preflightModelAccess()
            XCTAssertEqual(userKeyAccess.mode, .qwenUserKey, "The platform's limit is not the user's model limit")
        }
    }

    func testManagedCooldownStillPublishesAlreadyQualifiedCardsWithoutCloudCalls() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        SafetyDispatchQuotaURLProtocol.reset()
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyDispatchQuotaURLProtocol.self)
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let id = try await environment.repository.reserveDiscoveryCloudPhoto(day: day, run: run)
        try await environment.repository.rejectManagedCloudPhotoReservation(day: day, reservationID: id, run: run)
        await environment.repository.endAutomaticDiscoveryRun(run)
        let cards = try await seedCarryover(count: 2, environment: environment)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(summary.analyzed, 0)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
        XCTAssertEqual(SafetyDispatchQuotaURLProtocol.callCount, 0)
    }

    func testUncertainManagedFailureKeepsReservationAndDoesNotSetDailyCooldown() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyUnclassifiedInsightURLProtocol.self)
        let candidate = makeCandidate()
        try await environment.repository.upsert(candidate: candidate)
        try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.analyzed, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.cloudPhotoReservationIDs?.count, 1)
        XCTAssertNil(state.managedDispatchResumeAt)
        XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .failed)
    }

    func testManagedProviderAccessFailurePreservesPhotoReservationAndAutomaticRecovery() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        SafetyManagedAccessURLProtocol.reset()
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), managedPrivacy: true,
            transport: SafetyManagedAccessURLProtocol.self)
        let candidate = makeCandidate()
        try await environment.repository.upsert(candidate: candidate)
        try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(SafetyManagedAccessURLProtocol.callCount, 1)
        XCTAssertEqual(summary.accessError, .managedServiceUnavailable)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .retryableFailure)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.cloudPhotoReservationIDs?.count, 1)
        XCTAssertNil(state.managedDispatchResumeAt)
        XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .failed)
        XCTAssertTrue(state.automaticDiscoveryEnabled)
        XCTAssertEqual(state.modelAccessMode, .managed)
        XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: summary.accessError))
    }

    func testDeletingDuringWinnerAwaitCannotRestoreRepositoryOrWidget() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .winner)
        let environment = try await makeEnvironment(root: root, service: service)
        _ = try await seedCarryover(count: 3, environment: environment)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true }, widgetStore: widget)
        let day = self.day
        let work = Task { await runner.run(maximumCandidates: 9, targetDay: day) }
        await fulfillment(of: [service.entered], timeout: 3)
        try await environment.repository.deleteLocalData()
        try widget.clear()
        await service.resume() // deliberately returns a winner even when cancelled
        let summary = await work.value
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 0)
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertTrue(state.candidates.isEmpty)
        XCTAssertTrue(state.dailyPreparations.isEmpty)
        XCTAssertTrue(try widget.load().cards.isEmpty)
    }

    func testLateWinnerFailureCannotPublishAfterPauseDeletionOrPermissionRevocation() async throws {
        for interruption in [Interruption.pause, .delete, .revoke] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyQwen(suspendAt: .winner, winnerError: .requestFailed(503))
            let environment = try await makeEnvironment(root: root, service: service)
            _ = try await seedCarryover(count: 3, environment: environment)
            let access = SafetyPermission()
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment,
                authorizationCheck: { _ in access.allowed }, widgetStore: widget)
            let day = self.day
            let work = Task { await runner.run(maximumCandidates: 9, targetDay: day) }
            await fulfillment(of: [service.entered], timeout: 3)
            switch interruption {
            case .pause: try await environment.repository.setAutomaticDiscovery(false)
            case .delete: try await environment.repository.deleteLocalData()
            case .revoke: access.revoke()
            }
            await service.resume()
            let summary = await work.value
            let state = await environment.repository.snapshot()
            XCTAssertEqual(summary.cardsCreated, 0)
            XCTAssertNotEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertNil(state.dailyPreparations[day]?.selectedCardID)
            XCTAssertTrue(try widget.load().cards.isEmpty)
            if interruption == .delete { XCTAssertTrue(state.cards.isEmpty) }
        }
    }

    func testLocalStorageFailureDoesNotTriggerServiceAvailabilityFallback() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(winnerError: .localStorageUnavailable)
        let environment = try await makeEnvironment(root: root, service: service)
        _ = try await seedCarryover(count: 3, environment: environment)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.accessError, .localStorageUnavailable)
        XCTAssertEqual(summary.cardsCreated, 0)
        XCTAssertNil(state.dailyPreparations[day]?.selectedCardID)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .retryableFailure)
    }

    func testCardHiddenDuringWinnerFailureCannotBeResurrectedByFallback() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .winner, winnerError: .requestFailed(503))
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let runner = try makeRunner(environment: environment, root: root)
        let day = self.day
        let work = Task { await runner.run(maximumCandidates: 9, targetDay: day) }
        await fulfillment(of: [service.entered], timeout: 3)
        try await environment.repository.hideCard(cards[0].id, candidateToken: cards[0].candidateToken, neverAnalyze: true)
        await service.resume()
        let summary = await work.value
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[1].id)
        XCTAssertFalse(state.dailyPreparations[day]?.qualifiedCardIDs.contains(cards[0].id) ?? true)
        XCTAssertFalse(state.cards.contains { $0.id == cards[0].id })
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        XCTAssertEqual(try widget.load().card(for: day)?.id, cards[1].id)
    }

    func testHidingOnlyPreparedCardReopensItsDateWithoutRefundingAIAndRefillsIt() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let now = Date(), today = ChinaDay.string(from: Date())
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 1, environment: environment)
        let card = try XCTUnwrap(cards.first)
        try await environment.repository.finalizeDailySelection(day: today, selectedCardID: card.id,
            candidateIDs: [card.candidateToken], inspectedPhotoCount: 5, aiPhotoCount: 3, scannedAt: now)
        try await environment.repository.hideCard(card.id, candidateToken: card.candidateToken, neverAnalyze: true)
        let afterHide = await environment.repository.snapshot()
        XCTAssertEqual(afterHide.dailyPreparations[today]?.status, .queued)
        XCTAssertNil(afterHide.dailyPreparations[today]?.selectedCardID)
        XCTAssertTrue(afterHide.dailyPreparations[today]?.qualifiedCardIDs.isEmpty ?? false)
        XCTAssertEqual(afterHide.dailyPreparations[today]?.aiPhotoCount, 3, "Hiding does not undo a paid analysis")
        XCTAssertEqual(BackgroundDiscoveryController.nextPreparationDay(state: afterHide, now: now), today)

        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 1))
        let summary = await runner.replenishRollingWindow(maximumCandidates: 1)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[today]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 4)
        XCTAssertNotEqual(state.dailyPreparations[today]?.selectedCardID, card.id)
        XCTAssertNotNil(try widget.load().card(for: today))
        XCTAssertEqual(state.candidates.first { $0.id == card.candidateToken }?.state, .neverAnalyze)
        XCTAssertFalse(state.cards.contains { $0.id == card.id })
    }

    func testHidingPreparedWinnerPromotesOnlyAnExistingSameDayAlternate() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen())
        let cards = try await seedCarryover(count: 3, environment: environment)
        let today = ChinaDay.string(from: Date())
        try await environment.repository.finalizeDailySelection(day: today, selectedCardID: cards[0].id,
            candidateIDs: Set(cards.map(\.candidateToken)), aiPhotoCount: 3, scannedAt: Date())
        try await environment.repository.hideCard(cards[0].id, candidateToken: cards[0].candidateToken, neverAnalyze: true)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        XCTAssertEqual(state.dailyPreparations[today]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[today]?.selectedCardID, cards[1].id)
        XCTAssertEqual(Set(state.dailyPreparations[today]?.qualifiedCardIDs ?? []), Set(cards.dropFirst().map(\.id)))
        XCTAssertEqual(state.cards.first { $0.id == cards[1].id }?.status, "scheduled")
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 3)
    }

    func testReopeningLegacyMissingWinnerPreservesLedgerAndDoesNotBorrowTomorrow() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen())
        let cards = try await seedCarryover(count: 2, environment: environment)
        let now = Date(), today = ChinaDay.string(from: Date())
        let tomorrow = ChinaDay.string(from: ChinaDay.adding(days: 1, to: now))
        let reservation = UUID()
        let ledger = AdvancePreparationAttempt(inspectedPhotoCount: 8, aiPhotoCount: 5,
            lastAttemptAt: now.addingTimeInterval(-86400), recoveredAt: now)
        var legacy = await environment.repository.snapshot()
        legacy.cards = [cards[1].withPresentation(status: "scheduled", scheduledDay: tomorrow)]
        legacy.hiddenCardIDs.insert(cards[0].id)
        legacy.dailyPreparations[today] = DailyPreparationRecord(day: today, status: .ready,
            inspectedPhotoCount: 12, aiPhotoCount: 9, qualifiedCardIDs: cards.map(\.id),
            selectedCardID: cards[0].id, lastAttemptAt: now, previousAdvanceAttempt: ledger,
            earlierAdvanceAttempts: [ledger], cloudPhotoReservationIDs: [reservation])
        legacy.dailyPreparations[tomorrow] = DailyPreparationRecord(day: tomorrow, status: .ready,
            aiPhotoCount: 2, qualifiedCardIDs: [cards[1].id], selectedCardID: cards[1].id)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(legacy).write(to: root.appendingPathComponent("state.json"), options: .atomic)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        let repaired = try XCTUnwrap(state.dailyPreparations[today])
        XCTAssertEqual(repaired.status, .queued)
        XCTAssertNil(repaired.selectedCardID)
        XCTAssertEqual(repaired.aiPhotoCount, 9)
        XCTAssertEqual(repaired.inspectedPhotoCount, 12)
        XCTAssertEqual(repaired.previousAdvanceAttempt?.aiPhotoCount, 5)
        XCTAssertEqual(repaired.earlierAdvanceAttempts?.count, 1)
        XCTAssertEqual(repaired.cloudPhotoReservationIDs, [reservation])
        XCTAssertEqual(state.dailyPreparations[tomorrow], legacy.dailyPreparations[tomorrow])
        XCTAssertEqual(state.cards.first?.scheduledDay, tomorrow)
        let persisted = try Data(contentsOf: root.appendingPathComponent("state.json"))
        let reopenedAgain = try LocalRepository(rootURL: root)
        let again = await reopenedAgain.snapshot()
        XCTAssertEqual(again.dailyPreparations, state.dailyPreparations)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("state.json")), persisted)
    }

    func testHidingPreparedCardAtNinePhotosDoesNotReopenPaidAllowance() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 1, environment: environment)
        let today = ChinaDay.string(from: Date())
        try await environment.repository.finalizeDailySelection(day: today, selectedCardID: cards[0].id,
            candidateIDs: [cards[0].candidateToken], aiPhotoCount: 9, scannedAt: Date())
        try await environment.repository.hideCard(cards[0].id, candidateToken: cards[0].candidateToken, neverAnalyze: true)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 1))
        let result = await runner.replenishRollingWindow(maximumCandidates: 9)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
        XCTAssertEqual(result.cardsCreated, 0)
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 9)
        XCTAssertEqual(state.dailyPreparations[today]?.status, .noNewCard)
        XCTAssertNil(try widget.load().card(for: today), "Never restore a card hidden as too private")
    }

    func testWinnerRemovedAfterSnapshotCannotCommitAnEmptyReadyDate() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen())
        let cards = try await seedCarryover(count: 2, environment: environment)
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun(authorizationCheck: { _ in true })
        let run = try XCTUnwrap(acquired)
        let today = ChinaDay.string(from: Date())
        try await environment.repository.savePreparation(DailyPreparationRecord(day: today, status: .preparing,
            aiPhotoCount: 3, qualifiedCardIDs: cards.map(\.id)), discoveryRun: run)
        // Deterministic actor ordering reproduces snapshot -> user hides ->
        // final commit, a later boundary than the existing suspended-AI test.
        try await environment.repository.hideCard(cards[0].id, candidateToken: cards[0].candidateToken, neverAnalyze: true)
        do {
            try await environment.repository.finalizeDailySelection(day: today, selectedCardID: cards[0].id,
                candidateIDs: Set(cards.map(\.candidateToken)), aiPhotoCount: 3, scannedAt: Date(), discoveryRun: run)
            XCTFail("A stale winner must be rejected at the repository commit boundary")
        } catch { XCTAssertEqual(error as? ProductError, .invalidServerResponse) }
        let state = await environment.repository.snapshot()
        XCTAssertNotEqual(state.dailyPreparations[today]?.status, .ready)
        XCTAssertNil(state.dailyPreparations[today]?.selectedCardID)
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 3)
        XCTAssertEqual(state.cards.first { $0.id == cards[1].id }?.scheduledDay, "")
        await environment.repository.endAutomaticDiscoveryRun(run)
    }

    func testForeignWinnerIDNeverPublishesAnUnqualifiedOrHistoricalCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let foreignID = UUID()
        let service = SafetyQwen(returnedWinnerID: foreignID)
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let runner = try makeRunner(environment: environment, root: root)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.accessError, .invalidServerResponse)
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[0].id)
        XCTAssertFalse(state.cards.contains { $0.id == foreignID })
    }

    func testLimitedPhotoAccessIsRecheckedBeforeSelectingACachedCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(winnerError: .requestFailed(503))
        let environment = try await makeEnvironment(root: root, service: service)
        let cards = try await seedCarryover(count: 3, environment: environment)
        let before = await environment.repository.snapshot()
        let revoked = try XCTUnwrap(before.candidates.first { $0.id == cards[0].candidateToken }?.localIdentifier)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment,
            authorizationCheck: { $0 != revoked }, widgetStore: widget)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertTrue(state.automaticDiscoveryEnabled)
        XCTAssertEqual(state.dailyPreparations[day]?.selectedCardID, cards[1].id)
        XCTAssertFalse(state.dailyPreparations[day]?.qualifiedCardIDs.contains(cards[0].id) ?? true)
        XCTAssertEqual(try widget.load().card(for: day)?.id, cards[1].id)
    }

    func testInspectionBudgetAndPoolAdmissionBoundaries() {
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingInspectionBudget(previous: 0), 72)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingInspectionBudget(previous: 71), 1)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingInspectionBudget(previous: 73), 0)
        XCTAssertFalse(AutomaticDiscoveryRunner.canInspectMore(inspected: 0, inspectionLimit: 72, analyzed: 0, runLimit: 9, poolCount: 3))
        XCTAssertFalse(AutomaticDiscoveryRunner.canInspectMore(inspected: 1, inspectionLimit: 1, analyzed: 0, runLimit: 9, poolCount: 0))
    }

    func testDeferredFailedPhotosNeverReenterNewPhotoDeduplication() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let failed = (0..<4).map { _ in makeCandidate() }
        for candidate in failed { try await repository.upsert(candidate: candidate) }
        var terminal = makeCandidate()
        terminal.state = .filtered
        try await repository.upsert(candidate: terminal)
        let state = await repository.snapshot()
        let newID = "synthetic-new-photo"
        let references = (failed.compactMap(\.localIdentifier) + [try XCTUnwrap(terminal.localIdentifier), newID]).map {
            PhotoAssetReference(localIdentifier: $0, capturedAt: nil, modifiedAt: nil, isScreenshot: false)
        }
        for retried in [Set<String>(), Set(failed.prefix(3).compactMap(\.localIdentifier))] {
            let unseen = AutomaticDiscoveryRunner.unprocessedAssets(references, state: state, retriedLocalIDs: retried)
            XCTAssertEqual(unseen.map(\.localIdentifier), [newID],
                           "Deferred retries must keep their token; fresh analysis would reject their own stored hash")
        }
    }

    func testDeferredCachedRetryKeepsItsIdentityAcrossPreparationDays() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(noSubjects: true)
        let environment = try await makeEnvironment(root: root, service: service)
        let jpeg = await makeJPEG()
        var failed: [PhotoCandidateRecord] = []
        for index in 0..<4 {
            var candidate = makeCandidate()
            candidate.updatedAt = Date(timeIntervalSince1970: Double(index))
            failed.append(candidate)
            try await environment.repository.upsert(candidate: candidate)
            try await environment.repository.storeImage(jpeg, candidateToken: candidate.id)
        }
        // End the first run at its real inspection limit without accessing Photos.
        try await environment.repository.savePreparation(DailyPreparationRecord(
            day: day, status: .preparing, inspectedPhotoCount: 69
        ))
        let runner = try makeRunner(environment: environment, root: root)
        let first = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(first.analyzed, 3)
        XCTAssertEqual(first.failed, 0)
        let afterFirst = await environment.repository.snapshot()
        XCTAssertEqual(afterFirst.candidates.first { $0.id == failed[3].id }?.state, .failed)
        let second = await runner.run(maximumCandidates: 1, targetDay: "2026-09-06")
        XCTAssertEqual(second.analyzed, 1)
        XCTAssertEqual(second.failed, 0)
        let reopened = try LocalRepository(rootURL: root)
        let final = await reopened.snapshot()
        XCTAssertEqual(Set(final.candidates.map(\.id)), Set(failed.map(\.id)))
        XCTAssertTrue(final.candidates.allSatisfy { $0.state == .exhausted && $0.sensitiveFlags.isEmpty })
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 4)
        XCTAssertEqual(final.dailyPreparations[day]?.aiPhotoCount, 3)
        XCTAssertEqual(final.dailyPreparations["2026-09-06"]?.aiPhotoCount, 1)
    }

    func testUnavailableFailedPhotosDoNotOccupyRetrySlots() async throws {
        for removedFromAccess in [false, true] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [1])
            let environment = try await makeEnvironment(root: root, service: service)
            let jpeg = try ImageSanitizer().sanitize(await makeJPEG()).jpeg
            var candidates: [PhotoCandidateRecord] = []
            for index in 0..<4 {
                var candidate = makeCandidate()
                candidate.updatedAt = Date(timeIntervalSince1970: Double(index))
                candidates.append(candidate)
                try await environment.repository.upsert(candidate: candidate)
                if removedFromAccess || index == 3 {
                    try await environment.repository.storeImage(jpeg, candidateToken: candidate.id)
                }
            }
            let unavailableIDs = Set(candidates.prefix(3).compactMap(\.localIdentifier))
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let source = await makeBatchSource(count: 0)
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { identifier in
                guard removedFromAccess, let identifier else { return true }
                return !unavailableIDs.contains(identifier)
            }, widgetStore: widget, photoSource: source)
            let summary = await runner.run(maximumCandidates: 9, targetDay: day)
            let state = await environment.repository.snapshot()
            XCTAssertEqual(summary.analyzed, 1)
            XCTAssertEqual(summary.cardsCreated, 1)
            XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(state.cards.first?.candidateToken, candidates[3].id)
            XCTAssertEqual(try widget.load().card(for: day)?.candidateToken, candidates[3].id)
            XCTAssertEqual(Set(state.candidates.map(\.id)), Set(candidates.map(\.id)))
            for candidate in candidates.prefix(3) {
                let retained = try XCTUnwrap(state.candidates.first { $0.id == candidate.id })
                XCTAssertEqual(retained.state, .failed)
                XCTAssertGreaterThan(retained.updatedAt, candidate.updatedAt, "Defer unavailable entries so later retries cannot starve")
                XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
                let image = await environment.repository.imageData(candidateToken: candidate.id)
                XCTAssertNil(image, "Photos no longer authorized must not retain uploadable bytes")
            }
            XCTAssertTrue(state.automaticDiscoveryEnabled)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 1)
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty, "Existing retries retain their identity and must not be imported as new photos")
        }
    }

    func testLongUnavailableRetryQueueRotatesWithinBoundAndSurvivesRestart() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let window = AutomaticDiscoveryRunner.dailyInspectionLimit
        var candidates: [PhotoCandidateRecord] = []
        for index in 0...window {
            var candidate = makeCandidate()
            candidate.updatedAt = Date(timeIntervalSince1970: Double(index))
            candidates.append(candidate)
            try await environment.repository.upsert(candidate: candidate)
        }
        let available = try XCTUnwrap(candidates.last)
        let jpeg = try ImageSanitizer().sanitize(await makeJPEG()).jpeg
        try await environment.repository.storeImage(jpeg, candidateToken: available.id)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let source = await makeBatchSource(count: 0)
        let firstRunner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                   widgetStore: widget, photoSource: source)
        let first = await firstRunner.run(maximumCandidates: 9, targetDay: day)
        let firstState = await environment.repository.snapshot()
        XCTAssertEqual(first.analyzed, 0, "Metadata availability checks cannot reserve cloud photos")
        XCTAssertEqual(firstState.dailyPreparations[day]?.inspectedPhotoCount, 0)
        XCTAssertEqual(firstState.dailyPreparations[day]?.status, .waitingForPhotos)
        XCTAssertEqual(firstState.candidates.first { $0.id == available.id }?.updatedAt, available.updatedAt,
                       "One run must stop after a bounded retry-metadata window")
        for candidate in candidates.prefix(window) {
            let retained = try XCTUnwrap(firstState.candidates.first { $0.id == candidate.id })
            XCTAssertEqual(retained.state, .failed)
            XCTAssertGreaterThan(retained.updatedAt, candidate.updatedAt)
        }

        let reopened = try await makeEnvironment(root: root, service: service)
        let secondRunner = AutomaticDiscoveryRunner(environment: reopened, authorizationCheck: { _ in true },
                                                    widgetStore: widget, photoSource: source)
        let second = await secondRunner.run(maximumCandidates: 9, targetDay: day)
        let final = await reopened.repository.snapshot()
        XCTAssertEqual(second.analyzed, 1)
        XCTAssertEqual(second.cardsCreated, 1)
        XCTAssertEqual(final.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(final.dailyPreparations[day]?.aiPhotoCount, 1)
        XCTAssertEqual(final.dailyPreparations[day]?.inspectedPhotoCount, 1)
        XCTAssertEqual(final.cards.first?.candidateToken, available.id)
        XCTAssertEqual(try widget.load().card(for: day)?.candidateToken, available.id)
        XCTAssertEqual(Set(final.candidates.map(\.id)), Set(candidates.map(\.id)))
        XCTAssertTrue(final.exhaustedLocalIdentifiers.isEmpty)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1)
        let reads = await source.readIDs()
        XCTAssertTrue(reads.isEmpty)
    }

    func testUnknownCatalogObjectStillProducesModelKnowledgeWithUserKey() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(modelKnowledge: true)
        let environment = try await makeEnvironment(root: root, service: service)
        let result = try await environment.pipeline.retry(candidate: makeCandidate(), sanitizedJPEG: makeJPEG(), targetDay: day)
        let card = try XCTUnwrap(result.card)
        XCTAssertEqual(result.candidate.state, .knowledgeReady)
        XCTAssertEqual(card.topicID, "spinning_top")
        XCTAssertEqual(card.evidenceKind, .modelKnowledge)
        XCTAssertTrue(card.sources.isEmpty)
        let calls = await service.calls()
        XCTAssertEqual(calls.edit, 0, "The fixture must exercise the no-catalog route")
        XCTAssertEqual(calls.knowledge, 1)
        XCTAssertNil(environment.api, "BYOK succeeds without any platform account or transport")
    }

    func testWithheldCatalogCopyDoesNotExhaustThePhotoOrRequirePlatformService() async throws {
        // These model responses are synthetic. This tests routing and persisted
        // state after withholding old copy, not new fact or photo approval.
        for (topicID, objectName) in [("colander", "滤水篮"), ("mosquito_coil", "蚊香"), ("wall_clock", "挂钟")] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyQwen(modelKnowledge: true, detectedEntity: DirectDetectedEntity(
                canonicalTopicID: topicID, displayName: objectName, confidence: 0.95,
                boundingBox: nil, alternatives: [], sensitiveFlags: []))
            let environment = try await makeEnvironment(root: root, service: service)
            let result = try await environment.pipeline.retry(candidate: makeCandidate(), sanitizedJPEG: makeJPEG(), targetDay: day)
            let card = try XCTUnwrap(result.card, topicID)
            XCTAssertEqual(result.candidate.state, .knowledgeReady, topicID)
            XCTAssertEqual(card.topicID, topicID)
            XCTAssertEqual(card.evidenceKind, .modelKnowledge)
            XCTAssertTrue(card.sources.isEmpty, "The generated card cannot inherit the withheld copy's sources")
            let calls = await service.calls()
            XCTAssertEqual(calls.edit, 0, "Withheld cached copy cannot be sent as an approved editorial option")
            XCTAssertEqual(calls.knowledge, 1)
            XCTAssertNil(environment.api, "No platform Key or platform search is required")
            try await environment.repository.upsert(candidate: result.candidate, card: card, sanitizedJPEG: result.sanitizedJPEG)
            let restored = try LocalRepository(rootURL: root)
            let state = await restored.snapshot()
            XCTAssertEqual(state.cards.first?.id, card.id)
            XCTAssertEqual(state.cards.first?.evidenceKind, .modelKnowledge)
            XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(result.candidate.localIdentifier)))
        }
    }

    @MainActor
    func testUsedCatalogFactTriggersNewKnowledgeAndNeverReplacesHistoryWithARepeat() async throws {
        // Real bundled catalog + automatic runner + disk/widget persistence;
        // synthetic photo/model boundaries, never a content-quality evaluation.
        for (newKnowledge, newerHistoryCount) in [(true, 0), (true, 101), (false, 0)] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let service = SafetyNoveltyQwen(producesNewKnowledge: newKnowledge)
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
            let catalog = try BundledKnowledgeCatalog.load()
            var originalCandidate = makeCandidate()
            originalCandidate.state = .selected
            let original = try XCTUnwrap(catalog.makeCard(entity: SafetyNoveltyQwen.entity,
                candidateToken: originalCandidate.id, capturedAt: nil, recentFactIDs: [],
                now: Date(timeIntervalSince1970: 0)))
                .withPresentation(status: "scheduled", scheduledDay: "2026-09-04")
            try await environment.repository.upsert(candidate: originalCandidate, card: original, sanitizedJPEG: makeJPEG())
            for index in 0..<newerHistoryCount {
                let filler = makeCard(candidate: makeCandidate(), index: index + 1)
                    .withPresentation(status: "scheduled", scheduledDay: "2026-08-01")
                try await environment.repository.upsert(card: filler, sanitizedJPEG: nil)
            }
            let candidate = makeCandidate()
            try await environment.repository.upsert(candidate: candidate)
            try await environment.repository.storeImage(makeJPEG(), candidateToken: candidate.id)
            try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .preparing, aiPhotoCount: 8))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                widgetStore: widget, photoSource: SafetyPhotoSource(images: []))
            let summary = await runner.run(maximumCandidates: 1, targetDay: day)
            let reopened = try LocalRepository(rootURL: root)
            let state = await reopened.snapshot()
            let calls = await service.calls()
            XCTAssertEqual(calls.edit, 0, "Do not pay to rewrite an already-used catalog fact, even after 100 newer cards")
            XCTAssertEqual(calls.knowledge, 1, "A new photo deserves another knowledge angle before becoming exhausted")
            XCTAssertEqual(state.cards.filter { $0.factID == original.factID }.map(\.id), [original.id])
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
            XCTAssertEqual(summary.analyzed, 1)
            XCTAssertEqual(summary.failed, 0)
            XCTAssertEqual(summary.cardsCreated, newKnowledge ? 1 : 0)
            XCTAssertNil(environment.api, "The new angle must not switch to a platform Key or search")
            let model = AppModel(environment: environment, photoAccessCheck: { .full })
            await model.refreshPresentationState()
            XCTAssertTrue(model.historyCards.contains { $0.id == original.id })
            if newKnowledge {
                let current = try XCTUnwrap(state.cards.first { $0.id == state.dailyPreparations[day]?.selectedCardID })
                XCTAssertNotEqual(current.factID, original.factID)
                XCTAssertEqual(current.evidenceKind, .modelKnowledge)
                XCTAssertTrue(current.sources.isEmpty)
                XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
                XCTAssertEqual(try widget.load().card(for: day)?.id, current.id)
                XCTAssertEqual(model.currentCard?.id, current.id)
                XCTAssertTrue(model.historyCards.contains { $0.id == current.id })
            } else {
                XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
                XCTAssertEqual(state.candidates.first { $0.id == candidate.id }?.state, .exhausted)
                let queue = try widget.load()
                XCTAssertNil(queue.card(for: day), "Retaining yesterday is not publishing a new card for today")
                XCTAssertEqual(queue.mostRecentCard(onOrBefore: day)?.id, original.id)
                XCTAssertFalse(try Data(contentsOf: widget.thumbnailURL(for: original.candidateToken)).isEmpty)
                XCTAssertEqual(model.currentCard?.id, original.id)
            }
            XCTAssertEqual(state.cards.count, newerHistoryCount + (newKnowledge ? 2 : 1))
        }
    }

    func testModelKnowledgeNetworkFailureRemainsRetryableWithoutPlatformFallback() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(modelKnowledge: true, modelError: .requestFailed(503))
        let environment = try await makeEnvironment(root: root, service: service)
        let candidate = makeCandidate()
        do {
            _ = try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: makeJPEG(), targetDay: day)
            XCTFail("Service failure must not become no_insight")
        } catch let failure as PipelineFailure {
            XCTAssertEqual(failure.candidate.state, .failed)
            XCTAssertEqual(failure.candidate.id, candidate.id)
            XCTAssertEqual(failure.cause, .requestFailed(503))
        }
        let state = await environment.repository.snapshot()
        XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(candidate.localIdentifier)))
        XCTAssertTrue(state.cards.isEmpty)
        let calls = await service.calls()
        XCTAssertEqual(calls.knowledge, 1)
        XCTAssertEqual(calls.winner, 0)
    }

    func testConflictingObjectIDIsNormalizedBeforeFallbackAndHistoryPersistence() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(modelKnowledge: true, detectedEntity: DirectDetectedEntity(
            canonicalTopicID: "computer_mouse", displayName: "拉链", confidence: 0.95,
            boundingBox: nil, alternatives: [], sensitiveFlags: []))
        let environment = try await makeEnvironment(root: root, service: service)
        let result = try await environment.pipeline.retry(candidate: makeCandidate(), sanitizedJPEG: makeJPEG(), targetDay: day)
        let card = try XCTUnwrap(result.card)
        XCTAssertEqual(card.topicID, "zipper", "Fallback writing must receive the normalized subject, not the raw model ID")
        XCTAssertEqual(card.objectName, "拉链")
        XCTAssertEqual(card.evidenceKind, .modelKnowledge)
        let calls = await service.calls()
        XCTAssertEqual(calls.edit, 0, "Do not call the model with unrelated mouse facts")
        XCTAssertEqual(calls.knowledge, 1)
        XCTAssertNil(environment.api)
        try await environment.repository.upsert(candidate: result.candidate, card: card, sanitizedJPEG: result.sanitizedJPEG)
        let restored = try LocalRepository(rootURL: root)
        let state = await restored.snapshot()
        XCTAssertEqual(state.cards.first?.topicID, "zipper")
        XCTAssertEqual(state.cards.first?.objectName, "拉链")
    }

    func testPauseDuringModelKnowledgeDiscardsLateCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .knowledge, modelKnowledge: true)
        let environment = try await makeEnvironment(root: root, service: service)
        let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
        let run = try XCTUnwrap(acquired)
        let candidate = makeCandidate()
        let jpeg = await makeJPEG()
        let day = self.day
        let work = Task {
            try await environment.pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day, discoveryRun: run)
        }
        await fulfillment(of: [service.entered], timeout: 3)
        try await environment.repository.setAutomaticDiscovery(false)
        await service.resume()
        do { _ = try await work.value; XCTFail("Late card escaped cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        let state = await environment.repository.snapshot()
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        let calls = await service.calls()
        XCTAssertEqual(calls.winner, 0)
        await environment.repository.endAutomaticDiscoveryRun(run)
    }

    func testBYOKUpgradeRetriesCatalogMissesWithoutReopeningPrivatePhotos() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let environment = try await makeEnvironment(root: root, service: SafetyQwen())
        var miss = makeCandidate()
        miss.state = .exhausted
        var privatePhoto = makeCandidate()
        privatePhoto.state = .filtered
        privatePhoto.sensitiveFlags = ["face"]
        try await environment.repository.upsert(candidate: miss)
        try await environment.repository.upsert(candidate: privatePhoto)
        let requeued = try await environment.pipeline.prepareKnowledgeCatalog()
        let repeated = try await environment.pipeline.prepareKnowledgeCatalog()
        let state = await environment.repository.snapshot()
        XCTAssertEqual(requeued, 1)
        XCTAssertEqual(repeated, 0)
        XCTAssertFalse(state.processedLocalIdentifiers.contains(try XCTUnwrap(miss.localIdentifier)))
        XCTAssertTrue(state.processedLocalIdentifiers.contains(try XCTUnwrap(privatePhoto.localIdentifier)))
        XCTAssertTrue(state.knowledgeCatalogRevision?.hasSuffix(DirectQwenService.modelKnowledgeRevision) == true)
    }

    func testNewPhotoBatchContinuesPastThreeEmptyPhotosAndPublishesAtNine() async throws {
        for successAt in [4, 9] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [successAt])
            let environment = try await makeEnvironment(root: root, service: service)
            let source = await makeBatchSource(count: 12)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let summary = await runner.run(maximumCandidates: 9, targetDay: day)
            let reopened = try LocalRepository(rootURL: root)
            let state = await reopened.snapshot()
            let calls = await service.calls()
            let readIDs = await source.readIDs()
            XCTAssertEqual(summary.failed, 0)
            XCTAssertEqual(summary.analyzed, 9)
            XCTAssertEqual(summary.inspected, 9)
            XCTAssertEqual(summary.cardsCreated, 1)
            XCTAssertEqual(summary.exhausted, 8)
            XCTAssertEqual(calls.detect, 9)
            XCTAssertEqual(calls.edit, 0)
            XCTAssertEqual(calls.winner, 0, "One qualified card needs no paid tie-breaker")
            XCTAssertEqual(readIDs.count, 9)
            XCTAssertEqual(Set(readIDs).count, 9)
            XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
            XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
            XCTAssertEqual(state.cards.count, 1)
            XCTAssertEqual(state.cards.first?.topicID, "synthetic_batch_\(successAt)")
            XCTAssertEqual(state.candidates.filter { $0.state == .exhausted }.count, 8)
            XCTAssertEqual(state.processedLocalIdentifiers, Set(readIDs))
            XCTAssertEqual(try widget.load().card(for: day)?.id, state.cards.first?.id)
            let limits = await source.queryLimits()
            XCTAssertEqual(limits, [500])
        }
    }

    func testNewPhotoBatchStopsAtThreeQualifiedAndKeepsSwapHistory() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1, 4, 8])
        let environment = try await makeEnvironment(root: root, service: service)
        let source = await makeBatchSource(count: 12)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        // Today's batch includes its two runner-ups in the shared projection.
        let now = Date()
        let today = ChinaDay.string(from: now)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let summary = await runner.run(maximumCandidates: 9, targetDay: today)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(summary.analyzed, 8)
        XCTAssertEqual(summary.knowledgeReady, 3)
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(calls.detect, 8)
        XCTAssertEqual(calls.winner, 1)
        let winner = try XCTUnwrap(state.cards.first { $0.id == state.dailyPreparations[today]?.selectedCardID })
        XCTAssertEqual(winner.topicID, "synthetic_batch_8", "Use the model's winner, not simply the first qualified photo")
        var queue = try widget.load()
        XCTAssertEqual(queue.card(for: today)?.id, winner.id)
        XCTAssertEqual(queue.dailySelections[today]?.pool.count, 3)
        _ = try widget.advance(on: today, now: now.addingTimeInterval(1))
        _ = try widget.advance(on: today, now: now.addingTimeInterval(2))
        queue = try widget.load()
        XCTAssertFalse(queue.canAdvance(on: today))
        XCTAssertEqual(Set(queue.surfacedCards(on: today).map(\.id)), Set(state.cards.map(\.id)))
        XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue, activeCardID: nil,
                                                  now: now.addingTimeInterval(3))?.id, queue.card(for: today)?.id)
        let history = CardHistoryResolver.resolve(cards: state.cards, presentations: queue.presentations, now: now.addingTimeInterval(3))
        XCTAssertEqual(Set(history.map(\.id)), Set(state.cards.map(\.id)))
        _ = await runner.run(maximumCandidates: 9, targetDay: today)
        let finalCalls = await service.calls()
        let reads = await source.readIDs()
        XCTAssertEqual(finalCalls.detect, 8)
        XCTAssertEqual(finalCalls.winner, 1)
        XCTAssertEqual(reads.count, 8)
    }

    func testNewPhotoBatchAllNineEmptyKeepsOldCardAndSkipsUsedPhotosNextDay() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [])
        let environment = try await makeEnvironment(root: root, service: service)
        let source = await makeBatchSource(count: 12)
        var oldCandidate = makeCandidate()
        oldCandidate.state = .selected
        let old = makeCard(candidate: oldCandidate, index: 99).withPresentation(status: "scheduled", scheduledDay: "2026-09-04")
        try await environment.repository.upsert(candidate: oldCandidate, card: old, sanitizedJPEG: makeJPEG())
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let first = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(first.analyzed, 9)
        XCTAssertEqual(first.cardsCreated, 0)
        XCTAssertEqual(first.failed, 0)
        var state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        let queue = try widget.load()
        XCTAssertNil(queue.card(for: day))
        XCTAssertEqual(queue.mostRecentCard(onOrBefore: day)?.id, old.id)
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z"))
        XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue, activeCardID: nil, now: now)?.id, old.id)
        _ = await runner.run(maximumCandidates: 9, targetDay: day)
        let repeatedCalls = await service.calls()
        XCTAssertEqual(repeatedCalls.detect, 9)
        let next = await runner.run(maximumCandidates: 9, targetDay: "2026-09-06")
        XCTAssertEqual(next.analyzed, 3)
        XCTAssertEqual(next.failed, 0)
        state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations["2026-09-06"]?.status, .waitingForPhotos)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 9)
        XCTAssertEqual(state.exhaustedLocalIdentifiers.count, 12)
        let readIDs = await source.readIDs()
        XCTAssertEqual(readIDs.count, 12)
        XCTAssertEqual(Set(readIDs).count, 12, "Tomorrow must not reselect any of the nine conclusive misses")
    }

    func testUnavailableSourceDefersPhotoButDoesNotStopDailySelection() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [2, 3, 4], sourceFailures: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let source = await makeBatchSource(count: 12)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let result = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(result.analyzed, 4)
        XCTAssertEqual(result.failed, 1, "Keep the deferred failure in aggregate diagnostics")
        XCTAssertEqual(result.knowledgeReady, 3)
        XCTAssertEqual(result.cardsCreated, 1)
        XCTAssertEqual(result.accessError, .knowledgeSourceUnavailable)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 4)
        let deferred = try XCTUnwrap(state.candidates.first { $0.state == .failed })
        XCTAssertFalse(state.exhaustedLocalIdentifiers.contains(try XCTUnwrap(deferred.localIdentifier)))
        let jpeg = await environment.repository.imageData(candidateToken: deferred.id)
        XCTAssertNotNil(jpeg, "Source unavailability must not permanently discard the photo")
        XCTAssertEqual(try widget.load().card(for: day)?.id, state.dailyPreparations[day]?.selectedCardID)
        _ = await runner.run(maximumCandidates: 9, targetDay: day)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 4, "A ready day must not restart its failed photo immediately")
        XCTAssertEqual(calls.winner, 1)
    }

    func testUnavailableSourcesStillRespectNinePhotoLimitAndRetainOldCard() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [], sourceFailures: Set(1...12))
        let environment = try await makeEnvironment(root: root, service: service)
        let old = try await seedPreviousCard(environment: environment)
        let source = await makeBatchSource(count: 12)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let result = await runner.run(maximumCandidates: 9, targetDay: day)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(result.analyzed, 9)
        XCTAssertEqual(result.failed, 9)
        XCTAssertEqual(result.exhausted, 0)
        XCTAssertEqual(state.candidates.filter { $0.state == .failed }.count, 9)
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        XCTAssertTrue(state.cards.contains { $0.id == old.id })
        _ = await runner.run(maximumCandidates: 9, targetDay: day)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 9)
    }

    func testSystemPhotoQueryFillsUnseenWindowBeforeApplyingLimitAndOlderFallback() async throws {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("Jianwei PhotoKit ") == true else {
            throw XCTSkip("Generated fixtures are restricted to the isolated PhotoKit simulator")
        }
        XCTAssertEqual(PHPhotoLibrary.authorizationStatus(for: .readWrite), .authorized)
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
            throw ProductError.permissionDenied
        }
        var knownIDs = Set<String>()
        PHAsset.fetchAssets(with: .image, options: nil).enumerateObjects { asset, _, _ in
            knownIDs.insert(asset.localIdentifier)
        }
        let owned = SafetySecrets()
        let jpeg = await makeBatchJPEG(index: 0)
        let now = Date()
        try await PHPhotoLibrary.shared().performChanges {
            for (name, daysAgo) in [("newest", 0), ("recent", 1), ("older", 120)] {
                let request = PHAssetCreationRequest.forAsset()
                request.creationDate = now.addingTimeInterval(-Double(daysAgo) * 86_400)
                request.addResource(with: .photo, data: jpeg, options: nil)
                try? owned.set(request.placeholderForCreatedAsset?.localIdentifier ?? "", for: name)
            }
        }
        let newest = try XCTUnwrap(owned.string(for: "newest"))
        let recent = try XCTUnwrap(owned.string(for: "recent"))
        let older = try XCTUnwrap(owned.string(for: "older"))
        let imageManager = SuspendedPhotoImageManager()
        let discovery = PhotoDiscoveryService(imageManager: imageManager)
        var results = try await discovery.recentAssets(days: 90, limit: 1, excludingLocalIdentifiers: knownIDs)
        XCTAssertEqual(results.map(\.localIdentifier), [newest])
        knownIDs.insert(newest)
        results = try await discovery.recentAssets(days: 90, limit: 1, excludingLocalIdentifiers: knownIDs)
        XCTAssertEqual(results.map(\.localIdentifier), [recent], "The known first result cannot consume the window")
        results = try await discovery.recentAssets(days: 90, limit: 2, excludingLocalIdentifiers: knownIDs)
        XCTAssertEqual(results.map(\.localIdentifier), [recent, older], "Fill recent first, then unseen older photos")
        knownIDs.insert(recent)
        results = try await discovery.recentAssets(days: 90, limit: 1, excludingLocalIdentifiers: knownIDs)
        XCTAssertEqual(results.map(\.localIdentifier), [older], "Processed recent photos must not disable the older fallback")
        knownIDs.insert(older)
        results = try await discovery.recentAssets(days: 90, limit: 1, excludingLocalIdentifiers: knownIDs)
        XCTAssertTrue(results.isEmpty)
        results = try await discovery.recentAssets(days: 90, limit: 0)
        XCTAssertTrue(results.isEmpty, "A zero limit cannot mean the entire library")
        XCTAssertFalse(imageManager.hasStarted, "Metadata discovery must not download or decode any photo")
        // Keep these owned fixtures only in the disposable simulator. Never
        // automate photo deletion or run this on the user's physical iPhone.
        let attachment = XCTAttachment(string: [newest, recent, older].joined(separator: "\n"))
        attachment.name = "owned-unseen-window-photokit-fixtures"
        attachment.lifetime = .keepAlways
        add(attachment)
        #else
        throw XCTSkip("Never modifies a physical device's photo library")
        #endif
    }

    func testDiscoveryContinuesBeyondFiveHundredProcessedPhotosWithoutReopeningThem() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let previous = try await seedPreviousCard(environment: environment)
        var knownIDs = Set<String>()
        for index in 0..<500 {
            let identifier = "synthetic-new-\(index)"
            knownIDs.insert(identifier)
            try await environment.repository.upsert(candidate: PhotoCandidateRecord(
                id: UUID(), localIdentifier: identifier, capturedAt: nil, perceptualHash: nil,
                qualityScore: 0, localLabels: [], sensitiveFlags: ["face"],
                state: .filtered, updatedAt: Date()
            ))
        }
        // Metadata for the newest 500 photos is already terminal. Only the
        // 501st photo may be read; the rest need not have decodable image data.
        let source = SafetyPhotoSource(images: Array(repeating: Data(), count: 500) + [await makeBatchJPEG(index: 1)])
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let target = ChinaDay.string(from: Date())
        let summary = await runner.run(maximumCandidates: 9, targetDay: target)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1, "Processed photos cannot hide the remaining library")
        XCTAssertEqual(summary.inspected, 1)
        XCTAssertEqual(summary.analyzed, 1)
        XCTAssertEqual(state.dailyPreparations[target]?.status, .ready)
        XCTAssertTrue(knownIDs.isSubset(of: state.processedLocalIdentifiers), "Never reopen privacy decisions to make room")
        XCTAssertTrue(state.cards.contains { $0.id == previous.id })
        let selected = state.dailyPreparations[target]?.selectedCardID
        XCTAssertNotNil(selected)
        XCTAssertEqual(try widget.load().card(for: target)?.id, selected)
        let reads = await source.readIDs()
        let limits = await source.queryLimits()
        XCTAssertEqual(reads, ["synthetic-new-500"])
        XCTAssertEqual(limits, [500], "The candidate window is still bounded")

        let restarted = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        let nextRunner = AutomaticDiscoveryRunner(environment: restarted, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
        _ = await nextRunner.run(maximumCandidates: 9, targetDay: target)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1, "A restart must not repeat this completed analysis")
    }

    func testNewPhotoTemporaryModelFailureRetainsTokenAcrossRestartAndRecovers() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [2, 3, 4], failingCalls: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let source = await makeBatchSource(count: 12)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let first = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(first.accessError, .requestFailed(503))
        let interrupted = await environment.repository.snapshot()
        let retry = try XCTUnwrap(interrupted.candidates.first)
        XCTAssertEqual(retry.state, .failed)
        XCTAssertTrue(interrupted.exhaustedLocalIdentifiers.isEmpty)
        // Reconstruct the app services from disk; no surviving runner owns the retry.
        let restarted = try await makeEnvironment(root: root, service: service)
        let newRunner = AutomaticDiscoveryRunner(environment: restarted, authorizationCheck: { _ in true },
                                                widgetStore: widget, photoSource: source)
        let recovered = await newRunner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(recovered.failed, 0)
        XCTAssertEqual(recovered.analyzed, 3)
        XCTAssertEqual(recovered.cardsCreated, 1)
        let state = await restarted.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 4, "The uncertain first attempt must remain counted")
        XCTAssertEqual(state.candidates.count, 3)
        XCTAssertEqual(state.candidates.first { $0.localIdentifier == retry.localIdentifier }?.id, retry.id)
        XCTAssertTrue(state.candidates.allSatisfy { $0.state == .selected || $0.state == .knowledgeReady })
        let readIDs = await source.readIDs()
        XCTAssertEqual(readIDs.count, 3, "Retry uses the sanitized cache and the same candidate token")
        XCTAssertEqual(Set(readIDs).count, 3)
    }

    func testNewPhotoLocalFiltersStayTerminalAndDoNotSpendCloudSlots() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let screenshot = await makeBatchJPEG(index: 0)
        let valid = await makeBatchJPEG(index: 1)
        let source = SafetyPhotoSource(images: [screenshot, Data([0, 1, 2]), valid, valid], screenshots: [0])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let summary = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(summary.inspected, 4)
        XCTAssertEqual(summary.filtered, 3)
        XCTAssertEqual(summary.analyzed, 1)
        XCTAssertEqual(summary.cardsCreated, 1)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.candidates.filter { $0.state == .filtered }.count, 3)
        XCTAssertTrue(state.candidates.contains { $0.sensitiveFlags.contains("screenshot") })
        XCTAssertTrue(state.candidates.contains { $0.sensitiveFlags.contains("unreadable") })
        XCTAssertEqual(state.dailyPreparations[day]?.aiPhotoCount, 1)
        _ = await runner.run(maximumCandidates: 9, targetDay: "2026-09-06")
        let reads = await source.readIDs()
        let calls = await service.calls()
        XCTAssertEqual(reads.count, 4)
        XCTAssertEqual(calls.detect, 1)
    }

    func testNewPhotoLocalInspectionStopsAtSeventyTwoWithoutUploadingScreenshots() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [])
        let environment = try await makeEnvironment(root: root, service: service)
        let jpeg = await makeBatchJPEG(index: 0)
        let source = SafetyPhotoSource(images: Array(repeating: jpeg, count: 100), screenshots: Set(0..<100))
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let first = await runner.run(maximumCandidates: 9, targetDay: day)
        XCTAssertEqual(first.inspected, 72)
        XCTAssertEqual(first.analyzed, 0)
        XCTAssertEqual(first.filtered, 72)
        XCTAssertEqual(first.failed, 0)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[day]?.status, .noNewCard)
        XCTAssertEqual(state.dailyPreparations[day]?.inspectedPhotoCount, 72)
        _ = await runner.run(maximumCandidates: 9, targetDay: day)
        let reads = await source.readIDs()
        let calls = await service.calls()
        XCTAssertEqual(reads.count, 72)
        XCTAssertEqual(calls.detect, 0)
    }

    func testSevenPreparedDaysKeepOfflineSwapsAfterForegroundAndBackgroundSync() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(1...21))
        let environment = try await makeEnvironment(root: root, service: service)
        let source = await makeBatchSource(count: 24)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let now = Date()
        let dates = (0..<7).map { ChinaDay.adding(days: $0, to: now) }
        let summary = await runner.replenishRollingWindow(maximumCandidates: 27)
        XCTAssertEqual(summary.analyzed, 21)
        XCTAssertEqual(summary.cardsCreated, 7)
        XCTAssertEqual(summary.failed, 0)
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.cards.count, 21)
        XCTAssertEqual(state.dailyPreparations.values.filter { $0.status == .ready }.count, 7)
        XCTAssertEqual(try widget.load().cards.count, 21, "Background sync must cache the six future days' runner-ups too")

        // Foreground reload must not strip the future runner-ups that the
        // background path just wrote through the same coordinator.
        try await WidgetCoordinator(repository: environment.repository, sharedStore: widget).synchronize()
        XCTAssertEqual(try widget.load().cards.count, 21)
        let initialHistory = CardHistoryResolver.resolve(cards: state.cards,
                                                        presentations: try widget.load().presentations, now: Date())
        XCTAssertEqual(initialHistory.map(\.id), [try XCTUnwrap(state.dailyPreparations[ChinaDay.string(from: now)]?.selectedCardID)],
                       "Prefetching must not put future cards or unseen runner-ups in history")
        let cached = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        // No app synchronization or AI invocation is allowed from here on.
        for date in dates {
            let day = ChinaDay.string(from: date)
            var queue = try cached.load()
            XCTAssertEqual(queue.dailySelections[day]?.pool.count, 3)
            XCTAssertEqual(queue.card(for: day)?.id, state.dailyPreparations[day]?.selectedCardID)
            XCTAssertTrue(queue.canAdvance(on: day))
            _ = try cached.advance(on: day, now: date.addingTimeInterval(1))
            _ = try cached.advance(on: day, now: date.addingTimeInterval(2))
            queue = try cached.load()
            XCTAssertFalse(queue.canAdvance(on: day))
            XCTAssertEqual(queue.dailySelections[day]?.swapCount, 2)
            XCTAssertEqual(queue.surfacedCards(on: day).count, 3)
            XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue, activeCardID: nil,
                                                      now: date.addingTimeInterval(3))?.id, queue.card(for: day)?.id)
            for card in queue.surfacedCards(on: day) {
                XCTAssertTrue(FileManager.default.fileExists(atPath: cached.thumbnailURL(for: card.candidateToken).path))
            }
        }
        let afterCacheEnds = ChinaDay.adding(days: 7, to: now)
        let queue = try cached.load()
        let lastDay = ChinaDay.string(from: try XCTUnwrap(dates.last))
        let finalCardID = queue.card(for: lastDay)?.id
        XCTAssertNil(queue.card(for: ChinaDay.string(from: afterCacheEnds)))
        XCTAssertEqual(queue.mostRecentCard(onOrBefore: ChinaDay.string(from: afterCacheEnds))?.id, finalCardID)
        XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue, activeCardID: nil,
                                                  now: afterCacheEnds)?.id, finalCardID)
        let history = CardHistoryResolver.resolve(cards: state.cards, presentations: queue.presentations, now: afterCacheEnds)
        XCTAssertEqual(Set(history.map(\.id)), Set(state.cards.map(\.id)))
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 21)
        XCTAssertEqual(calls.winner, 7)
    }

    func testBackgroundOpportunityPreparesMultipleDatesWithinNineTotalPhotos() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(1...21))
        let environment = try await makeEnvironment(root: root, service: service)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 21))
        let summary = await runner.replenishRollingWindow(maximumCandidates: AutomaticDiscoveryRunner.backgroundRefillPhotoLimit)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(summary.analyzed, 9)
        XCTAssertEqual(summary.cardsCreated, 3, "A background opportunity is not limited to one date")
        XCTAssertEqual(calls.detect, 9)
        XCTAssertEqual(state.dailyPreparations.count, 3)
        XCTAssertTrue(state.dailyPreparations.values.allSatisfy { $0.status == .ready && $0.aiPhotoCount == 3 })
        XCTAssertEqual(try widget.load().cards.count, 9)
    }

    func testRollingWarmupCapsTotalAttemptsAndKeepsPerDateLimit() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(stride(from: 3, through: 72, by: 3)))
        let environment = try await makeEnvironment(root: root, service: service)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: try SharedWidgetStore(baseURL: root.appendingPathComponent("widget")),
            photoSource: await makeBatchSource(count: 72))
        let summary = await runner.replenishRollingWindow(maximumCandidates: 999)
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(summary.analyzed, 63, "An oversized caller request is still bounded to seven dates of nine photos")
        XCTAssertEqual(summary.cardsCreated, 7)
        XCTAssertEqual(calls.detect, 63)
        XCTAssertEqual(state.dailyPreparations.count, 7)
        XCTAssertTrue(state.dailyPreparations.values.allSatisfy { $0.status == .ready && $0.aiPhotoCount == 9 })
    }

    func testOneQualifiedPhotoInEachNineFillsSevenDaysInOneForegroundOpportunity() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(stride(from: 9, through: 72, by: 9)))
        let environment = try await makeEnvironment(root: root, service: service)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 72))
        let now = Date()
        let summary = await runner.replenishRollingWindow(maximumCandidates: AutomaticDiscoveryRunner.foregroundRefillPhotoLimit)
        XCTAssertEqual(summary.analyzed, 63)
        XCTAssertEqual(summary.cardsCreated, 7, "The user must not reopen the app to continue a healthy but sparse warmup")
        XCTAssertEqual(summary.failed, 0)
        let state = await environment.repository.snapshot()
        let queue = try widget.load()
        XCTAssertEqual(state.cards.count, 7)
        XCTAssertEqual(queue.cards.count, 7)
        for offset in 0..<7 {
            let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
            let record = try XCTUnwrap(state.dailyPreparations[day])
            XCTAssertEqual(record.status, .ready)
            XCTAssertEqual(record.aiPhotoCount, 9)
            XCTAssertEqual(record.qualifiedCardIDs.count, 1)
            let card = try XCTUnwrap(queue.card(for: day))
            XCTAssertEqual(card.id, record.selectedCardID)
            XCTAssertNotNil(UIImage(contentsOfFile: widget.thumbnailURL(for: card.candidateToken).path))
        }
        let repeated = await runner.replenishRollingWindow(maximumCandidates: AutomaticDiscoveryRunner.foregroundRefillPhotoLimit)
        let calls = await service.calls()
        XCTAssertEqual(repeated.analyzed, 0, "A ready seven-day window must not repeat paid work")
        XCTAssertEqual(calls.detect, 63)
    }

    func testRollingFailureKeepsFirstCardAndStopsAtActualBlockingError() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [2, 3, 4], failingCalls: [5], sourceFailures: [1])
        let environment = try await makeEnvironment(root: root, service: service)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: await makeBatchSource(count: 21))
        let summary = await runner.replenishRollingWindow(maximumCandidates: 27) { next in
            if next.cardsCreated > 0 {
                let partial = await environment.repository.snapshot()
                XCTAssertEqual(partial.cards.count, 3, "Publish the first date before attempting tomorrow")
                XCTAssertNotNil(try? widget.load().card(for: ChinaDay.string(from: Date())))
            }
        }
        let state = await environment.repository.snapshot()
        let calls = await service.calls()
        XCTAssertEqual(summary.cardsCreated, 1)
        XCTAssertEqual(summary.analyzed, 5)
        XCTAssertEqual(summary.accessError, .requestFailed(503), "The earlier recoverable source error must not hide the stopping cause")
        XCTAssertEqual(calls.detect, 5)
        XCTAssertEqual(state.dailyPreparations.values.filter { $0.status == .ready }.count, 1)
        XCTAssertEqual(state.dailyPreparations.values.filter { $0.status == .retryableFailure }.count, 1)
        XCTAssertNotNil(try widget.load().card(for: ChinaDay.string(from: Date())))
    }

    func testRollingLeaseCoversProgressCallbackAndPauseStopsRemainingDays() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(1...21))
        let environment = try await makeEnvironment(root: root, service: service)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let source = await makeBatchSource(count: 21)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: source)
        let competing = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
            widgetStore: widget, photoSource: source)
        let summary = await runner.replenishRollingWindow(maximumCandidates: 27) { _ in
            let concurrent = await competing.replenishRollingWindow(maximumCandidates: 9)
            XCTAssertEqual(concurrent.analyzed, 0, "A foreground update cannot open a hole for a competing background loop")
            do { try await environment.repository.setAutomaticDiscovery(false) }
            catch { XCTFail("Pause failed: \(error)") }
        }
        let calls = await service.calls()
        let state = await environment.repository.snapshot()
        XCTAssertEqual(summary.cardsCreated, 1, "Keep the completed result even when later preparation is cancelled")
        XCTAssertEqual(calls.detect, 3)
        XCTAssertEqual(state.dailyPreparations.count, 1)
        XCTAssertFalse(state.automaticDiscoveryEnabled)
        XCTAssertNotNil(try widget.load().card(for: ChinaDay.string(from: Date())))
        // A normally resumed run must be able to acquire the released lease.
        try await environment.repository.setAutomaticDiscovery(true)
        let resumed = await competing.replenishRollingWindow(maximumCandidates: 9)
        XCTAssertEqual(resumed.cardsCreated, 3)
    }

    func testWidgetProjectionKeepsHistoryButNotUnscheduledOrOutOfWindowRunnerUps() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-07T04:00:00Z"))
        func card(_ index: Int, _ status: String, _ day: String) -> KnowledgeCard {
            makeCard(candidate: makeCandidate(), index: index).withPresentation(status: status, scheduledDay: day)
        }
        let today = card(0, "candidate", "2026-09-07")
        let lastCached = card(1, "candidate", "2026-09-13")
        let pastUnseen = card(2, "candidate", "2026-09-06")
        let pastSeen = card(3, "candidate", "2026-09-06")
        let unscheduled = card(4, "candidate", "")
        let beyondCache = card(5, "candidate", "2026-09-14")
        let previousMain = card(6, "shown", "2026-09-01")
        let selected = WidgetCoordinator.presentationCards(
            from: [today, lastCached, pastUnseen, pastSeen, unscheduled, beyondCache, previousMain],
            previouslyPresentedIDs: [pastSeen.id], now: now
        )
        XCTAssertEqual(Set(selected.map(\.id)), [today.id, lastCached.id, pastSeen.id, previousMain.id])
    }

    @MainActor
    func testSavingKeyResumesAutomaticPreparationAndForegroundCompletesRollingCache() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: Set(1...21))
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                    deviceBetaExperienceEnabled: false)
        try await environment.modelAccessStore.removeQwenAPIKey()
        let today = ChinaDay.string(from: Date())
        try await environment.repository.savePreparation(DailyPreparationRecord(day: today, status: .waitingForAccess))
        let source = await makeBatchSource(count: 21)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        // Avoid StoreKit product lookup only. App startup, save-Key action,
        // foreground resumption, runner, persistence and widget reads are real.
        let model = AppModel(environment: environment, launchArguments: ["-JianweiStorefrontPreview"],
                             automaticRunner: runner, photoAccessCheck: { .full })
        await model.start()
        XCTAssertTrue(model.isReady)
        let before = await service.calls()
        XCTAssertEqual(before.detect, 0)

        await model.saveAndUseQwenAPIKey("sk-new_synthetic_key_1234567890")
        XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
        XCTAssertTrue(model.hasQwenAPIKey)
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(model.preparedFutureDayCount, 6, "Today plus six future days must not require repeated foreground transitions")
        XCTAssertNotNil(model.currentCard)
        XCTAssertEqual(model.currentCard?.id, try widget.load().card(for: today)?.id)
        var calls = await service.calls()
        XCTAssertEqual(calls.detect, 21, "Seven successful dates need three qualified photos each, within the bounded warmup")

        await model.resumeFromBackground()
        XCTAssertEqual(model.preparedFutureDayCount, 6)
        await model.resumeFromBackground()
        XCTAssertEqual(model.preparedFutureDayCount, 6)
        let originalCardID = model.currentCard?.id
        await model.resumeFromBackground()
        calls = await service.calls()
        XCTAssertEqual(calls.detect, 21)
        XCTAssertEqual(calls.winner, 7)
        XCTAssertEqual(model.currentCard?.id, originalCardID)
        XCTAssertEqual(model.widgetQueueState.cards.count, 21)
        XCTAssertEqual(model.historyCards.count, 1, "Future cached cards must not appear early")
        let reads = await source.readIDs()
        XCTAssertEqual(Set(reads).count, 21)
        let disk = try LocalRepository(rootURL: root)
        let persisted = await disk.snapshot()
        XCTAssertEqual(persisted.dailyPreparations.values.filter { $0.status == .ready }.count, 7)
        XCTAssertTrue(persisted.dailyPreparations.values.allSatisfy { $0.aiPhotoCount <= 9 })
    }

    @MainActor
    func testDeletingKeyPreservesChosenBillingModeAndExistingCard() async throws {
        for mode: ModelAccessMode in [.qwenUserKey, .managed] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                        deviceBetaExperienceEnabled: false)
            try await environment.repository.setModelAccessMode(mode)
            let card = makeCard(candidate: makeCandidate(), index: 0)
                .withPresentation(status: "shown", scheduledDay: ChinaDay.string(from: Date()))
            try await environment.repository.upsert(card: card, sanitizedJPEG: makeBatchJPEG(index: 0))
            let model = AppModel(environment: environment, photoAccessCheck: { .full })
            await model.refreshPresentationState()
            await model.removeQwenAPIKey()
            XCTAssertEqual(model.modelAccessMode, mode, "Deleting a credential is not consent to switch billing providers")
            XCTAssertFalse(model.hasQwenAPIKey)
            XCTAssertEqual(model.currentCard?.id, card.id)
            XCTAssertEqual(model.historyCards.map(\.id), [card.id])
            XCTAssertTrue(model.automaticDiscoveryEnabled, "Keep the user's auto preference separate from a missing Key")
            if mode == .qwenUserKey {
                do { _ = try await environment.pipeline.preflightModelAccess(); XCTFail("Missing Key used another provider") }
                catch { XCTAssertEqual(error as? ProductError, .apiKeyRequired) }
            }
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0)
        }
    }

    @MainActor
    func testKeySaveDoesNotOverridePauseOrMissingPhotoPermission() async throws {
        for (automatic, permission): (Bool, PhotoAccessState) in [(false, .full), (true, .denied)] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: Set(1...3))
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                        deviceBetaExperienceEnabled: false)
            try await environment.repository.setAutomaticDiscovery(automatic)
            let source = await makeBatchSource(count: 3)
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { permission })
            await model.refreshPresentationState()
            await model.saveAndUseQwenAPIKey("sk-new_synthetic_key_1234567890")
            XCTAssertTrue(model.hasQwenAPIKey)
            XCTAssertFalse(model.isWorking)
            XCTAssertFalse(model.automaticDiscoveryEnabled)
            let calls = await service.calls()
            let reads = await source.readIDs()
            XCTAssertEqual(calls.detect, 0)
            XCTAssertTrue(reads.isEmpty)
        }
    }

    @MainActor
    func testInvalidKeyDoesNotEraseExistingKeyOrStartPreparation() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                    deviceBetaExperienceEnabled: false)
        let before = try await environment.modelAccessStore.request(for: .qwenUserKey)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        await model.saveAndUseQwenAPIKey("not-a-key")
        let after = try await environment.modelAccessStore.request(for: .qwenUserKey)
        XCTAssertEqual(after.apiKey, before.apiKey)
        XCTAssertEqual(model.message, ProductError.invalidAPIKey.errorDescription)
        XCTAssertFalse(model.isWorking)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
    }

    @MainActor
    func testDeletingActiveBYOKKeyCancelsRemainingModelStagesWithoutChangingMode() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyQwen(suspendAt: .detect, modelKnowledge: true)
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                    deviceBetaExperienceEnabled: false)
        let source = await makeBatchSource(count: 3)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        let work = Task { await model.replenishRollingCache() }
        await fulfillment(of: [service.entered], timeout: 3)
        await model.removeQwenAPIKey()
        await service.resume()
        await work.value
        XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
        XCTAssertFalse(model.hasQwenAPIKey)
        XCTAssertFalse(model.isWorking)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 1)
        XCTAssertEqual(calls.knowledge, 0)
        XCTAssertEqual(calls.winner, 0)
        XCTAssertTrue(model.state.cards.isEmpty)
        XCTAssertEqual(model.state.dailyPreparations[ChinaDay.string(from: Date())]?.aiPhotoCount, 1,
                       "An already-sent request keeps its reservation after deletion")
    }

    @MainActor
    func testPurchaseAndManagedRestoreResumeSelectionWithoutResendingPhotos() async throws {
        for purchasing in [true, false] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [])
            let subscription = SafetySubscription(state: .subscribed)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(
                root: root, service: service, managedPrivacy: true, sharedStore: widget,
                deviceBetaExperienceEnabled: false, subscription: subscription,
                transport: SafetyWinnerURLProtocol.self)
            try await environment.repository.setModelAccessMode(purchasing ? .qwenUserKey : .managed)
            let old = try await seedPreviousCard(environment: environment)
            let cards = try await seedCarryover(count: 3, environment: environment)
            let today = ChinaDay.string(from: Date())
            try await environment.repository.savePreparation(DailyPreparationRecord(day: today, status: .waitingForAccess))
            let source = SafetyPhotoSource(images: [])
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
            await model.refreshPresentationState()
            if purchasing { await model.purchaseManagedModelService() }
            else { await model.restoreManagedSubscription() }

            XCTAssertEqual(model.managedSubscriptionState, .subscribed)
            XCTAssertEqual(model.modelAccessMode, .managed)
            XCTAssertFalse(model.isWorking)
            XCTAssertEqual(model.state.dailyPreparations[today]?.status, .ready)
            let selected = try XCTUnwrap(model.state.dailyPreparations[today]?.selectedCardID)
            XCTAssertTrue(cards.contains { $0.id == selected })
            XCTAssertEqual(model.currentCard?.id, selected)
            XCTAssertEqual(try widget.load().card(for: today)?.id, selected)
            XCTAssertTrue(model.state.cards.contains { $0.id == old.id })
            XCTAssertTrue(model.historyCards.contains { $0.id == old.id })
            XCTAssertEqual(model.state.dailyPreparations[today]?.aiPhotoCount, 0,
                           "Already-qualified cards must not require another image upload")
            if purchasing {
                let installationID = try await XCTUnwrap(environment.identity).installationID()
                XCTAssertEqual(subscription.purchaseTokens, [installationID])
            } else { XCTAssertEqual(subscription.restoreCount, 1) }
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0)
            XCTAssertEqual(calls.winner, 0, "Managed recovery must not use the user's Key")
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty)
        }
    }

    @MainActor
    func testUnconfirmedOrCancelledPurchaseNeverChangesBillingMode() async throws {
        let scenarios: [(SubscriptionPurchaseOutcome, ManagedSubscriptionState, ProductError?)] = [
            (.cancelled, .subscribed, nil), (.cancelled, .notSubscribed, nil),
            (.purchased, .notSubscribed, nil), (.purchased, .subscribed, .subscriptionPending),
            (.purchased, .subscribed, .subscriptionVerificationFailed)
        ]
        for (outcome, entitlement, error) in scenarios {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [1])
            let subscription = SafetySubscription(state: entitlement, outcome: outcome, purchaseError: error)
            let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
                                                        deviceBetaExperienceEnabled: false, subscription: subscription)
            try await environment.repository.setModelAccessMode(.qwenUserKey)
            let source = await makeBatchSource(count: 3)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
            await model.refreshPresentationState()
            await model.purchaseManagedModelService()
            XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
            XCTAssertFalse(model.isWorking)
            XCTAssertTrue(model.state.dailyPreparations.isEmpty)
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty)
        }
    }

    @MainActor
    func testRestoreOnlyResumesAnAlreadySelectedManagedServiceWithEntitlement() async throws {
        let scenarios: [(ModelAccessMode, ManagedSubscriptionState, Bool)] = [
            (.qwenUserKey, .subscribed, false), (.managed, .notSubscribed, false), (.managed, .subscribed, true)
        ]
        for (mode, entitlement, fails) in scenarios {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [1])
            let subscription = SafetySubscription(state: entitlement, restoreError: fails ? .requestFailed(-1) : nil)
            let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
                                                        deviceBetaExperienceEnabled: false, subscription: subscription)
            try await environment.repository.setModelAccessMode(mode)
            let source = await makeBatchSource(count: 3)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
            await model.refreshPresentationState()
            await model.restoreManagedSubscription()
            XCTAssertEqual(model.modelAccessMode, mode)
            XCTAssertFalse(model.isWorking)
            XCTAssertTrue(model.state.dailyPreparations.isEmpty)
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty)
        }
    }

    @MainActor
    func testEntitlementRecoveryDoesNotOverridePauseOrPhotoPermission() async throws {
        for purchasing in [true, false] {
            for paused in [true, false] {
                let root = temporaryRoot()
                defer { try? FileManager.default.removeItem(at: root) }
                let service = SafetyBatchQwen(qualifiedCalls: [1])
                let subscription = SafetySubscription(state: .subscribed)
                let environment = try await makeEnvironment(root: root, service: service, managedPrivacy: true,
                                                            deviceBetaExperienceEnabled: false, subscription: subscription)
                try await environment.repository.setAutomaticDiscovery(!paused)
                let source = await makeBatchSource(count: 3)
                let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
                let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                     widgetStore: widget, photoSource: source)
                let model = AppModel(environment: environment, automaticRunner: runner,
                                     photoAccessCheck: { paused ? .full : .denied })
                await model.refreshPresentationState()
                if purchasing { await model.purchaseManagedModelService() }
                else { await model.restoreManagedSubscription() }
                XCTAssertFalse(model.isWorking)
                XCTAssertFalse(model.automaticDiscoveryEnabled)
                XCTAssertTrue(model.state.dailyPreparations.isEmpty)
                let reads = await source.readIDs()
                XCTAssertTrue(reads.isEmpty)
            }
        }
    }

    @MainActor
    func testForegroundDayChangePreparesNewCardAfterYesterdayHadNone() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [1])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget,
                                                    deviceBetaExperienceEnabled: false)
        let old = try await seedPreviousCard(environment: environment, daysAgo: 2)
        let yesterday = ChinaDay.string(from: ChinaDay.adding(days: -1, to: Date()))
        try await environment.repository.savePreparation(DailyPreparationRecord(day: yesterday, status: .noNewCard, aiPhotoCount: 9))
        let source = await makeBatchSource(count: 3)
        let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                             widgetStore: widget, photoSource: source)
        let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        XCTAssertEqual(model.currentCard?.id, old.id)
        await model.dayDidChange()
        let today = ChinaDay.string(from: Date())
        XCTAssertEqual(model.state.dailyPreparations[today]?.status, .ready)
        let selected = try XCTUnwrap(model.state.dailyPreparations[today]?.selectedCardID)
        XCTAssertNotEqual(selected, old.id)
        XCTAssertEqual(model.currentCard?.id, selected)
        XCTAssertEqual(try widget.load().card(for: today)?.id, selected)
        XCTAssertTrue(model.historyCards.contains { $0.id == old.id })
        await model.dayDidChange()
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 3, "Repeated day events must not re-analyze completed photos")
        XCTAssertFalse(model.isWorking)
    }

    @MainActor
    func testDayChangeDoesNotPrepareWhenPausedDeniedReadOnlyOrCancelled() async throws {
        for scenario in ["paused", "denied", "readOnly", "cancelled"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [1])
            let environment = try await makeEnvironment(root: root, service: service, deviceBetaExperienceEnabled: false)
            if scenario == "paused" { try await environment.repository.setAutomaticDiscovery(false) }
            let before = await environment.repository.snapshot()
            let source = await makeBatchSource(count: 3)
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                                 widgetStore: widget, photoSource: source)
            let model = AppModel(environment: environment,
                                 launchArguments: scenario == "readOnly" ? ["-JianweiReadOnlyStateProbe"] : [],
                                 automaticRunner: runner, photoAccessCheck: { scenario == "denied" ? .denied : .full })
            if scenario == "cancelled" {
                let gate = SafetySuspension()
                let task = Task { await gate.wait(); await model.dayDidChange() }
                task.cancel()
                await gate.resume()
                await task.value
            } else { await model.dayDidChange() }
            let after = await environment.repository.snapshot()
            XCTAssertEqual(after.candidates.count, before.candidates.count)
            XCTAssertTrue(after.dailyPreparations.isEmpty)
            XCTAssertFalse(model.isWorking)
            let reads = await source.readIDs()
            XCTAssertTrue(reads.isEmpty)
        }
    }

    @MainActor
    func testActiveRefillKeepsCurrentCardAndSeparatesFirstCardFromFutureInventory() async throws {
        for (scenario, offsets) in [("first", [Int]()), ("current", [0, 1, 2]), ("fallback", [-1, 1, 2])] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [])
            let store = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: store)
            try await environment.repository.setAutomaticDiscovery(false)
            for offset in offsets {
                let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: Date()))
                let card = makeCard(candidate: makeCandidate(), index: offset)
                    .withPresentation(status: "scheduled", scheduledDay: day)
                try await environment.repository.upsert(card: card, sanitizedJPEG: nil)
                try await environment.repository.savePreparation(DailyPreparationRecord(day: day, status: .ready,
                    qualifiedCardIDs: [card.id], selectedCardID: card.id))
            }
            let gate = SafetySuspension()
            let started = expectation(description: "Photo query started: \(scenario)")
            let runner = AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                widgetStore: store, photoSource: SuspendedEmptyPhotoSource(gate: gate, started: started))
            let model = AppModel(environment: environment, automaticRunner: runner, photoAccessCheck: { .full })
            await model.start()
            let currentID = model.currentCard?.id
            try await environment.repository.setAutomaticDiscovery(true)
            await model.refreshPresentationState()
            let task = Task { await model.replenishRollingCache() }
            defer { Task { await gate.resume() } }
            await fulfillment(of: [started], timeout: 10)
            XCTAssertTrue(model.isWorking)
            XCTAssertEqual(model.currentCard?.id, currentID)
            let presentation = model.preparationPresentation
            if scenario == "first" {
                XCTAssertNil(currentID)
                XCTAssertEqual(presentation.title, "正在替你找今天的一条")
                XCTAssertEqual(model.preparedFutureDayCount, 0)
            } else {
                XCTAssertNotNil(currentID)
                XCTAssertEqual(presentation.title, scenario == "current" ? "今天的知识已就绪" : "正在准备今天的新知识")
                XCTAssertTrue(presentation.detail.contains("未来 2 天"))
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let renderer = ImageRenderer(content: PreparationStatusText(presentation: presentation)
                        .environment(\.dynamicTypeSize, size).frame(width: 284, alignment: .leading)
                        .padding(18).background(JianweiBrand.paper))
                    let rendered = try XCTUnwrap(renderer.uiImage)
                    XCTAssertEqual(rendered.size.width, 320, accuracy: 0.5)
                    let attachment = XCTAttachment(image: rendered)
                    attachment.name = "refill-\(scenario)-\(size == .large ? "normal" : "accessibility")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
            await gate.resume()
            await task.value
            XCTAssertFalse(model.isWorking)
            XCTAssertEqual(model.currentCard?.id, currentID)
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0, "UI tests must not generate knowledge")
        }
    }

    @MainActor
    func testPreparationPresentationReflectsPauseAccessAndActualCarryover() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        try await environment.repository.setAutomaticDiscovery(false)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.start()
        XCTAssertTrue(model.modelAccessReady)
        XCTAssertEqual(model.preparationSummary, "自动发现已暂停")
        XCTAssertEqual(model.preparationPresentation.action, .enableDiscovery)
        let today = ChinaDay.string(from: Date())
        try await environment.repository.setAutomaticDiscovery(true)
        for status in [DailyPreparationStatus.noNewCard, .waitingForPhotos, .retryableFailure, .queued, .preparing, .ready] {
            try await environment.repository.savePreparation(DailyPreparationRecord(day: today, status: status))
            await model.refreshPresentationState()
            XCTAssertNil(model.currentCard)
            XCTAssertFalse(model.preparationSummary.contains("上一条"), "There is no card to retain: \(status)")
            XCTAssertFalse(model.preparationSummary.contains("正在"), "A persisted record is not a running task: \(status)")
            XCTAssertNotEqual(model.preparationPresentation.symbol, "checkmark.circle")
            if status == .retryableFailure {
                XCTAssertFalse(model.preparationPresentation.detail.contains("网络或服务"),
                               "A persisted retryable status does not identify which processing stage failed")
            }
        }
        let previous = try await seedPreviousCard(environment: environment)
        try await environment.repository.savePreparation(DailyPreparationRecord(day: today, status: .noNewCard))
        await model.refreshPresentationState()
        XCTAssertEqual(model.currentCard?.id, previous.id)
        XCTAssertEqual(model.preparationSummary, "今天暂时没有新知识，继续展示上一条")
        await model.removeQwenAPIKey()
        XCTAssertFalse(model.modelAccessReady)
        XCTAssertEqual(model.preparationPresentation.action, .modelSettings)
        XCTAssertEqual(model.currentCard?.id, previous.id)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
    }

    @MainActor
    func testPreparationPermissionRecoveryAndSavedKeySwitchDoNotSwitchBillingImplicitly() async throws {
        for permission in [PhotoAccessState.denied, .notDetermined, .full, .limited] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let service = SafetyBatchQwen(qualifiedCalls: [])
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
            try await environment.repository.setAutomaticDiscovery(false)
            let model = AppModel(environment: environment, photoAccessCheck: { permission })
            await model.start()
            let hasAccess = permission == .full || permission == .limited
            XCTAssertEqual(model.preparationPresentation.action,
                           permission == .denied ? .photoSettings : .enableDiscovery)
            XCTAssertEqual(model.preparationSummary, hasAccess ? "自动发现已暂停" : "需要照片权限才能自动准备")
            try await environment.repository.setModelAccessMode(.managed)
            await model.refreshPresentationState()
            XCTAssertFalse(model.modelAccessReady, "An unconfigured managed service must not pass due to Beta or a saved BYOK Key")
            await model.useSavedQwenAPIKey()
            XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
            XCTAssertTrue(model.modelAccessReady)
            XCTAssertFalse(model.automaticDiscoveryEnabled, "Switching services cannot override an explicit pause")
            try await environment.repository.setModelAccessMode(.managed)
            await model.removeQwenAPIKey()
            await model.useSavedQwenAPIKey()
            XCTAssertEqual(model.modelAccessMode, .managed, "A failed explicit switch must preserve the original mode")
            let calls = await service.calls()
            XCTAssertEqual(calls.detect, 0)
        }
    }

    @MainActor
    func testEmptyWidgetEntryReturnsHomeWithoutStartingAnalysisOrLosingHistory() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = SafetyBatchQwen(qualifiedCalls: [])
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: service, sharedStore: widget)
        try await environment.repository.setAutomaticDiscovery(false)
        let previous = try await seedPreviousCard(environment: environment)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        let cardURL = try XCTUnwrap(URL(string: "jianwei://card/\(previous.id.uuidString)"))
        let startURL = try XCTUnwrap(URL(string: "jianwei://start"))

        model.open(url: cardURL) // Queued before disk state is available.
        model.open(url: startURL) // The user's newer intent supersedes it.
        await model.start()
        XCTAssertNil(model.presentedCardID)
        XCTAssertEqual(model.selectedSection, .today)

        model.open(url: cardURL)
        XCTAssertEqual(model.presentedCardID, previous.id)
        model.selectedSection = .settings
        model.open(url: try XCTUnwrap(URL(string: "https://start")))
        XCTAssertEqual(model.selectedSection, .settings)
        XCTAssertEqual(model.presentedCardID, previous.id)
        model.open(url: startURL)
        XCTAssertEqual(model.selectedSection, .today)
        XCTAssertNil(model.presentedCardID)
        XCTAssertFalse(model.automaticDiscoveryEnabled, "An entry link cannot authorize uploads or unpause discovery")
        XCTAssertEqual(model.currentCard?.id, previous.id)
        XCTAssertEqual(model.state.cards.count, 1)
        let calls = await service.calls()
        XCTAssertEqual(calls.detect, 0)
    }

    @MainActor
    func testPrivateFeedbackCannotBeUndoneByALateWidgetProjection() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), sharedStore: widget)
        let today = ChinaDay.string(from: Date())
        var cards: [KnowledgeCard] = []
        for index in 0..<2 {
            var candidate = makeCandidate()
            candidate.state = .selected
            let card = makeCard(candidate: candidate, index: index).withPresentation(status: "scheduled", scheduledDay: today)
            try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: makeJPEG())
            cards.append(card)
        }
        let privateCard = cards[0]
        try await environment.repository.setSaved(true, cardID: privateCard.id)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        XCTAssertEqual(try widget.load().cards.count, 2)
        XCTAssertTrue(FileManager.default.fileExists(atPath: widget.thumbnailURL(for: privateCard.candidateToken).path))

        await model.submitFeedback(card: privateCard, action: .tooPrivate)
        // The late caller can no longer supply its pre-feedback card list.
        try await environment.widgetCoordinator.synchronize()

        let queue = try widget.load()
        XCTAssertEqual(queue.cards.map(\.id), [cards[1].id], "A late projection must not resurrect the hidden card")
        XCTAssertFalse(queue.presentations.contains { $0.cardID == privateCard.id })
        XCTAssertFalse(FileManager.default.fileExists(atPath: widget.thumbnailURL(for: privateCard.candidateToken).path))
        let state = await environment.repository.snapshot()
        XCTAssertEqual(state.cards.map(\.id), [cards[1].id])
        XCTAssertFalse(state.savedCardIDs.contains(privateCard.id))
        XCTAssertEqual(state.candidates.first { $0.id == privateCard.candidateToken }?.state, .neverAnalyze)
        XCTAssertFalse(model.historyCards.contains { $0.id == privateCard.id })
    }

    @MainActor
    func testLocalDeletionCannotBeUndoneByALateWidgetProjection() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), sharedStore: widget)
        _ = try await seedPreviousCard(environment: environment)
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        XCTAssertEqual(try widget.load().cards.count, 1)

        await model.deleteLocalData()
        try await environment.widgetCoordinator.synchronize()

        let queue = try widget.load()
        XCTAssertTrue(queue.cards.isEmpty, "Deletion must win over work holding pre-deletion cards")
        XCTAssertTrue(queue.presentations.isEmpty)
        XCTAssertNil(queue.card(for: ChinaDay.string(from: Date())))
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertTrue(state.candidates.isEmpty)
        XCTAssertFalse(state.automaticDiscoveryEnabled)
        XCTAssertNil(model.currentCard)
    }

    @MainActor
    func testLatePreviousDayWidgetSwapCannotBeErasedByPreparedProjection() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
        let environment = try await makeEnvironment(root: root, service: SafetyQwen(), sharedStore: widget)
        let now = Date()
        let previousDay = ChinaDay.string(from: ChinaDay.adding(days: -1, to: now))
        var cards: [KnowledgeCard] = []
        let jpeg = makeJPEG()
        for index in 0..<2 {
            var candidate = makeCandidate()
            candidate.state = index == 0 ? .selected : .knowledgeReady
            let card = makeCard(candidate: candidate, index: index)
                .withPresentation(status: index == 0 ? "shown" : "candidate", scheduledDay: previousDay)
            try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: jpeg)
            cards.append(card)
        }
        let winner = cards[0]
        let runnerUp = cards[1]
        try widget.replaceCards(try cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) },
                                thumbnails: Dictionary(uniqueKeysWithValues: cards.map { ($0.candidateToken, jpeg) }))
        let captured = await environment.repository.snapshot()
        let staleProjection = WidgetCoordinator.presentationCards(
            from: captured.cards,
            previouslyPresentedIDs: Set(try widget.load().presentations.map(\.cardID)), now: now
        )
        XCTAssertEqual(staleProjection.map(\.id), [winner.id])

        // A widget action captured yesterday's day before midnight, then won
        // the shared lock while the app was preparing today's projection.
        XCTAssertEqual(try widget.advance(on: previousDay), .advanced(runnerUp.id))
        let before = try widget.load()
        let thumbnailBefore = try Data(contentsOf: widget.thumbnailURL(for: runnerUp.candidateToken))
        let committed = try await environment.repository.commitWidgetProjection(
            expectedCards: captured.cards, expectedManualCandidateIDs: [],
            snapshots: try staleProjection.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) },
            thumbnails: [winner.candidateToken: jpeg], store: widget
        )
        XCTAssertFalse(committed, "A stale projection must retry rather than erase a new widget presentation")
        let after = try widget.load()
        XCTAssertEqual(after, before, "Rejected writes must preserve selection, history and swap count")
        XCTAssertEqual(try Data(contentsOf: widget.thumbnailURL(for: runnerUp.candidateToken)), thumbnailBefore)

        // The existing bounded retry must re-read shared history, keep the
        // already-seen runner-up and remain stable across another refresh.
        try await environment.widgetCoordinator.synchronize()
        let model = AppModel(environment: environment, photoAccessCheck: { .full })
        await model.refreshPresentationState()
        XCTAssertEqual(model.currentCard?.id, runnerUp.id)
        XCTAssertEqual(Set(model.historyCards.map(\.id)), Set(cards.map(\.id)))
        XCTAssertEqual(try widget.load().dailySelections[previousDay]?.swapCount, 1)
        XCTAssertNotNil(UIImage(contentsOfFile: widget.thumbnailURL(for: runnerUp.candidateToken).path),
                        "Accepted synchronization can recompress the thumbnail, but cannot remove it")

        // Preserving a concurrent presentation is not permission to resurrect
        // a card the user subsequently marks private.
        await model.submitFeedback(card: runnerUp, action: .tooPrivate)
        try await environment.widgetCoordinator.synchronize()
        XCTAssertFalse(try widget.load().cards.contains { $0.id == runnerUp.id })
        XCTAssertFalse(model.historyCards.contains { $0.id == runnerUp.id })
        XCTAssertFalse(FileManager.default.fileExists(atPath: widget.thumbnailURL(for: runnerUp.candidateToken).path))
    }

    @MainActor
    func testPreparedWidgetWriteIsRejectedAfterDeletionHidingOrNewerCards() async throws {
        for change in ["delete", "hide", "new-card", "pause"] {
            let root = temporaryRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let widget = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let environment = try await makeEnvironment(root: root, service: SafetyQwen(), sharedStore: widget)
            let candidate = makeCandidate()
            let card = makeCard(candidate: candidate, index: 0)
                .withPresentation(status: "scheduled", scheduledDay: ChinaDay.string(from: Date()))
            let jpeg = makeJPEG()
            try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: jpeg)
            let captured = await environment.repository.snapshot()
            let snapshots = try captured.cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }
            let acquired = await environment.repository.acquireAutomaticDiscoveryRun { _ in true }
            let run = try XCTUnwrap(acquired)
            defer { run.cancel() }

            // Interleave exactly after a writer has prepared its private image
            // bytes but before its final shared-cache write; no timing guess.
            switch change {
            case "delete": try await environment.repository.deleteLocalData()
            case "hide": try await environment.repository.hideCard(card.id, candidateToken: candidate.id, neverAnalyze: true)
            case "new-card":
                _ = try await seedPreviousCard(environment: environment, daysAgo: 0)
            default: try await environment.repository.setAutomaticDiscovery(false)
            }
            try await environment.widgetCoordinator.synchronize()
            let before = try widget.load()
            if change == "pause" {
                do {
                    _ = try await environment.repository.commitWidgetProjection(
                        expectedCards: captured.cards, expectedManualCandidateIDs: [], snapshots: snapshots,
                        thumbnails: [candidate.id: jpeg], store: widget, discoveryRun: run
                    )
                    XCTFail("A cancelled background writer cannot commit")
                } catch { XCTAssertTrue(error is CancellationError) }
            } else {
                let committed = try await environment.repository.commitWidgetProjection(
                    expectedCards: captured.cards, expectedManualCandidateIDs: [], snapshots: snapshots,
                    thumbnails: [candidate.id: jpeg], store: widget
                )
                XCTAssertFalse(committed, change)
            }
            let after = try widget.load()
            XCTAssertEqual(after.cards, before.cards, change)
            XCTAssertEqual(after.presentations, before.presentations, change)
            if change == "delete" || change == "hide" {
                XCTAssertFalse(FileManager.default.fileExists(atPath: widget.thumbnailURL(for: candidate.id).path), change)
            }
            await environment.repository.endAutomaticDiscoveryRun(run)
        }
    }

    private func seedPreviousCard(environment: AppEnvironment, daysAgo: Int = 1) async throws -> KnowledgeCard {
        let candidate = makeCandidate()
        let card = makeCard(candidate: candidate, index: 999)
        try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: Data())
        let date = ChinaDay.adding(days: -daysAgo, to: Date())
        _ = try await environment.repository.publishCardImmediately(cardID: card.id, day: ChinaDay.string(from: date), publishedAt: date)
        return card
    }

    private func makeBatchSource(count: Int) async -> SafetyPhotoSource {
        var images: [Data] = []
        for index in 0..<count { images.append(await makeBatchJPEG(index: index)) }
        return SafetyPhotoSource(images: images)
    }

    @MainActor
    private func makeBatchJPEG(index: Int) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128), format: format)
            .jpegData(withCompressionQuality: 1) { context in
                for y in 0..<8 {
                    for x in 0..<8 {
                        // A sharp checkerboard plus an index row produces distinct
                        // real perceptual hashes without bypassing deduplication.
                        let white = y == 0 ? (index & (1 << x)) != 0 : (x + y).isMultiple(of: 2)
                        (white ? UIColor.white : UIColor.black).setFill()
                        context.fill(CGRect(x: x * 16, y: y * 16, width: 16, height: 16))
                    }
                }
            }
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("jianwei-discovery-safety-" + UUID().uuidString)
    }

    private func makeRunner(environment: AppEnvironment, root: URL) throws -> AutomaticDiscoveryRunner {
        AutomaticDiscoveryRunner(environment: environment, authorizationCheck: { _ in true },
                                 widgetStore: try SharedWidgetStore(baseURL: root.appendingPathComponent("widget")))
    }

    private func makeEnvironment(
        root: URL, service: any DirectQwenServing, managedPrivacy: Bool = false,
        sharedStore: SharedWidgetStore? = nil, deviceBetaExperienceEnabled: Bool = true,
        subscription suppliedSubscription: (any ManagedSubscriptionServing)? = nil,
        transport: URLProtocol.Type = SafetyPrivacyURLProtocol.self, usesRealVision: Bool = false,
        privacyAnalyzer: PhotoPrivacyAnalyzer? = nil
    ) async throws -> AppEnvironment {
        let repository = try LocalRepository(rootURL: root)
        let secrets = SafetySecrets()
        let access = AIModelAccessStore(keychain: secrets)
        try await access.saveQwenAPIKey("sk-discovery_safety_fake_1234567890")
        try await repository.setModelAccessMode(managedPrivacy ? .managed : .qwenUserKey)
        try await repository.setAutomaticDiscovery(true)
        let subscription: any ManagedSubscriptionServing
        if let suppliedSubscription { subscription = suppliedSubscription }
        else { subscription = await MainActor.run { SubscriptionStore() } }
        let api: APIClient?
        let identity: DeviceIdentityStore?
        if managedPrivacy {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [transport]
            api = try APIClient(baseURL: URL(string: "https://discovery-safety.invalid")!, session: URLSession(configuration: configuration))
            try secrets.set("safety-device", for: "device-id")
            try secrets.set(String(repeating: "a", count: 43), for: "device-token")
            identity = DeviceIdentityStore(api: try XCTUnwrap(api), keychain: secrets)
        } else {
            api = nil
            identity = nil
        }
        let pipeline = AnalysisPipeline(
            api: api, identity: identity,
            analyzer: privacyAnalyzer ?? (usesRealVision ? PhotoPrivacyAnalyzer() : PhotoPrivacyAnalyzer(testingObservations: .authorizedFixtureSafe)),
            modelAccessStore: access, subscriptionStore: subscription, repository: repository,
            directQwen: service, knowledgeCatalog: try BundledKnowledgeCatalog.load(),
            allowsMissingManagedTransaction: deviceBetaExperienceEnabled
        )
        return AppEnvironment(repository: repository, discovery: PhotoDiscoveryService(), pipeline: pipeline,
                              api: api, identity: identity, modelAccessStore: access, subscriptionStore: subscription,
                              widgetCoordinator: WidgetCoordinator(repository: repository, sharedStore: sharedStore),
                              deviceBetaExperienceEnabled: deviceBetaExperienceEnabled)
    }

    private func makeCandidate() -> PhotoCandidateRecord {
        PhotoCandidateRecord(id: UUID(), localIdentifier: "synthetic-" + UUID().uuidString,
                             capturedAt: nil, perceptualHash: nil, qualityScore: 1, localLabels: [],
                             sensitiveFlags: [], state: .failed, updatedAt: Date())
    }

    private func makeCard(candidate: PhotoCandidateRecord, index: Int) -> KnowledgeCard {
        KnowledgeCard(id: UUID(), candidateToken: candidate.id, topicID: "safety-\(index)", factID: "safety-fact-\(index)",
                      title: "测试知识", objectName: "测试物件", body: "用于本机状态机测试的合成卡片。",
                      personalContext: "合成测试", confidence: 0.9, boundingBox: nil,
                      sources: [KnowledgeSource(id: "safety", title: "Test", url: URL(string: "https://example.com")!,
                                                publisher: "Test", authority: "general")],
                      status: "candidate", scheduledDay: "", createdAt: Date(timeIntervalSince1970: Double(index)))
    }

    private func seedCarryover(count: Int, environment: AppEnvironment) async throws -> [KnowledgeCard] {
        var cards: [KnowledgeCard] = []
        for index in 0..<count {
            var candidate = makeCandidate()
            candidate.state = .knowledgeReady
            let card = makeCard(candidate: candidate, index: index)
            try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: Data())
            cards.append(card)
        }
        return cards
    }

    @MainActor
    private func makeJPEG() -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64), format: format)
            .jpegData(withCompressionQuality: 1) { context in
                UIColor.white.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
                UIColor.black.setFill()
                context.fill(CGRect(x: 18, y: 16, width: 28, height: 32))
            }
    }
}

/// Photos cancellation is permitted to omit the callback. Keeping it suspended
/// reproduces an iCloud request without involving the network or real photos.
private final class SuspendedPhotoImageManager: PHImageManager, @unchecked Sendable {
    let started = XCTestExpectation(description: "Photos data request started")
    private let lock = NSLock()
    private var callback: ((Data?, String?, CGImagePropertyOrientation, [AnyHashable: Any]?) -> Void)?
    private var cancellations: [PHImageRequestID] = []
    private let immediateData: Data?
    private let returnIDGate: DispatchSemaphore?
    var cancelledIDs: [PHImageRequestID] { lock.withLock { cancellations } }
    var hasStarted: Bool { lock.withLock { callback != nil } }

    init(immediateData: Data? = nil, returnIDGate: DispatchSemaphore? = nil) {
        self.immediateData = immediateData
        self.returnIDGate = returnIDGate
        super.init()
    }

    override func requestImageDataAndOrientation(
        for asset: PHAsset, options: PHImageRequestOptions?,
        resultHandler: @escaping (Data?, String?, CGImagePropertyOrientation, [AnyHashable: Any]?) -> Void
    ) -> PHImageRequestID {
        lock.withLock { callback = resultHandler }
        started.fulfill()
        if let immediateData { resultHandler(immediateData, "public.jpeg", .up, nil) }
        if let returnIDGate { _ = returnIDGate.wait(timeout: .now() + 3) }
        return 42
    }

    override func cancelImageRequest(_ requestID: PHImageRequestID) {
        lock.withLock { cancellations.append(requestID) }
    }

    func deliver(data: Data?, info: [AnyHashable: Any]? = nil) {
        let handler = lock.withLock { callback }
        handler?(data, "public.jpeg", .up, info)
    }
}

private struct SafetyRequestPhotoSource: AutomaticPhotoSource {
    let source: PhotoDiscoveryService
    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference] {
        [PhotoAssetReference(localIdentifier: "synthetic-system-read", capturedAt: nil,
                             modifiedAt: nil, isScreenshot: false)]
            .filter { !excludingLocalIdentifiers.contains($0.localIdentifier) }.prefix(max(0, limit)).map { $0 }
    }
    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        try await source.imageData(for: PHAsset())
    }
}

/// Limit integration tests to their own generated image, without replacing
/// PhotoKit's query, data request or permission checks with synthetic results.
private struct ScopedSystemPhotoSource: AutomaticPhotoSource {
    let source: PhotoDiscoveryService
    let identifier: String
    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference] {
        try await source.recentAssets(days: days, limit: limit, excludingLocalIdentifiers: excludingLocalIdentifiers)
            .filter { $0.localIdentifier == identifier }
    }
    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        try await source.imageData(for: reference)
    }
}

/// Only the photo-library I/O boundary is replaced. Ordering, sanitization,
/// local quality/hash filtering, pipeline, persistence and widget projection
/// remain the same implementations used by automatic discovery in the app.
private actor SafetyPhotoSource: AutomaticPhotoSource {
    private let images: [Data]
    private let screenshots: Set<Int>
    private var reads: [String] = []
    private var limits: [Int] = []

    init(images: [Data], screenshots: Set<Int> = []) {
        self.images = images
        self.screenshots = screenshots
    }

    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference] {
        limits.append(limit)
        return images.indices.lazy.filter { !excludingLocalIdentifiers.contains("synthetic-new-\($0)") }
            .prefix(max(0, limit)).map { index in
            PhotoAssetReference(localIdentifier: "synthetic-new-\(index)", capturedAt: nil, modifiedAt: nil,
                                isScreenshot: screenshots.contains(index))
        }
    }

    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        guard let index = Int(reference.localIdentifier.replacingOccurrences(of: "synthetic-new-", with: "")),
              images.indices.contains(index) else { throw ProductError.photoUnavailable }
        reads.append(reference.localIdentifier)
        return images[index]
    }

    func readIDs() -> [String] { reads }
    func queryLimits() -> [Int] { limits }
}

private actor SafetyBatchQwen: DirectQwenServing {
    private let qualifiedCalls: Set<Int>
    private let failingCalls: Set<Int>
    private let sourceFailures: Set<Int>
    private var detectCount = 0
    private var editCount = 0
    private var knowledgeCount = 0
    private var winnerCount = 0

    init(qualifiedCalls: Set<Int>, failingCalls: Set<Int> = [], sourceFailures: Set<Int> = []) {
        self.qualifiedCalls = qualifiedCalls
        self.failingCalls = failingCalls
        self.sourceFailures = sourceFailures
    }

    func detect(jpeg: Data, localLabels: [String], preferredTopics: [String], apiKey: String) async throws -> DirectPhotoUnderstanding {
        try JPEGMetadataStripper.requireNoMetadata(jpeg)
        detectCount += 1
        if failingCalls.contains(detectCount) { throw ProductError.requestFailed(503) }
        if sourceFailures.contains(detectCount) { throw ProductError.knowledgeSourceUnavailable }
        return DirectPhotoUnderstanding(subjects: [DirectDetectedEntity(
            canonicalTopicID: "synthetic_batch_\(detectCount)", displayName: "合成测试物件\(detectCount)",
            confidence: 0.99, boundingBox: nil, alternatives: [], sensitiveFlags: [])], sensitiveFlags: [])
    }

    func editKnowledgeCard(jpeg: Data, from options: [KnowledgeFactOption], apiKey: String) async throws -> KnowledgeEditorialDraft? {
        editCount += 1
        XCTFail("A synthetic unknown object must not be routed to unrelated catalog facts")
        return nil
    }

    func generateModelKnowledge(jpeg: Data, subjects: [DirectDetectedEntity], recentCards: [KnowledgeCard], apiKey: String,
                                checkAccess: @Sendable () throws -> Void) async throws -> ModelKnowledgeDraft? {
        try checkAccess()
        knowledgeCount += 1
        guard qualifiedCalls.contains(detectCount), let entity = subjects.first else { return nil }
        return ModelKnowledgeDraft(entity: entity, title: "第\(detectCount)次合成知识候选", body: "这是用于自动补选状态机的合成知识正文，不代表模型的真实知识质量或趣味表现。")
    }

    func selectDailyCard(from cards: [KnowledgeCard], apiKey: String) async throws -> UUID? {
        // Mirror the real provider's local fast path for a single qualified card.
        if cards.count > 1 { winnerCount += 1 }
        return cards.last?.id
    }

    func calls() -> (detect: Int, edit: Int, knowledge: Int, winner: Int) {
        (detectCount, editCount, knowledgeCount, winnerCount)
    }
}

private final class SafetyPermission: @unchecked Sendable {
    private let lock = NSLock()
    private var value = true
    var allowed: Bool { lock.withLock { value } }
    func revoke() { lock.withLock { value = false } }
}

private final class SafetySecrets: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]
    func string(for account: String) throws -> String? { lock.withLock { values[account] } }
    func set(_ value: String, for account: String) throws { lock.withLock { values[account] = value } }
    func remove(_ account: String) throws { _ = lock.withLock { values.removeValue(forKey: account) } }
}

private final class SafetyTaskScheduling: DiscoveryTaskScheduling, @unchecked Sendable {
    enum Failure: Error { case unavailable }
    private let lock = NSLock()
    private var pending: PendingDiscoveryTask?
    private var submissions: [Date] = []
    private var submissionFailures: Int
    private var queryCount = 0
    private let firstQueryGate: SafetySuspension?
    private let firstQueryStarted: XCTestExpectation?

    init(pending: PendingDiscoveryTask? = nil, firstQueryGate: SafetySuspension? = nil,
         firstQueryStarted: XCTestExpectation? = nil, submissionFailures: Int = 0) {
        self.pending = pending
        self.firstQueryGate = firstQueryGate
        self.firstQueryStarted = firstQueryStarted
        self.submissionFailures = submissionFailures
    }

    func pendingRequest() async -> PendingDiscoveryTask? {
        let (snapshot, first) = lock.withLock {
            queryCount += 1
            return (pending, queryCount == 1)
        }
        if first {
            firstQueryStarted?.fulfill()
            await firstQueryGate?.wait()
        }
        return snapshot
    }

    func submit(earliestBeginDate: Date) throws {
        try lock.withLock {
            if submissionFailures > 0 {
                submissionFailures -= 1
                throw Failure.unavailable
            }
            submissions.append(earliestBeginDate)
            pending = PendingDiscoveryTask(earliestBeginDate: earliestBeginDate)
        }
    }

    func cancel() { removePendingRequest() }
    func removePendingRequest() { lock.withLock { pending = nil } }
    func submittedDates() -> [Date] { lock.withLock { submissions } }
    func currentRequest() -> PendingDiscoveryTask? { lock.withLock { pending } }
}

private actor SafetySuspension {
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false

    func wait() async {
        if released { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func resume() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

private struct SuspendedEmptyPhotoSource: AutomaticPhotoSource {
    let gate: SafetySuspension
    let started: XCTestExpectation
    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference] {
        started.fulfill()
        await gate.wait()
        return []
    }
    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        throw ProductError.photoUnavailable
    }
}

@MainActor
private final class SafetySubscription: ManagedSubscriptionServing {
    let state: ManagedSubscriptionState
    let displayPrice: String? = nil
    let outcome: SubscriptionPurchaseOutcome
    let purchaseError: ProductError?
    let restoreError: ProductError?
    private(set) var purchaseTokens: [UUID] = []
    private(set) var restoreCount = 0

    init(state: ManagedSubscriptionState, outcome: SubscriptionPurchaseOutcome = .purchased,
         purchaseError: ProductError? = nil, restoreError: ProductError? = nil) {
        self.state = state
        self.outcome = outcome
        self.purchaseError = purchaseError
        self.restoreError = restoreError
    }

    func refresh() async {}
    func purchase(appAccountToken: UUID) async throws -> SubscriptionPurchaseOutcome {
        purchaseTokens.append(appAccountToken)
        if let purchaseError { throw purchaseError }
        return outcome
    }
    func restore() async throws {
        restoreCount += 1
        if let restoreError { throw restoreError }
    }
    func entitlementJWS() async -> String? {
        // A controlled StoreKit boundary, never a real signed receipt. The
        // synthetic transport below is incapable of sending it to a server.
        state == .subscribed ? "synthetic-entitlement-not-a-real-receipt" : nil
    }
}

private final class SafetyWinnerURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            XCTAssertEqual(request.url?.host, "discovery-safety.invalid")
            XCTAssertEqual(request.url?.path, "/v1/daily-winner")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Jianwei-App-Store-Transaction"),
                           "synthetic-entitlement-not-a-real-receipt")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + String(repeating: "a", count: 43))
            XCTAssertTrue(request.value(forHTTPHeaderField: "Idempotency-Key")?.hasPrefix("winner-") == true)
            let body: Data
            if let data = request.httpBody { body = data }
            else if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var data = Data()
                var bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&bytes, maxLength: bytes.count)
                    guard count >= 0 else { throw ProductError.invalidServerResponse }
                    if count == 0 { break }
                    data.append(contentsOf: bytes.prefix(count))
                }
                body = data
            } else { throw ProductError.invalidServerResponse }
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let cards = try XCTUnwrap(payload["cards"] as? [[String: Any]])
            XCTAssertTrue((2...3).contains(cards.count))
            let id = try XCTUnwrap(cards.first?["cardId"] as? String)
            let data = try JSONSerialization.data(withJSONObject: ["cardId": id, "reason": "synthetic-selection"])
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                           httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private actor SafetyQwen: DirectQwenServing {
    enum Phase { case none, detect, edit, knowledge, winner }
    nonisolated let entered = XCTestExpectation(description: "Synthetic model suspended")
    private let gate = SafetySuspension()
    private let suspendAt: Phase
    private let detectionError: ProductError?
    private let noSubjects: Bool
    private let modelKnowledge: Bool
    private let modelError: ProductError?
    private let detectedEntity: DirectDetectedEntity?
    private let editorialError: ProductError?
    private var winnerError: ProductError?
    private let noWinner: Bool
    private let returnedWinnerID: UUID?
    private var detectCount = 0
    private var editCount = 0
    private var winnerCount = 0
    private var knowledgeCount = 0

    init(suspendAt: Phase = .none, detectionError: ProductError? = nil, noSubjects: Bool = false,
         modelKnowledge: Bool = false, modelError: ProductError? = nil, detectedEntity: DirectDetectedEntity? = nil,
         editorialError: ProductError? = nil, winnerError: ProductError? = nil, noWinner: Bool = false,
         returnedWinnerID: UUID? = nil) {
        self.suspendAt = suspendAt
        self.detectionError = detectionError
        self.noSubjects = noSubjects
        self.modelKnowledge = modelKnowledge
        self.modelError = modelError
        self.detectedEntity = detectedEntity
        self.editorialError = editorialError
        self.winnerError = winnerError
        self.noWinner = noWinner
        self.returnedWinnerID = returnedWinnerID
    }

    func resume() async { await gate.resume() }
    func clearWinnerError() { winnerError = nil }
    func calls() -> (detect: Int, edit: Int, winner: Int, knowledge: Int) { (detectCount, editCount, winnerCount, knowledgeCount) }

    private func suspend(_ phase: Phase) async {
        if phase == suspendAt {
            entered.fulfill()
            await gate.wait() // intentionally ignores Task cancellation
        }
    }

    func detect(jpeg: Data, localLabels: [String], preferredTopics: [String], apiKey: String) async throws -> DirectPhotoUnderstanding {
        detectCount += 1
        await suspend(.detect)
        if let detectionError { throw detectionError }
        if let detectedEntity { return DirectPhotoUnderstanding(subjects: [detectedEntity], sensitiveFlags: []) }
        if modelKnowledge {
            return DirectPhotoUnderstanding(subjects: [DirectDetectedEntity(
                canonicalTopicID: "spinning_top", displayName: "陀螺", confidence: 0.94,
                boundingBox: nil, alternatives: [], sensitiveFlags: [])], sensitiveFlags: [])
        }
        // Use a publishable catalog fixture so the editorial suspension is
        // actually reached; the broom topic currently has no approved facts.
        let entity = DirectDetectedEntity(canonicalTopicID: "computer_mouse", displayName: "鼠标", confidence: 0.95,
                                          boundingBox: nil, alternatives: [], sensitiveFlags: [])
        return DirectPhotoUnderstanding(subjects: noSubjects ? [] : [entity, entity], sensitiveFlags: [])
    }

    func editKnowledgeCard(jpeg: Data, from options: [KnowledgeFactOption], apiKey: String) async throws -> KnowledgeEditorialDraft? {
        editCount += 1
        await suspend(.edit)
        if let editorialError { throw editorialError }
        return nil
    }

    func generateModelKnowledge(jpeg: Data, subjects: [DirectDetectedEntity], recentCards: [KnowledgeCard], apiKey: String,
                                checkAccess: @Sendable () throws -> Void) async throws -> ModelKnowledgeDraft? {
        knowledgeCount += 1
        await suspend(.knowledge)
        if let modelError { throw modelError }
        guard modelKnowledge, let entity = subjects.first else { return nil }
        return ModelKnowledgeDraft(entity: entity, title: "这是未命中知识库的合成卡片", body: "这里只验证生成通路与状态机，不作为实际模型知识质量的证据。")
    }

    func selectDailyCard(from cards: [KnowledgeCard], apiKey: String) async throws -> UUID? {
        winnerCount += 1
        await suspend(.winner)
        if let winnerError { throw winnerError }
        return noWinner ? nil : (returnedWinnerID ?? cards.first?.id)
    }
}

/// Returns a valid cached draft when asked, so tests can detect accidental
/// reuse instead of relying on a fake model that always rejects catalog copy.
private actor SafetyNoveltyQwen: DirectQwenServing {
    static let entity = DirectDetectedEntity(canonicalTopicID: "computer_mouse", displayName: "鼠标", confidence: 0.95,
        boundingBox: nil, alternatives: [], sensitiveFlags: [])
    let producesNewKnowledge: Bool
    private var editCount = 0
    private var knowledgeCount = 0

    init(producesNewKnowledge: Bool) { self.producesNewKnowledge = producesNewKnowledge }
    func calls() -> (edit: Int, knowledge: Int) { (editCount, knowledgeCount) }

    func detect(jpeg: Data, localLabels: [String], preferredTopics: [String], apiKey: String) async throws -> DirectPhotoUnderstanding {
        DirectPhotoUnderstanding(subjects: [Self.entity], sensitiveFlags: [])
    }

    func editKnowledgeCard(jpeg: Data, from options: [KnowledgeFactOption], apiKey: String) async throws -> KnowledgeEditorialDraft? {
        editCount += 1
        guard let option = options.first, let title = option.reviewedTitle, let body = option.reviewedBody else { return nil }
        return KnowledgeEditorialDraft(factID: option.factID, title: title, body: body)
    }

    func generateModelKnowledge(jpeg: Data, subjects: [DirectDetectedEntity], recentCards: [KnowledgeCard], apiKey: String,
        checkAccess: @Sendable () throws -> Void) async throws -> ModelKnowledgeDraft? {
        try checkAccess()
        knowledgeCount += 1
        guard producesNewKnowledge, let entity = subjects.first else { return nil }
        return ModelKnowledgeDraft(entity: entity, title: "这是同一物件的新知识通路",
            body: "这里只验证用完缓存后仍会尝试新的知识，不代表真实模型已经写出有趣且准确的内容。")
    }

    func selectDailyCard(from cards: [KnowledgeCard], apiKey: String) async throws -> UUID? { cards.first?.id }
}

/// This protocol handles every request locally; it cannot reach a model or use
/// personal photos. The candidate id is echoed from the synthetic request.
private final class SafetyRepeatedInsightURLProtocol: URLProtocol, @unchecked Sendable {
    static let novelBody = "这是同一个物件的另一条合成知识，专门验证重复之后仍能选出新卡。"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    static func reset() { lock.withLock { count = 0 } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            XCTAssertEqual(request.url?.host, "discovery-safety.invalid")
            guard request.url?.path == "/v2/photo-insights" else { throw ProductError.invalidServerResponse }
            let payload: Data
            if let body = request.httpBody { payload = body }
            else {
                let stream = try XCTUnwrap(request.httpBodyStream)
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                var body = Data()
                while stream.hasBytesAvailable {
                    let length = stream.read(&buffer, maxLength: buffer.count)
                    guard length >= 0 else { throw ProductError.invalidServerResponse }
                    if length == 0 { break }
                    body.append(buffer, count: length)
                }
                payload = body
            }
            let fields = try XCTUnwrap(try JSONSerialization.jsonObject(with: payload) as? [String: Any])
            let packed = try XCTUnwrap(fields["knownKnowledgeHashes"] as? String)
            XCTAssertEqual(Data(base64Encoded: packed)?.count, 106 * 32,
                "The real pipeline must pass all retained historical knowledge, not only 100 or seven days")
            XCTAssertEqual(Set(fields.keys), ["candidateId", "jpegBase64", "localLabels", "interests", "targetDay", "knownKnowledgeHashes"])
            let index = Self.lock.withLock { Self.count += 1; return Self.count }
            let key = try XCTUnwrap(request.value(forHTTPHeaderField: "Idempotency-Key"))
            let candidateID = String(key.dropFirst(6))
            let body = index <= 3 ? "用于本机状态机测试的合成卡片。" : Self.novelBody
            let data = try JSONSerialization.data(withJSONObject: [
                "status": "ready", "candidateId": candidateID,
                "card": ["cardId": UUID().uuidString, "candidateToken": candidateID,
                    "topicId": "safety-0", "factId": "dynamic-safety-0-" + UUID().uuidString,
                    "title": "不同照片的新标题", "detectedObjectName": "测试物件", "body": body,
                    "personalContext": "合成测试", "confidence": 0.9, "boundingBox": NSNull(),
                    "sources": [["sourceId": "safety", "title": "Test", "url": "https://example.com",
                                 "publisher": "Test", "authority": "professional"]],
                    "status": "candidate", "scheduledDate": "", "createdAt": "2026-09-05T00:00:00Z"]
            ])
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private final class SafetyManagedAccessURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    static var callCount: Int { lock.withLock { count } }
    static func reset() { lock.withLock { count = 0 } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.count += 1 }
        XCTAssertEqual(request.url?.host, "discovery-safety.invalid")
        XCTAssertEqual(request.url?.path, "/v2/photo-insights")
        let response = HTTPURLResponse(url: request.url!, statusCode: 424, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"error\":{\"code\":\"managed_provider_access_unavailable\"}}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class SafetyUnclassifiedInsightURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            XCTAssertEqual(request.url?.host, "discovery-safety.invalid")
            XCTAssertEqual(request.url?.path, "/v2/photo-insights")
            let key = try XCTUnwrap(request.value(forHTTPHeaderField: "Idempotency-Key"))
            XCTAssertTrue(key.hasPrefix("photo-"))
            let data = try JSONSerialization.data(withJSONObject: [
                "status": "no_insight", "candidateId": String(key.dropFirst(6)), "reason": "upstream_timeout"
            ])
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

/// Synthetic transport only: unfinished detection followed by a completed empty
/// detection. Every URL is intercepted; no real photo or credential can leave.
private final class SafetyCompletionURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    static var callCount: Int { lock.withLock { count } }
    static func reset() { lock.withLock { count = 0 } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let index = Self.lock.withLock { Self.count += 1; return Self.count }
            let data = try JSONSerialization.data(withJSONObject: ["choices": [[
                "finish_reason": index == 1 ? "length" : "stop",
                "message": ["content": "{\"subjects\":[],\"sensitiveFlags\":[]}"]
            ]]])
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                           httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private final class SafetyDispatchQuotaURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    static var callCount: Int { lock.withLock { count } }
    static func reset() { lock.withLock { count = 0 } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.count += 1 }
        let response = HTTPURLResponse(url: request.url!, statusCode: 429, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"error\":{\"code\":\"daily_dispatch_budget_exceeded\"}}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class SafetyResumableInsightURLProtocol: URLProtocol, @unchecked Sendable {
    struct Recorded: Sendable {
        let idempotencyKey: String?
        let jpegBase64: String?
    }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var captured: [Recorded] = []
    nonisolated(unsafe) private static var started: XCTestExpectation?
    nonisolated(unsafe) private static var completes = false
    nonisolated(unsafe) private static var ready = false
    static var requests: [Recorded] { lock.withLock { captured } }
    static func reset(started: XCTestExpectation) {
        lock.withLock { captured = []; self.started = started; completes = false; ready = false }
    }
    static func allowCompletion(ready: Bool = false) { lock.withLock { completes = true; self.ready = ready } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var body = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    guard count >= 0 else { throw ProductError.invalidServerResponse }
                    if count == 0 { break }
                    body.append(contentsOf: buffer.prefix(count))
                }
            }
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let id = try XCTUnwrap(payload["candidateId"] as? String)
            let (started, completes) = Self.lock.withLock {
                Self.captured.append(Recorded(idempotencyKey: request.value(forHTTPHeaderField: "Idempotency-Key"),
                    jpegBase64: payload["jpegBase64"] as? String))
                let first = Self.started
                Self.started = nil
                return (first, Self.completes)
            }
            started?.fulfill()
            guard completes else { return }
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            let ready = Self.lock.withLock { Self.ready }
            let card: [String: Any] = [
                "cardId": UUID().uuidString, "candidateToken": id, "topicId": "synthetic",
                "factId": "synthetic-fact", "title": "合成测试知识", "detectedObjectName": "测试物件",
                "body": "仅用于恢复测试的合成知识卡。", "personalContext": "合成图片", "confidence": 0.9,
                "sources": [["sourceId": "test", "title": "Synthetic", "url": "https://example.com",
                             "publisher": "Test", "authority": "official"]],
                "status": "candidate", "scheduledDate": "", "createdAt": "2026-09-14T08:00:00Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: [
                "status": ready ? "ready" : "no_insight", "candidateId": id,
                "card": ready ? (card as Any) : NSNull(), "reason": ready ? (NSNull() as Any) : "no_object"
            ])
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private final class SafetyPrivacyURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let body: Data
            if let data = request.httpBody {
                body = data
            } else if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var data = Data()
                var bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&bytes, maxLength: bytes.count)
                    guard count >= 0 else { throw ProductError.invalidServerResponse }
                    if count == 0 { break }
                    data.append(contentsOf: bytes.prefix(count))
                }
                body = data
            } else {
                throw ProductError.invalidServerResponse
            }
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let id = try XCTUnwrap(payload["candidateId"] as? String)
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                           httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            let data = try JSONSerialization.data(withJSONObject: [
                "status": "no_insight", "candidateId": id, "card": NSNull(), "reason": "privacy"
            ])
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
