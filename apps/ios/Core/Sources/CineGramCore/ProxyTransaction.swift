import Foundation
import Network

/// Streams media with backpressure; only HTML, CSS and HLS manifests are buffered (8 MB limit).
final class ProxyTransaction: NSObject, URLSessionDataDelegate {
    private let connection: NWConnection
    private let request: URLRequest
    private let shield: String
    private var session: URLSession!
    private var task: URLSessionDataTask!
    private var response: HTTPURLResponse?
    private var buffer = Data()
    private var transform: String?
    private var classified = false
    private var headerSent = false
    private var finished = false
    static func start(request:URLRequest,connection:NWConnection,shield:String) {
        let transaction = ProxyTransaction(request:request,connection:connection,shield:shield)
        transaction.start()
    }
    private init(request:URLRequest,connection:NWConnection,shield:String) { self.request = request;self.connection = connection;self.shield = shield }
    private func start() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30;config.timeoutIntervalForResource = 6 * 60 * 60
        let queue = OperationQueue();queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration:config,delegate:self,delegateQueue:queue)
        connection.stateUpdateHandler = { [weak self] state in
            if case .cancelled = state { self?.task?.cancel() }
            if case .failed = state { self?.task?.cancel() }
        }
        task = session.dataTask(with:request);task.resume()
    }
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void) {
        guard let http = response as? HTTPURLResponse else { completionHandler(.cancel);return }
        self.response = http
        let mime = http.mimeType?.lowercased() ?? "",url = http.url ?? request.url!
        if http.statusCode == 200 && request.httpMethod != "HEAD" {
            if mime.contains("text/html") { transform = "html" }
            else if mime.contains("text/css") { transform = "css" }
            else if mime.contains("mpegurl") || url.path.hasSuffix(".m3u8") { transform = "hls" }
        }
        classified = transform != nil || http.statusCode != 200 || request.httpMethod == "HEAD" || mime.hasPrefix("video/")
        if classified && transform == nil { sendHeader() }
        completionHandler(.allow)
    }
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data) {
        if !classified {
            // Some CDNs serve extensionless HLS as application/octet-stream.
            buffer.append(data)
            if buffer.count < 32 { return }
            classified = true
            if String(decoding:buffer.prefix(128),as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines).hasPrefix("#EXTM3U") { transform = "hls" }
            if transform == nil { sendHeader();let first = buffer;buffer.removeAll();stream(first);return }
        } else if transform != nil { buffer.append(data) }
        else { stream(data);return }
        if buffer.count > 8 * 1024 * 1024 { task.cancel() }
    }
    private func sendHeader() {
        guard !headerSent,let response else { return };headerSent = true
        var text = "HTTP/1.1 \(response.statusCode) Response\r\nContent-Type: \(response.value(forHTTPHeaderField:"Content-Type") ?? "application/octet-stream")\r\nCache-Control: no-store\r\nConnection: close\r\n"
        if request.httpMethod != "HEAD" { text += "Transfer-Encoding: chunked\r\n" }
        for key in ["Content-Range","Accept-Ranges"] { if let value = response.value(forHTTPHeaderField:key) { text += "\(key): \(value)\r\n" } }
        connection.send(content:Data((text+"\r\n").utf8),completion:.contentProcessed{ _ in })
    }
    private func stream(_ data:Data) {
        guard !data.isEmpty,request.httpMethod != "HEAD" else { return }
        task.suspend()
        var chunk = Data((String(data.count,radix:16)+"\r\n").utf8);chunk.append(data);chunk.append(Data("\r\n".utf8))
        connection.send(content:chunk,completion:.contentProcessed{ [weak self] error in
            if error != nil { self?.task.cancel() } else { self?.task.resume() }
        })
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?) {
        guard !finished else { return };finished = true
        defer { session.finishTasksAndInvalidate() }
        if error != nil {
            if headerSent { connection.cancel();return }
            sendBuffered(Data("Не удалось загрузить источник".utf8),mime:"text/plain; charset=utf-8",status:502);return
        }
        if let transform,let response {
            do {
                let raw = String(decoding:buffer,as:UTF8.self),base = response.url?.absoluteString ?? request.url!.absoluteString,ref = request.value(forHTTPHeaderField:"Referer") ?? base
                let text:String,mime:String
                switch transform {
                case "html":text = try PlayerRewrite.html(raw,target:base,shield:shield);mime = "text/html; charset=utf-8"
                case "css":text = PlayerRewrite.css(raw,base:base,ref:ref);mime = "text/css; charset=utf-8"
                default:text = PlayerRewrite.hls(raw,base:base,ref:ref);mime = "application/vnd.apple.mpegurl"
                }
                sendBuffered(Data(text.utf8),mime:mime,status:response.statusCode)
            } catch { sendBuffered(Data("Ошибка обработки плеера".utf8),mime:"text/plain; charset=utf-8",status:502) }
        } else {
            if !headerSent { sendHeader() }
            // A very small response may complete before the sniffing threshold.
            var tail = Data()
            if !buffer.isEmpty && request.httpMethod != "HEAD" { tail.append(Data((String(buffer.count,radix:16)+"\r\n").utf8));tail.append(buffer);tail.append(Data("\r\n".utf8)) }
            if request.httpMethod != "HEAD" { tail.append(Data("0\r\n\r\n".utf8)) }
            connection.send(content:tail,completion:.contentProcessed{ [connection] _ in connection.cancel() })
        }
    }
    private func sendBuffered(_ data:Data,mime:String,status:Int) {
        let header = "HTTP/1.1 \(status) Response\r\nContent-Type: \(mime)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var packet = Data(header.utf8);packet.append(data)
        connection.send(content:packet,completion:.contentProcessed{ [connection] _ in connection.cancel() })
    }
}
