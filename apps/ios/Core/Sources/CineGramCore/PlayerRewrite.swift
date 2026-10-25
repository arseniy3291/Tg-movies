import Foundation
import SwiftSoup

enum PlayerRewrite {
    static let sourceToken = "https://cinegram-origin.invalid/__SOURCE__"
    static func encode(_ s:String) -> String { s.addingPercentEncoding(withAllowedCharacters:CharacterSet(charactersIn:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")) ?? "" }
    static func validRemote(_ url:URL) -> Bool {
        guard url.scheme == "https",url.user == nil,url.password == nil,let host = url.host?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host.contains(":") { return false }
        let numbers = host.split(separator:".").compactMap{Int($0)}
        if numbers.count == 4 {
            if [0,10,127].contains(numbers[0]) || numbers[0] >= 224 { return false }
            if numbers[0] == 169 && numbers[1] == 254 { return false }
            if numbers[0] == 192 && numbers[1] == 168 { return false }
            if numbers[0] == 172 && (16...31).contains(numbers[1]) { return false }
        };return true
    }
    static func proxyURL(_ raw:String,ref:String) -> String {
        guard var parts = URLComponents(string:raw) else { return raw }
        let hash = parts.percentEncodedFragment;parts.fragment = nil
        return LocalServer.origin+"/api/player-proxy?url="+encode(parts.string ?? raw)+"&ref="+encode(ref)+"&sub=1"+(hash.map{"#"+$0} ?? "")
    }
    static func isAd(_ url:String) -> Bool {
        url.range(of:#"distribrey\.com|agl00\d\.|bidster\.net|bracdn\.online|tds\.bid|yandex\.ru/ads|adfox|googlesyndication\.com|doubleclick\.net|adhigh\.net|buzzoola\.com|mixadvert\.com|traforet\.com|adriver\.ru|betweendigital\.com|temptcdn\.com|getsdk\.online|vavada|1xbet|melbet|mostbet|rmp-vast|/load-xml/|/vast/|[?&]roll=(pre|mid|post)"#,options:[.regularExpression,.caseInsensitive]) != nil
    }
    static func resolve(_ value:String,base:String) -> String { URL(string:value,relativeTo:URL(string:base))?.absoluteURL.absoluteString ?? value }
    static func replace(_ text:String,pattern:String,transform:(NSTextCheckingResult,String)->String) -> String {
        guard let regex = try? NSRegularExpression(pattern:pattern,options:[]) else { return text }
        let ns = text as NSString;var result = text
        for match in regex.matches(in:text,range:NSRange(location:0,length:ns.length)).reversed() {
            if let range = Range(match.range,in:result) { result.replaceSubrange(range,with:transform(match,text)) }
        };return result
    }
    static func hls(_ text:String,base:String,ref:String) -> String {
        text.components(separatedBy:"\n").map { raw in
            let line = raw.hasSuffix("\r") ? String(raw.dropLast()):raw
            if line.hasPrefix("#") {
                return replace(line,pattern:#"URI="([^"]+)""#) { match,text in
                    let value = (text as NSString).substring(with:match.range(at:1))
                    let url = value.hasPrefix("data:") || value.hasPrefix("skd:") ? value:proxyURL(resolve(value,base:base),ref:ref)
                    return "URI=\"\(url)\""
                }
            }
            let value = line.trimmingCharacters(in:.whitespaces)
            return value.isEmpty ? line:proxyURL(resolve(value,base:base),ref:ref)
        }.joined(separator:"\n")
    }
    static func css(_ text:String,base:String,ref:String) -> String {
        replace(text,pattern:#"url\(\s*(['"]?)([^)'"\s]+)\1\s*\)"#) { match,text in
            let value = (text as NSString).substring(with:match.range(at:2))
            if value.hasPrefix("data:") || value.hasPrefix("#") { return (text as NSString).substring(with:match.range) }
            return "url(\"\(proxyURL(resolve(value,base:base),ref:ref))\")"
        }
    }
    static func jsonString(_ s:String) -> String { String(decoding:(try? JSONSerialization.data(withJSONObject:s,options:[.fragmentsAllowed,.withoutEscapingSlashes])) ?? Data("\"\"".utf8),as:UTF8.self) }
    static func html(_ text:String,target:String,shield:String) throws -> String {
        let doc = try SwiftSoup.parse(text,target)
        for script in try doc.select("script") {
            let src = try script.attr("src")
            if src.contains("rocket-loader.min.js") || isAd(src) {
                if src.contains("rmp-vast") { try script.removeAttr("src"); try script.html("window.RmpVast=function(){};") }
                else { try script.remove() };continue
            }
            if try script.attr("type").range(of:"^[a-f0-9]+-text/javascript$",options:.regularExpression) != nil { try script.attr("type","text/javascript") }
            if try script.attr("data-name") == "ad" { try script.html("var middleCount=0,adTimeouts={},adsConfig={};") }
            else if !script.hasAttr("src") {
                try script.html(script.html().replacingOccurrences(of:#"ads\s*:\s*adsConfig"#,with:"ads: {}",options:.regularExpression).replacingOccurrences(of:#"if\s*\(\s*!isFramed\s*\)"#,with:"if(false)",options:.regularExpression))
            }
        }
        for el in try doc.select("script[src],link[href],video[src],source[src],track[src],img[src],iframe[src]") {
            let attr = el.tagName() == "link" ? "href":"src",value = try el.attr(el.tagName() == "link" ? "href":"src")
            if value.isEmpty || value.hasPrefix("data:") || value.hasPrefix("blob:") || value.hasPrefix("#") { continue }
            let absolute = resolve(value,base:target)
            if absolute.hasPrefix("https://") { try el.attr(attr,proxyURL(absolute,ref:target)) }
            try el.removeAttr("integrity").removeAttr("crossorigin")
        }
        // iPhone supports inline playback when both WebKit and the video element opt in.
        for video in try doc.select("video") { try video.attr("playsinline","").attr("webkit-playsinline","") }
        let injected = shield.replacingOccurrences(of:jsonString(sourceToken),with:jsonString(target))
        try doc.head()?.prepend(injected)
        return try doc.outerHtml()
    }
}
