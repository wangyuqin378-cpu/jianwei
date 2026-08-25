import CryptoKit
import Foundation

actor APIClient {
    let baseURL: URL
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder

    init(baseURL: URL, session: URLSession = .shared) throws {
        guard baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil else {
            throw ProductError.apiNotConfigured
        }
        let isLoopback = ["127.0.0.1", "localhost"].contains(baseURL.host?.lowercased() ?? "")
        guard baseURL.scheme == "https" || (baseURL.scheme == "http" && isLoopback) else {
            throw ProductError.apiNotConfigured
        }
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func register(installationID: UUID) async throws -> Registration {
        let response: RegisterResponse = try await jsonRequest(
            path: "/v1/devices/register",
            method: "POST",
            body: RegisterRequest(installationId: installationID.uuidString.lowercased()),
            bearer: nil,
            expectedStatus: 201
        )
        guard
            UUID(uuidString: response.deviceId) != nil,
            response.deviceToken.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
            response.installationBindingSha256 == installationBinding(for: installationID)
        else { throw ProductError.invalidServerResponse }
        return Registration(deviceID: response.deviceId, token: response.deviceToken)
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
        guard let http = urlResponse as? HTTPURLResponse, http.statusCode == 200, data.count <= 4096 else {
            throw ProductError.requestFailed((urlResponse as? HTTPURLResponse)?.statusCode ?? -1)
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
            expectedStatus: 200
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

    func cards(bearer: String) async throws -> [KnowledgeCard] {
        var result: [KnowledgeCard] = []
        var cursor: String?
        repeat {
            let query = cursor.map { "/v1/cards?limit=50&cursor=\($0)" } ?? "/v1/cards?limit=50"
            let response: CardsResponse = try await jsonRequest(
                path: query,
                method: "GET",
                body: Optional<EmptyBody>.none,
                bearer: bearer,
                expectedStatus: 200
            )
            result.append(contentsOf: try response.items.map { try $0.validated(expectedCandidate: nil) })
            if let next = response.nextCursor {
                guard let id = UUID(uuidString: next) else { throw ProductError.invalidServerResponse }
                cursor = id.uuidString.lowercased()
            } else {
                cursor = nil
            }
        } while cursor != nil && result.count < 500
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
        expectedStatus: Int
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              sameOrigin(url, baseURL) else { throw ProductError.invalidServerResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 150
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ProductError.requestFailed(-1)
        }
        if http.statusCode == 402 { throw ProductError.subscriptionRequired }
        guard http.statusCode == expectedStatus else {
            throw ProductError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard data.count <= 512 * 1024 else { throw ProductError.invalidServerResponse }
        do { return try decoder.decode(Response.self, from: data) }
        catch { throw ProductError.invalidServerResponse }
    }

    private func isAllowedUploadURL(_ url: URL, sessionID: UUID) -> Bool {
        guard sameOrigin(url, baseURL), url.query == nil, url.fragment == nil, url.user == nil, url.password == nil else {
            return false
        }
        let expectedSuffix = "/v1/analysis-jobs/\(sessionID.uuidString.lowercased())/image"
        return url.path.lowercased().hasSuffix(expectedSuffix)
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

struct Registration: Sendable { let deviceID: String; let token: String }
private struct EmptyBody: Codable {}
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

    func validated(expectedCandidate: UUID?) throws -> KnowledgeCard {
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
            ["scheduled", "shown", "archived"].contains(status),
            boundingBox?.isValid != false,
            scheduledDate.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
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
        guard url.scheme == "https", !title.isEmpty, !publisher.isEmpty,
              ["reference", "official", "professional"].contains(authority)
        else { throw ProductError.invalidServerResponse }
        return KnowledgeSource(id: sourceId, title: title, url: url, publisher: publisher, authority: authority)
    }
}
