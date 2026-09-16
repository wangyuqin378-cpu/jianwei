// Compile with the actual App DirectQwenService, DomainModels and WidgetModels.
// Only transport is intercepted for budget accounting. No prompts are copied.
import Foundation

private struct EvaluationInput: Decodable {
    let bridgeURL: URL
    let bridgeToken: String
    let jpegPath: String
    let labels: [String]
    let catalogPath: String
}

private final class BudgetedTransport: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var bridgeURL: URL!
    private var forwardingTask: URLSessionDataTask?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url == DirectQwenService.mainlandBaseURL.appendingPathComponent("chat/completions") else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        var forwarded = request
        forwarded.url = Self.bridgeURL
        if forwarded.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 8192)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count >= 0, data.count + max(0, count) <= 5_000_000 else {
                    client?.urlProtocol(self, didFailWithError: URLError(.dataLengthExceedsMaximum)); return
                }
                if count == 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            forwarded.httpBodyStream = nil
            forwarded.httpBody = data
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = []
        let session = URLSession(configuration: configuration)
        forwardingTask = session.dataTask(with: forwarded) { [self] data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if let error { client?.urlProtocol(self, didFailWithError: error); return }
            guard let http = response as? HTTPURLResponse, let data,
                  let result = HTTPURLResponse(url: request.url!, statusCode: http.statusCode,
                    httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
            }
            client?.urlProtocol(self, didReceive: result, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        forwardingTask?.resume()
    }
    override func stopLoading() { forwardingTask?.cancel() }
}

@main private enum CurrentByokEvaluation {
    static func main() async throws {
        let input = try JSONDecoder().decode(EvaluationInput.self,
            from: FileHandle.standardInput.readDataToEndOfFile())
        BudgetedTransport.bridgeURL = input.bridgeURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BudgetedTransport.self]
        let session = URLSession(configuration: configuration)
        let service = try DirectQwenService(session: session)
        let catalog = try BundledKnowledgeCatalog(data: Data(contentsOf: URL(fileURLWithPath: input.catalogPath)))
        let jpeg = try Data(contentsOf: URL(fileURLWithPath: input.jpegPath))
        var output: [String: Any] = ["revision": DirectQwenService.modelKnowledgeRevision,
            "scope": "actual Swift detect + model-knowledge fallback; excludes catalog editing and daily scheduling"]
        do {
            let understanding = try await service.detect(jpeg: jpeg, localLabels: input.labels,
                preferredTopics: catalog.preferredDetectionTopics(), apiKey: input.bridgeToken)
            let subjects = understanding.subjects.map { catalog.canonicalize($0) }
            output["normalizedSubjects"] = subjects.map { ["topic": $0.canonicalTopicID,
                "name": $0.displayName, "confidence": $0.confidence] as [String: Any] }
            output["subjects"] = understanding.subjects.map { ["topic": $0.canonicalTopicID,
                "name": $0.displayName, "confidence": $0.confidence] as [String: Any] }
            output["sensitiveFlags"] = understanding.sensitiveFlags
            if understanding.sensitiveFlags.isEmpty,
               let draft = try await service.generateModelKnowledge(jpeg: jpeg,
                  subjects: subjects, recentCards: [], apiKey: input.bridgeToken) {
                let card = draft.makeCard(candidateToken: UUID(), capturedAt: nil)
                output["status"] = "ready"
                output["card"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(card))
            } else { output["status"] = "no_insight" }
        } catch {
            output["status"] = "error"
            output["error"] = String(describing: error)
        }
        let result = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        FileHandle.standardOutput.write(result)
        session.invalidateAndCancel()
    }
}
