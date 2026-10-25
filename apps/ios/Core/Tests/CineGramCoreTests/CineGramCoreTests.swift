import Testing
import Foundation
@testable import CineGramCore

final class FixtureProtocol:URLProtocol {
    override class func canInit(with request:URLRequest) -> Bool { true }
    override class func canonicalRequest(for request:URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!,path = url.path
        let card = #"{"kinopoiskId":1254840,"nameRu":"Киберсталкер","nameOriginal":"Stalk","year":2019,"posterUrl":"https://st.kp.yandex.net/poster.jpg","ratingKinopoisk":7.2,"genres":[{"genre":"триллер"}]}"#
        let body:String
        if path.contains("collections") { body = "{\"items\":[\(card)]}" }
        else if path.contains("staff") { body = "[]" }
        else if path.contains("/films/1254840") { body = card }
        else { body = "{\"films\":[\(card)]}" }
        guard request.value(forHTTPHeaderField:"X-API-KEY") == "test-key" else { client?.urlProtocol(self,didFailWithError:URLError(.userAuthenticationRequired));return }
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
struct CineGramCoreTests {
    @Test func testSignedHLSKeysAndSegments() {
        let input = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key?token=a%2Fb\"\nseg.ts?token=x%2Fy\n"
        let result = PlayerRewrite.hls(input,base:"https://cdn.example/show/master.m3u8",ref:"https://player.example/embed/1")
        let decoded = result.removingPercentEncoding!
        expectTrue(decoded.contains("url=https://cdn.example/key?token=a%2Fb"))
        expectTrue(decoded.contains("url=https://cdn.example/show/seg.ts?token=x%2Fy"))
        expectTrue(decoded.contains("ref=https://player.example/embed/1"))
    }
    @Test func testCSSSpritesKeepFragmentOutsideQuery() {
        let result = PlayerRewrite.css("a{mask:url(#local)}b{background:url(../icons.svg#gear)}",base:"https://player.example/css/main.css",ref:"https://player.example/embed/1")
        expectTrue(result.contains("url(#local)"));expectTrue(result.contains("&sub=1#gear"))
        expectTrue(result.removingPercentEncoding!.contains("url=https://player.example/icons.svg"))
    }
    @Test func testInlineKeysRemainEmbedded() {
        let body = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"data:application/octet-stream;base64,AAAA\""
        expectEqual(PlayerRewrite.hls(body,base:"https://cdn.example/list",ref:"https://player.example/"),body)
    }
    @Test func testHTMLInstallsShieldAndPreservesScriptLiterals() throws {
        let html = #"<html><head><script src="https://doubleclick.net/ad.js"></script><script>var url='https://player.example/api';</script></head><body><video src="/film.mp4"></video></body></html>"#
        let shield = "<script data-name=\"test-shield\">window.original="+PlayerRewrite.jsonString(PlayerRewrite.sourceToken)+";</script>"
        let result = try PlayerRewrite.html(html,target:"https://player.example/embed/1",shield:shield)
        expectFalse(result.contains("doubleclick.net"));expectTrue(result.contains("test-shield"))
        expectFalse(result.contains(PlayerRewrite.sourceToken));expectTrue(result.contains("var url='https://player.example/api';"))
        expectTrue(result.contains("playsinline"));expectTrue(result.contains("api/player-proxy"))
    }
    @Test func testProxyPreservesRawPOSTAndAuthRange() async throws {
        let api = CinemaAPI(resources:URL(fileURLWithPath:"/tmp"),metadataKey:"test-key",shield:"")
        let body = Data(#""signed-payload""#.utf8)
        let req = LocalRequest(method:"POST",target:"/api/player-proxy?url=https%3A%2F%2Fplayer.example%2Fapi&ref=https%3A%2F%2Fplayer.example%2Fembed",headers:["borth":"token","range":"bytes=12-","content-type":"application/json"],body:body)
        let response = await api.handle(req)
        let upstream = try requireValue(response.proxy)
        expectEqual(upstream.httpMethod,"POST");expectEqual(upstream.httpBody,body)
        expectEqual(upstream.value(forHTTPHeaderField:"Borth"),"token")
        expectEqual(upstream.value(forHTTPHeaderField:"Range"),"bytes=12-")
        expectEqual(upstream.value(forHTTPHeaderField:"Referer"),"https://player.example/embed")
    }
    @Test func testCatalogAndMovieMatchFrontendContract() async throws {
        let config = URLSessionConfiguration.ephemeral;config.protocolClasses = [FixtureProtocol.self]
        let api = CinemaAPI(resources:URL(fileURLWithPath:"/tmp"),metadataKey:"test-key",shield:"",session:URLSession(configuration:config))
        let popular = await api.handle(LocalRequest(target:"/api/popular?type=series"))
        let cards = try requireValue(JSONSerialization.jsonObject(with:popular.data) as? [[String:Any]])
        expectEqual(cards.first?["id"] as? String,"1254840");expectEqual(cards.first?["rating"] as? String,"7.2")
        let detail = await api.handle(LocalRequest(target:"/api/movie?url=%2Fmovie%2F1254840"))
        let movie = try requireValue(JSONSerialization.jsonObject(with:detail.data) as? [String:Any])
        expectEqual(movie["title"] as? String,"Киберсталкер");expectNotNil(movie["videoSources"])
    }
    @Test func testLocalServerServesBundledUIAndRejectsTraversal() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory.appendingPathComponent("public"),withIntermediateDirectories:true)
        try Data("<title>CineGram fixture</title>".utf8).write(to:directory.appendingPathComponent("public/index.html"))
        defer { try? FileManager.default.removeItem(at:directory) }
        let server = LocalServer(resources:directory,metadataKey:"test-key",shield:"")
        try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<Void,Error>) in
            do { try server.start { continuation.resume(with:$0) } } catch { continuation.resume(throwing:error) }
        }
        defer { server.stop() }
        let (data,response) = try await URLSession.shared.data(from:URL(string:LocalServer.origin+"/movie/1254840")!)
        expectEqual((response as? HTTPURLResponse)?.statusCode,200);expectTrue(String(decoding:data,as:UTF8.self).contains("CineGram fixture"))
    }
    @Test func testPrivateDestinationsAreRejected() {
        for value in ["http://player.example/","https://127.0.0.1/","https://10.0.0.1/","https://localhost/","https://[::1]/"] { expectFalse(PlayerRewrite.validRemote(URL(string:value)!)) }
        expectTrue(PlayerRewrite.validRemote(URL(string:"https://cdn.example/film.m3u8")!))
    }
}

private func expectTrue(_ value:Bool,sourceLocation:SourceLocation = #_sourceLocation) { #expect(value,sourceLocation:sourceLocation) }
private func expectFalse(_ value:Bool,sourceLocation:SourceLocation = #_sourceLocation) { #expect(!value,sourceLocation:sourceLocation) }
private func expectEqual<T:Equatable>(_ lhs:T,_ rhs:T,sourceLocation:SourceLocation = #_sourceLocation) { #expect(lhs == rhs,sourceLocation:sourceLocation) }
private func expectNotNil<T>(_ value:T?,sourceLocation:SourceLocation = #_sourceLocation) { #expect(value != nil,sourceLocation:sourceLocation) }
private func requireValue<T>(_ value:T?,sourceLocation:SourceLocation = #_sourceLocation) throws -> T { try #require(value,sourceLocation:sourceLocation) }
