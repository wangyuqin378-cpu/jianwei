import CryptoKit
import Foundation

actor APIClient {
    nonisolated let baseURL: URL
    nonisolated var usesLocalDevelopmentService: Bool {
        let host = baseURL.host?.lowercased() ?? ""
        return baseURL.scheme == "http" && (
            ["127.0.0.1", "localhost"].contains(host)
                || host.hasSuffix(".local")
                || APIClientTransportPolicy.isPrivateIPv4(host)
        )
    }
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder
    private var supportsKnowledgeHistory = true

    init(baseURL: URL, session: URLSession? = nil, allowsLocalHTTP: Bool = false) throws {
        guard baseURL.user == nil,
              baseURL.password == nil,
              baseURL.query == nil,
              baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/"
        else {
            throw ProductError.apiNotConfigured
        }
        let host = baseURL.host?.lowercased() ?? ""
        let isLoopback = ["127.0.0.1", "localhost"].contains(host)
        let isLocalNetwork = host.hasSuffix(".local")
            || APIClientTransportPolicy.isPrivateIPv4(host)
        guard baseURL.scheme == "https"
                || (baseURL.scheme == "http" && isLoopback)
                || (baseURL.scheme == "http" && isLocalNetwork && allowsLocalHTTP)
        else {
            throw ProductError.apiNotConfigured
        }
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.httpCookieStorage = nil
            configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            self.session = URLSession(
                configuration: configuration,
                delegate: RejectingAPIRedirectDelegate(),
                delegateQueue: nil
            )
        }
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func health() async throws {
        let response: HealthResponse = try await jsonRequest(
            path: "/health",
            method: "GET",
            body: Optional<EmptyBody>.none,
            bearer: nil,
            expectedStatus: 200,
            timeoutInterval: 5
        )
        guard response.ok else { throw ProductError.invalidServerResponse }
    }

    func register(installationID: UUID, currentBearer: String? = nil, appStoreTransaction: String? = nil) async throws -> Registration {
        let response: RegisterResponse = try await jsonRequest(
            path: "/v1/devices/register",
            method: "POST",
            body: RegisterRequest(installationId: installationID.uuidString.lowercased()),
            bearer: currentBearer,
            expectedStatus: 201,
            headers: try transactionHeaders(appStoreTransaction)
        )
        guard
            UUID(uuidString: response.deviceId) != nil,
            response.deviceToken.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
            response.installationBindingSha256 == installationBinding(for: installationID)
        else { throw ProductError.invalidServerResponse }
        return Registration(deviceID: response.deviceId, token: response.deviceToken)
    }

    func photoInsight(
        bearer: String,
        candidateToken: UUID,
        jpeg: Data,
        localLabels: [String],
        interests: [String],
        targetDay: String? = nil,
        appStoreTransaction: String? = nil,
        knownKnowledgeHashes: String? = nil
    ) async throws -> KnowledgeCard? {
        guard jpeg.count >= 32,
              jpeg.count <= 3 * 1_024 * 1_024,
              jpeg.starts(with: [0xff, 0xd8, 0xff])
        else { throw ProductError.invalidServerResponse }
        var body = PhotoInsightRequest(
            candidateId: candidateToken.uuidString.lowercased(),
            jpegBase64: jpeg.base64EncodedString(),
            localLabels: Array(localLabels.prefix(20)),
            interests: Array(interests.prefix(10)),
            targetDay: targetDay,
            knownKnowledgeHashes: knownKnowledgeHashes
        )
        let headers = try managedHeaders(idempotencyKey: "photo-" + candidateToken.uuidString.lowercased(),
                                         appStoreTransaction: appStoreTransaction)
        var response: PhotoInsightResponse?
        var lastError: Error?
        for attempt in 0..<3 {
            do {
                let useHistory = supportsKnowledgeHistory && body.knownKnowledgeHashes != nil
                if !useHistory { body.knownKnowledgeHashes = nil }
                do {
                    response = try await jsonRequest(
                        path: useHistory ? "/v2/photo-insights" : "/v1/photo-insights",
                        method: "POST",
                        body: body,
                        bearer: bearer,
                        expectedStatus: 200,
                        timeoutInterval: 240,
                        headers: headers,
                        acceptsMissingRoute: useHistory
                    )
                } catch PhotoInsightCompatibilityError.missingRoute {
                    // Only the gateway's explicit 404/not_found is a version
                    // negotiation failure. Never downgrade a 401/429/5xx or an
                    // ambiguous network reply and dispatch under another job.
                    supportsKnowledgeHistory = false
                    body.knownKnowledgeHashes = nil
                    response = try await jsonRequest(path: "/v1/photo-insights", method: "POST",
                        body: body, bearer: bearer, expectedStatus: 200, timeoutInterval: 240, headers: headers)
                }
                break
            } catch {
                lastError = error
                guard attempt < 2, Self.isRetryablePhotoInsightError(error) else { throw error }
                try await Task.sleep(for: .seconds(attempt + 1))
            }
        }
        guard let response else { throw lastError ?? ProductError.invalidServerResponse }
        guard response.candidateId.lowercased() == candidateToken.uuidString.lowercased() else {
            throw ProductError.invalidServerResponse
        }
        switch response.status {
        case "ready":
            guard let card = response.card else { throw ProductError.invalidServerResponse }
            return try card.validated(expectedCandidate: candidateToken, allowsCandidate: true)
        case "no_insight":
            guard response.card == nil else { throw ProductError.invalidServerResponse }
            switch response.reason {
            case "privacy":
                throw ProductError.sensitivePhoto(["cloud_privacy"])
            case "no_object", "no_qualified_fact", "research_no_fact",
                 "cached_fact_photo_mismatch_and_research_no_fact",
                 "dynamic_fact_evidence_rejected", "dynamic_fact_photo_mismatch",
                 "dynamic_fact_quality_rejected", "dynamic_fact_object_mismatch":
                return nil
            default:
                // A missing/new reason is not proof that the photo is exhausted.
                // Preserve it for a later retry without replaying this invalid
                // response immediately or refunding an already-started attempt.
                throw ProductError.invalidServerResponse
            }
        default:
            throw ProductError.invalidServerResponse
        }
    }

    nonisolated static func packedKnowledgeHistory(_ cards: [KnowledgeCard]) -> String? {
        // Match ECMAScript's whitespace exactly, not Foundation/ICU's \s:
        // JavaScript includes BOM and excludes NEL. Freeze this wire contract.
        let whitespace = "[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
        let digests = Set(cards.compactMap { card -> Data? in
            let topic = card.topicID
                .replacingOccurrences(of: "^\(whitespace)+|\(whitespace)+$", with: "", options: .regularExpression)
                .lowercased()
            let text = card.body.precomposedStringWithCompatibilityMapping
                .replacingOccurrences(of: "\(whitespace)*\\[ref_[0-9]+\\]", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\(whitespace)+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: " "))
            guard !topic.isEmpty && !text.isEmpty else { return nil }
            return Data(SHA256.hash(data: Data((topic + "\0" + text).utf8)))
        })
        // Never silently send a truncated history or break the daily loop for
        // an oversized archive; retain the existing v1 + local exact guard.
        guard digests.count <= 16384 else { return nil }
        return digests.sorted { $0.lexicographicallyPrecedes($1) }
            .reduce(into: Data()) { $0.append($1) }.base64EncodedString()
    }

    func dailyWinner(
        bearer: String,
        cards: [KnowledgeCard],
        topicAffinities: [String: Int],
        day: String,
        appStoreTransaction: String? = nil
    ) async throws -> UUID {
        guard (2...3).contains(cards.count), Set(cards.map(\.id)).count == cards.count else {
            throw ProductError.invalidServerResponse
        }
        let winnerSeed = day + "\u{0}" + cards.map(\.id.uuidString).sorted().joined(separator: "\u{0}")
        let winnerKey = SHA256.hash(data: Data(winnerSeed.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let response: DailyCardSelectionResponse = try await jsonRequest(
            path: "/v1/daily-winner",
            method: "POST",
            body: ProductDailyWinnerRequest(
                cards: cards.map {
                    ProductDailyWinnerCard(
                        cardId: $0.id.uuidString.lowercased(),
                        topicId: $0.topicID,
                        objectName: $0.objectName,
                        title: $0.title,
                        body: $0.body,
                        qualityScore: max(0, min(1, $0.confidence))
                    )
                },
                topicAffinities: topicAffinities
            ),
            bearer: bearer,
            expectedStatus: 200,
            headers: try managedHeaders(idempotencyKey: "winner-" + winnerKey, appStoreTransaction: appStoreTransaction)
        )
        guard let selected = UUID(uuidString: response.cardId), cards.contains(where: { $0.id == selected }) else {
            throw ProductError.invalidServerResponse
        }
        return selected
    }

    private func managedHeaders(idempotencyKey: String, appStoreTransaction: String?) throws -> [String: String] {
        var headers = try transactionHeaders(appStoreTransaction)
        headers["Idempotency-Key"] = idempotencyKey
        return headers
    }

    private func transactionHeaders(_ appStoreTransaction: String?) throws -> [String: String] {
        var headers: [String: String] = [:]
        if let appStoreTransaction {
            guard !appStoreTransaction.isEmpty, appStoreTransaction.utf8.count <= 20_000,
                  !appStoreTransaction.contains(where: { $0.isWhitespace || $0.isNewline })
            else { throw ProductError.subscriptionVerificationFailed }
            headers["X-Jianwei-App-Store-Transaction"] = appStoreTransaction
        }
        return headers
    }

    func createJob(
        bearer: String,
        candidateToken: UUID,
        capturedDay: String?,
        labels: [String],
        qualityScore: Double
    ) async throws -> CreateJobResponse {
        let response: CreateJobResponse = try await jsonRequest(
            path: "/v1/analysis-jobs",
            method: "POST",
            body: CreateJobRequest(
                candidateToken: candidateToken.uuidString.lowercased(),
                capturedAtBucket: capturedDay,
                localLabels: Array(labels.prefix(20)),
                qualityScore: qualityScore,
                sensitiveFlags: [],
                contentType: "image/jpeg"
            ),
            bearer: bearer,
            expectedStatus: 201
        )
        guard response.candidateToken.lowercased() == candidateToken.uuidString.lowercased(),
              UUID(uuidString: response.jobId) != nil,
              ["awaiting_upload", "uploaded", "completed", "needs_content", "rejected"].contains(response.status)
        else { throw ProductError.invalidServerResponse }
        if response.status == "awaiting_upload" {
            guard let uploadURL = response.uploadUrl.flatMap(URL.init(string:)),
                  let uploadSessionID = response.uploadSessionId.flatMap(UUID.init(uuidString:)),
                  isAllowedUploadURL(uploadURL, sessionID: uploadSessionID)
            else { throw ProductError.invalidServerResponse }
        } else if response.uploadUrl != nil || response.uploadSessionId != nil {
            throw ProductError.invalidServerResponse
        }
        return response
    }

    func upload(
        bearer: String,
        response: CreateJobResponse,
        candidateToken: UUID,
        jpeg: Data
    ) async throws {
        guard
            let uploadURL = response.uploadUrl.flatMap(URL.init(string:)),
            let sessionID = response.uploadSessionId.flatMap(UUID.init(uuidString:)),
            isAllowedUploadURL(uploadURL, sessionID: sessionID)
        else { throw ProductError.invalidServerResponse }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.httpBody = jpeg
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        let (data, urlResponse) = try await session.data(for: request)
        guard let http = urlResponse as? HTTPURLResponse else {
            throw ProductError.requestFailed(-1)
        }
        if http.statusCode == 401 { throw ProductError.serverCredentialExpired }
        guard http.statusCode == 200, data.count <= 4096 else {
            throw ProductError.requestFailed(http.statusCode)
        }
        let upload = try decoder.decode(UploadResponse.self, from: data)
        guard upload.jobId == response.jobId,
              upload.candidateToken.lowercased() == candidateToken.uuidString.lowercased(),
              upload.uploadSessionId.lowercased() == sessionID.uuidString.lowercased(),
              upload.status == "uploaded"
        else { throw ProductError.invalidServerResponse }
    }

    func completeJob(
        bearer: String,
        jobID: UUID,
        candidateToken: UUID,
        modelAccess: ModelAccessRequest
    ) async throws -> KnowledgeCard? {
        let response: CompleteJobResponse = try await jsonRequest(
            path: "/v1/analysis-jobs/\(jobID.uuidString.lowercased())/complete",
            method: "POST",
            body: CompleteJobRequest(modelAccess: ModelAccessDTO(modelAccess)),
            bearer: bearer,
            expectedStatus: 200,
            timeoutInterval: 240
        )
        guard response.jobId.lowercased() == jobID.uuidString.lowercased(),
              response.candidateToken.lowercased() == candidateToken.uuidString.lowercased()
        else { throw ProductError.invalidServerResponse }
        if response.status == "completed", let dto = response.card {
            return try dto.validated(expectedCandidate: candidateToken)
        }
        guard ["needs_content", "rejected"].contains(response.status), response.card == nil else {
            throw ProductError.invalidServerResponse
        }
        return nil
    }

    func cards(
        bearer: String,
        checkAccess: @Sendable () async throws -> Void = {}
    ) async throws -> [KnowledgeCard] {
        let maximumPages = 100
        let maximumCards = 5_000
        var result: [KnowledgeCard] = []
        var cursor: String?
        var seenCursors = Set<String>()
        var pageCount = 0
        repeat {
            try Task.checkCancellation()
            try await checkAccess()
            pageCount += 1
            guard pageCount <= maximumPages else { throw ProductError.invalidServerResponse }
            let query = cursor.map { "/v1/cards?limit=50&cursor=\($0)" } ?? "/v1/cards?limit=50"
            let response: CardsResponse = try await jsonRequest(
                path: query,
                method: "GET",
                body: Optional<EmptyBody>.none,
                bearer: bearer,
                expectedStatus: 200
            )
            try await checkAccess()
            result.append(contentsOf: try response.items.map { try $0.validated(expectedCandidate: nil) })
            guard result.count <= maximumCards else { throw ProductError.invalidServerResponse }
            if let next = response.nextCursor {
                guard let id = UUID(uuidString: next) else { throw ProductError.invalidServerResponse }
                let normalized = id.uuidString.lowercased()
                guard seenCursors.insert(normalized).inserted else {
                    throw ProductError.invalidServerResponse
                }
                cursor = normalized
            } else {
                cursor = nil
            }
        } while cursor != nil
        return result.filter { $0.status != "archived" }
    }

    func selectDailyCard(
        bearer: String,
        cardIDs: [UUID],
        modelAccess: ModelAccessRequest
    ) async throws -> UUID {
        guard (2...3).contains(cardIDs.count), Set(cardIDs).count == cardIDs.count else {
            throw ProductError.invalidServerResponse
        }
        let response: DailyCardSelectionResponse = try await jsonRequest(
            path: "/v1/cards/select-daily",
            method: "POST",
            body: DailyCardSelectionRequest(
                cardIds: cardIDs.map { $0.uuidString.lowercased() },
                modelAccess: ModelAccessDTO(modelAccess)
            ),
            bearer: bearer,
            expectedStatus: 200
        )
        guard let selected = UUID(uuidString: response.cardId),
              cardIDs.contains(selected),
              (1...160).contains(response.reason.count)
        else { throw ProductError.invalidServerResponse }
        return selected
    }

    func feedback(bearer: String, cardID: UUID, action: FeedbackAction) async throws {
        let _: FeedbackResponse = try await jsonRequest(
            path: "/v1/cards/\(cardID.uuidString.lowercased())/feedback",
            method: "POST",
            body: FeedbackRequest(action: action.rawValue),
            bearer: bearer,
            expectedStatus: 201
        )
    }

    func deleteDeviceData(bearer: String, expectedDeviceID: String) async throws {
        let response: DeleteDeviceDataResponse = try await jsonRequest(
            path: "/v1/device-data",
            method: "DELETE",
            body: Optional<EmptyBody>.none,
            bearer: bearer,
            expectedStatus: 200
        )
        guard response.deviceId == expectedDeviceID, response.status == "deleted" else {
            throw ProductError.invalidServerResponse
        }
    }

    private func jsonRequest<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?,
        bearer: String?,
        expectedStatus: Int,
        timeoutInterval: TimeInterval = 150,
        headers: [String: String] = [:],
        acceptsMissingRoute: Bool = false
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              sameOrigin(url, baseURL) else { throw ProductError.invalidServerResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeoutInterval
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw ProductError.requestFailed(error.errorCode)
        } catch {
            throw ProductError.requestFailed(-1)
        }
        guard let http = response as? HTTPURLResponse else {
            throw ProductError.requestFailed(-1)
        }
        if http.statusCode == 402 { throw ProductError.subscriptionRequired }
        if http.statusCode == 401 { throw ProductError.serverCredentialExpired }
        if http.statusCode == 429 {
            throw Self.rateLimitError(from: data)
        }
        if acceptsMissingRoute && http.statusCode == 404 && data.count <= 4096,
           (try? decoder.decode(APIErrorEnvelope.self, from: data))?.error.code == "not_found" {
            throw PhotoInsightCompatibilityError.missingRoute
        }
        guard http.statusCode == expectedStatus else {
            if http.statusCode == 424, data.count <= 4096,
               (try? decoder.decode(APIErrorEnvelope.self, from: data))?.error.code == "managed_provider_access_unavailable" {
                // The platform's provider access needs recovery, not this
                // device's identity, subscription or user-supplied API Key.
                throw ProductError.managedServiceUnavailable
            }
            if http.statusCode == 503, data.count <= 4096,
               (try? decoder.decode(APIErrorEnvelope.self, from: data))?.error.code == "source_temporarily_unavailable" {
                // One source site's failure is not a model/network outage. Do
                // not repeat the same paid research three times immediately.
                throw ProductError.knowledgeSourceUnavailable
            }
            throw ProductError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard data.count <= 512 * 1024 else { throw ProductError.invalidServerResponse }
        do { return try decoder.decode(Response.self, from: data) }
        catch { throw ProductError.invalidServerResponse }
    }

    private static func rateLimitError(from data: Data) -> ProductError {
        let code = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?.error.code
        switch code {
        case "daily_budget_exceeded":
            return .dailyAnalysisLimitReached
        case "daily_dispatch_budget_exceeded":
            return .managedDailyDispatchLimitReached
        case "global_daily_budget_exceeded", "global_daily_cost_budget_exceeded":
            return .requestThrottled
        case "monthly_budget_exceeded", "global_monthly_budget_exceeded", "global_monthly_cost_budget_exceeded":
            return .monthlyAnalysisLimitReached
        default:
            return .requestThrottled
        }
    }

    static func isRetryablePhotoInsightError(_ error: Error) -> Bool {
        guard case let ProductError.requestFailed(code) = error else { return false }
        return [
            408, 409, 425, 500, 502, 503, 504, 520, 522, 524,
            URLError.timedOut.rawValue,
            URLError.cannotFindHost.rawValue,
            URLError.cannotConnectToHost.rawValue,
            URLError.networkConnectionLost.rawValue,
            URLError.dnsLookupFailed.rawValue,
            URLError.notConnectedToInternet.rawValue
        ].contains(code)
    }

    private func isAllowedUploadURL(_ url: URL, sessionID: UUID) -> Bool {
        guard sameOrigin(url, baseURL), url.query == nil, url.fragment == nil, url.user == nil, url.password == nil else {
            return false
        }
        let expectedSuffix = "/v1/analysis-jobs/\(sessionID.uuidString.lowercased())/image"
        return url.path.lowercased() == expectedSuffix
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased() &&
            lhs.host?.lowercased() == rhs.host?.lowercased() &&
            effectivePort(lhs) == effectivePort(rhs)
    }

    private func effectivePort(_ url: URL) -> Int {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
    }

    private func installationBinding(for id: UUID) -> String {
        let data = Data(("jianwei-installation-binding-v1\0" + id.uuidString.lowercased()).utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum APIClientTransportPolicy {
    static func isPrivateIPv4(_ host: String) -> Bool {
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
        guard octets.count == 4,
              octets.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let first = Int(octets[0]),
              let second = Int(octets[1]),
              octets.dropFirst(2).allSatisfy({ Int($0).map { 0...255 ~= $0 } == true }),
              0...255 ~= first,
              0...255 ~= second
        else { return false }

        return first == 10
            || (first == 172 && 16...31 ~= second)
            || (first == 192 && second == 168)
    }

    static func redirectedRequest(_ request: URLRequest) -> URLRequest? {
        // The API contract uses one canonical origin and never requires a
        // redirect. Rejecting all redirects prevents bearer tokens and the
        // sanitized JPEG body from being replayed to a different endpoint.
        nil
    }
}

private final class RejectingAPIRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(APIClientTransportPolicy.redirectedRequest(request))
    }
}

struct Registration: Sendable { let deviceID: String; let token: String }
private struct EmptyBody: Codable {}
private struct HealthResponse: Decodable { let ok: Bool }
private struct APIErrorEnvelope: Decodable {
    struct Detail: Decodable { let code: String }
    let error: Detail
}
private struct CompleteJobRequest: Codable { let modelAccess: ModelAccessDTO }
private struct ModelAccessDTO: Codable {
    let mode: String
    let provider: String?
    let apiKey: String?
    let appStoreTransaction: String?

    init(_ request: ModelAccessRequest) {
        switch request.mode {
        case .managed:
            mode = "managed"
            provider = nil
            apiKey = nil
            appStoreTransaction = request.appStoreTransaction
        case .qwenUserKey:
            mode = "user_key"
            provider = "qwen"
            apiKey = request.apiKey
            appStoreTransaction = nil
        }
    }
}
private struct RegisterRequest: Codable { let installationId: String }
private enum PhotoInsightCompatibilityError: Error { case missingRoute }
private struct PhotoInsightRequest: Codable {
    let candidateId: String
    let jpegBase64: String
    let localLabels: [String]
    let interests: [String]
    let targetDay: String?
    var knownKnowledgeHashes: String?
}
private struct PhotoInsightResponse: Codable {
    let status: String
    let candidateId: String
    let card: CardDTO?
    let reason: String?
}
private struct ProductDailyWinnerRequest: Codable {
    let cards: [ProductDailyWinnerCard]
    let topicAffinities: [String: Int]
}
private struct ProductDailyWinnerCard: Codable {
    let cardId: String
    let topicId: String
    let objectName: String
    let title: String
    let body: String
    let qualityScore: Double
}
private struct RegisterResponse: Codable {
    let deviceId: String
    let deviceToken: String
    let installationBindingSha256: String
    let created: Bool
}
private struct CreateJobRequest: Codable {
    let candidateToken: String
    let capturedAtBucket: String?
    let localLabels: [String]
    let qualityScore: Double
    let sensitiveFlags: [String]
    let contentType: String
}
struct CreateJobResponse: Codable, Sendable {
    let jobId: String
    let candidateToken: String
    let status: String
    let uploadUrl: String?
    let uploadSessionId: String?
    let expiresAt: Date
}
private struct UploadResponse: Codable {
    let jobId: String
    let candidateToken: String
    let uploadSessionId: String
    let status: String
}
private struct CompleteJobResponse: Codable {
    let jobId: String
    let candidateToken: String
    let status: String
    let card: CardDTO?
}
private struct CardsResponse: Codable { let items: [CardDTO]; let nextCursor: String? }
private struct FeedbackRequest: Codable { let action: String }
private struct DailyCardSelectionRequest: Codable {
    let cardIds: [String]
    let modelAccess: ModelAccessDTO
}
private struct DailyCardSelectionResponse: Codable { let cardId: String; let reason: String }
private struct FeedbackResponse: Codable { let id: String; let cardId: String; let action: String; let createdAt: Date }
private struct DeleteDeviceDataResponse: Codable { let deviceId: String; let status: String }

private struct CardDTO: Codable {
    let cardId: String
    let candidateToken: String
    let topicId: String
    let factId: String
    let title: String
    let detectedObjectName: String
    let body: String
    let personalContext: String
    let confidence: Double
    let boundingBox: ObjectBoundingBox?
    let sources: [SourceDTO]
    let status: String
    let scheduledDate: String
    let createdAt: Date

    func validated(expectedCandidate: UUID?, allowsCandidate: Bool = false) throws -> KnowledgeCard {
        let allowedStatuses = allowsCandidate
            ? ["candidate", "scheduled", "shown", "archived"]
            : ["scheduled", "shown", "archived"]
        let validScheduledDate = allowsCandidate && status == "candidate"
            ? scheduledDate.isEmpty
            : scheduledDate.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
        guard
            let id = UUID(uuidString: cardId),
            let candidate = UUID(uuidString: candidateToken),
            expectedCandidate == nil || candidate == expectedCandidate,
            (1...60).contains(title.count),
            (1...60).contains(detectedObjectName.count),
            (1...240).contains(body.count),
            (1...500).contains(personalContext.count),
            (0...1).contains(confidence),
            (1...3).contains(sources.count),
            allowedStatuses.contains(status),
            boundingBox?.isValid != false,
            validScheduledDate
        else { throw ProductError.invalidServerResponse }
        let validatedSources = try sources.map { try $0.validated() }
        return KnowledgeCard(
            id: id,
            candidateToken: candidate,
            topicID: topicId,
            factID: factId,
            title: title,
            objectName: detectedObjectName,
            body: body,
            personalContext: personalContext,
            confidence: confidence,
            boundingBox: boundingBox,
            sources: validatedSources,
            status: status,
            scheduledDay: scheduledDate,
            createdAt: createdAt
        )
    }
}

private struct SourceDTO: Codable {
    let sourceId: String
    let title: String
    let url: URL
    let publisher: String
    let authority: String

    func validated() throws -> KnowledgeSource {
        guard url.scheme?.lowercased() == "https",
              url.host?.isEmpty == false,
              url.user == nil,
              url.password == nil,
              !title.isEmpty,
              !publisher.isEmpty,
              ["reference", "official", "professional"].contains(authority)
        else { throw ProductError.invalidServerResponse }
        return KnowledgeSource(id: sourceId, title: title, url: url, publisher: publisher, authority: authority)
    }
}
