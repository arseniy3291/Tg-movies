import Foundation
import Network

public struct LocalRequest {
    public let method: String
    public let path: String
    public let query: [String: String]
    public let headers: [String: String]
    public let body: Data
    public init(method: String = "GET", target: String, headers: [String: String] = [:], body: Data = Data()) {
        let url = URLComponents(string: "http://127.0.0.1" + target)
        self.method = method; self.path = url?.path ?? "/"
        self.query = (url?.queryItems ?? []).reduce(into: [:]) { $0[$1.name] = $1.value ?? "" }
        self.headers = headers; self.body = body
    }
}
struct LocalResponse {
    var status = 200
    var mime = "application/json; charset=utf-8"
    var data = Data()
    var headers: [String: String] = [:]
    var proxy: URLRequest?
    static func json(_ value: Any, status: Int = 200) -> LocalResponse {
        LocalResponse(status: status, data: (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])) ?? Data())
    }
}

/// A private HTTP origin for WKWebView. The listener never binds to Wi-Fi/LAN interfaces.
public final class LocalServer {
    public static let origin = "http://127.0.0.1:31849"
    private let queue = DispatchQueue(label: "app.cinegram.http", attributes: .concurrent)
    private var listener: NWListener?
    private let api: CinemaAPI
    public init(resources: URL, metadataKey: String, shield: String) {
        api = CinemaAPI(resources: resources, metadataKey: metadataKey, shield: shield)
    }
    public func start(completion: @escaping (Result<Void, Error>) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: 31849)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        var reported = false
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: if !reported { reported = true; completion(.success(())) }
            case .failed(let error): if !reported { reported = true; completion(.failure(error)) }
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, data: Data())
        }
        listener.start(queue: queue)
    }
    public func stop() { listener?.cancel(); listener = nil }
    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] chunk, _, done, error in
            guard let self else { connection.cancel(); return }
            var data = data; if let chunk { data.append(chunk) }
            if data.count > 2 * 1024 * 1024 + 65536 {
                self.send(.json(["error":"Запрос слишком большой"], status: 413), to: connection); return
            }
            guard let divider = data.range(of: Data("\r\n\r\n".utf8)) else {
                if done || error != nil || data.count > 65536 { connection.cancel() }
                else { self.receive(connection, data: data) }; return
            }
            let lines = String(decoding: data[..<divider.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
            let first = (lines.first ?? "").split(separator: " ")
            guard first.count == 3 else { connection.cancel(); return }
            var headers: [String:String] = [:]
            for line in lines.dropFirst() { if let colon = line.firstIndex(of: ":") {
                headers[String(line[..<colon]).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }}
            guard headers["transfer-encoding"] == nil else { self.send(.json(["error":"Unsupported transfer encoding"],status:400),to:connection); return }
            guard let size = Int(headers["content-length"] ?? "0"), size >= 0, size <= 2097152 else {
                self.send(.json(["error":"Invalid body size"],status:413),to:connection);return
            }
            let body = Data(data[divider.upperBound...])
            if body.count < size { if done || error != nil { connection.cancel() } else { self.receive(connection,data:data) };return }
            let request = LocalRequest(method: String(first[0]), target: String(first[1]), headers: headers, body: Data(body.prefix(size)))
            Task {
                let response = await self.api.handle(request)
                if let upstream = response.proxy {
                    let shield = self.api.shield
                    ProxyTransaction.start(request: upstream, connection: connection, shield: shield)
                } else { self.send(response, to: connection, head: request.method == "HEAD") }
            }
        }
    }
    private func send(_ response: LocalResponse, to connection: NWConnection, head: Bool = false) {
        var text = "HTTP/1.1 \(response.status) Response\r\nContent-Type: \(response.mime)\r\nContent-Length: \(response.data.count)\r\nConnection: close\r\nCache-Control: no-store\r\n"
        for (key, value) in response.headers { text += "\(key): \(value)\r\n" }
        var data = Data((text + "\r\n").utf8); if !head { data.append(response.data) }
        connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    }
}
