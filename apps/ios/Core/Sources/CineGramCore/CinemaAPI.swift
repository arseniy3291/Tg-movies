import Foundation
import SwiftSoup

enum CinemaError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

actor CinemaAPI {
    let shield: String
    private let resources: URL
    private let key: String
    private let session: URLSession
    private var cache: [String:(Date, Data)] = [:]
    private let hd = "https://lv.hdrezka.inc", kg = "https://kinogo.la"
    init(resources: URL, metadataKey: String, shield: String, session: URLSession? = nil) {
        self.resources = resources; key = metadataKey; self.shield = shield
        let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 25
        self.session = session ?? URLSession(configuration: config)
    }
    func handle(_ request: LocalRequest) async -> LocalResponse {
        do {
            let q = request.query
            if request.path == "/api/player-proxy" { return try proxy(request) }
            if request.path == "/api/image" || request.path == "/api/hdrezka/image" {
                let raw = request.path == "/api/image" ? q["url",default:""] : hd + q["path",default:""]
                guard let url = URL(string:raw), url.scheme == "https", let host = url.host,
                      host.hasSuffix(".kinopoisk.ru") || ["kinopoiskapiunofficial.tech","lv.hdrezka.inc"].contains(host) else { throw CinemaError.message("Недопустимый постер") }
                var upstream = URLRequest(url:url); upstream.setValue("Mozilla/5.0",forHTTPHeaderField:"User-Agent")
                if host == "kinopoiskapiunofficial.tech" { upstream.setValue(key,forHTTPHeaderField:"X-API-KEY") }
                return LocalResponse(proxy:upstream)
            }
            if request.path == "/api/video-sources" { return .json(await sources(title:q["title",default:q["originalTitle",default:""]],year:q["year",default:""])) }
            if request.path == "/api/movie" { return .json(try await movie(q["id",default:q["url",default:""]])) }
            if request.path == "/api/popular" {
                let series = q["type"] == "series", rating = q["sort"] == "rating"
                let type = series ? (rating ? "TOP_250_TV_SHOWS" : "POPULAR_SERIES") : (rating ? "TOP_250_MOVIES" : "TOP_POPULAR_MOVIES")
                return .json(cards(try await kp("/api/v2.2/films/collections?type=\(type)&page=\(page(q))")["items"] as? [[String:Any]] ?? []))
            }
            if request.path == "/api/discover" {
                var path = "/api/v2.2/films?order=\(q["sort"] == "rating" ? "RATING" : "NUM_VOTE")&ratingFrom=6&type=\(q["type"] == "series" ? "TV_SERIES" : "FILM")&page=\(page(q))"
                if let genre = q["genre"], !genre.isEmpty { path += "&genres=" + PlayerRewrite.encode(genre) }
                return .json(cards(try await kp(path)["items"] as? [[String:Any]] ?? []))
            }
            if request.path == "/api/search" { return .json(try await search(q)) }
            if request.path.hasPrefix("/api/") { return .json(["error":"Неизвестный API"],status:404) }
            let name = request.path == "/" ? "index.html" : String(request.path.dropFirst())
            guard !name.contains(".."), !name.contains("\\"), !name.contains("\0") else { return .json(["error":"Invalid path"],status:400) }
            let candidate = resources.appendingPathComponent("public").appendingPathComponent(name)
            let file = FileManager.default.fileExists(atPath:candidate.path) ? candidate : resources.appendingPathComponent("public/index.html")
            let mime = ["js":"application/javascript", "css":"text/css", "svg":"image/svg+xml", "png":"image/png", "jpg":"image/jpeg"][file.pathExtension] ?? "text/html; charset=utf-8"
            return LocalResponse(mime:mime,data:try Data(contentsOf:file))
        } catch { return .json(["error":"Не удалось загрузить данные: " + error.localizedDescription],status:502) }
    }
    private func page(_ q:[String:String]) -> Int { max(1,min(10000,Int(q["page",default:"1"]) ?? 1)) }
    private func fetch(_ raw:String, metadata:Bool = false) async throws -> Data {
        if let hit = cache[raw], Date().timeIntervalSince(hit.0) < 120 { return hit.1 }
        guard let url = URL(string:raw) else { throw CinemaError.message("Неверный адрес") }
        var request = URLRequest(url:url); request.setValue("Mozilla/5.0",forHTTPHeaderField:"User-Agent")
        if metadata { request.setValue(key,forHTTPHeaderField:"X-API-KEY") }
        let (data,response) = try await session.data(for:request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw CinemaError.message("Источник вернул HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)") }
        guard data.count <= 8 * 1024 * 1024 else { throw CinemaError.message("Ответ слишком большой") }
        if cache.count > 100 { cache.removeAll() };cache[raw] = (Date(),data);return data
    }
    private func kp(_ path:String) async throws -> [String:Any] {
        (try JSONSerialization.jsonObject(with:await fetch("https://kinopoiskapiunofficial.tech"+path,metadata:true))) as? [String:Any] ?? [:]
    }
    private func str(_ row:[String:Any],_ keys:String...) -> String {
        for key in keys { if let value = row[key], !(value is NSNull), !String(describing:value).isEmpty { return String(describing:value) } };return ""
    }
    private func rate(_ raw:String) -> String {
        guard let value = Double(raw.replacingOccurrences(of:"%",with:"")), value > 0 else { return "" }
        return String(format:"%.1f",locale:Locale(identifier:"en_US_POSIX"),raw.hasSuffix("%") ? value / 10 : value)
    }
    private func join(_ rows:Any?,key:String,limit:Int = 20) -> String {
        ((rows as? [[String:Any]]) ?? []).prefix(limit).compactMap { $0[key] as? String }.joined(separator:", ")
    }
    private func cards(_ rows:[[String:Any]]) -> [[String:Any]] {
        rows.compactMap { row in
            let id = str(row,"kinopoiskId","filmId"), poster = str(row,"posterUrlPreview","posterUrl")
            guard !id.isEmpty, !poster.isEmpty, !poster.contains("no-poster") else { return nil }
            let year = str(row,"year"), genre = join(row["genres"],key:"genre",limit:2), kp = rate(str(row,"ratingKinopoisk","rating")), imdb = rate(str(row,"ratingImdb"))
            return ["id":id,"provider":"kinopoisk","title":str(row,"nameRu","nameOriginal","nameEn"),"originalTitle":str(row,"nameOriginal","nameEn"),"poster":"/api/image?url="+PlayerRewrite.encode(poster),"year":year,"info":[year,genre].filter{!$0.isEmpty}.joined(separator:", "),"rating":kp.isEmpty ? imdb:kp,"ratingKp":kp,"ratingImdb":imdb,"url":"/movie/"+id]
        }
    }
    private func search(_ q:[String:String]) async throws -> [[String:Any]] {
        let title = q["q",default:""].trimmingCharacters(in:.whitespacesAndNewlines), genre = q["genre",default:""], year = q["year",default:""]
        if title.isEmpty && genre.isEmpty && year.isEmpty { return [] }
        if genre.isEmpty && year.isEmpty { return cards(try await kp("/api/v2.1/films/search-by-keyword?keyword=\(PlayerRewrite.encode(title))&page=\(page(q))")["films"] as? [[String:Any]] ?? []) }
        var path = "/api/v2.2/films?order=NUM_VOTE&page=\(page(q))&keyword="+PlayerRewrite.encode(title)
        if !genre.isEmpty { path += "&genres="+PlayerRewrite.encode(genre) }
        if !year.isEmpty { let parts = year.components(separatedBy:"-");path += "&yearFrom=\(PlayerRewrite.encode(parts[0]))&yearTo=\(PlayerRewrite.encode(parts.last!))" }
        return cards(try await kp(path)["items"] as? [[String:Any]] ?? [])
    }
    private func movie(_ raw:String) async throws -> [String:Any] {
        let id = raw.components(separatedBy:"/").last ?? ""
        if id.hasPrefix("hd_") { return try await hdMovie(id) }
        guard id.range(of:"^[0-9]+$",options:.regularExpression) != nil else { throw CinemaError.message("Неверный ID фильма") }
        let row = try await kp("/api/v2.2/films/"+id)
        var directors:[String] = [],actors:[String] = []
        if let data = try? await fetch("https://kinopoiskapiunofficial.tech/api/v1/staff?filmId="+id,metadata:true), let staff = try? JSONSerialization.jsonObject(with:data) as? [[String:Any]] {
            directors = staff.filter{($0["professionKey"] as? String) == "DIRECTOR"}.prefix(3).map{str($0,"nameRu","nameEn")}
            actors = staff.filter{($0["professionKey"] as? String) == "ACTOR"}.prefix(8).map{str($0,"nameRu","nameEn")}
        }
        let kp = rate(str(row,"ratingKinopoisk")), imdb = rate(str(row,"ratingImdb"))
        return ["id":id,"provider":"kinopoisk","title":str(row,"nameRu","nameOriginal","nameEn"),"originalTitle":str(row,"nameOriginal","nameEn"),"description":str(row,"description","shortDescription"),"poster":"/api/image?url="+PlayerRewrite.encode(str(row,"posterUrl")),"year":str(row,"year"),"genre":join(row["genres"],key:"genre"),"rating":kp.isEmpty ? imdb:kp,"ratingKp":kp,"ratingImdb":imdb,"countries":join(row["countries"],key:"country"),"length":((row["filmLength"] as? Int) ?? 0) > 0 ? "\(row["filmLength"]!) мин.":"","directors":directors.joined(separator:", "),"actors":actors.joined(separator:", "),"url":"/movie/"+id,"videoSources":[]]
    }
    private func hdMovie(_ id:String) async throws -> [String:Any] {
        var encoded = String(id.dropFirst(3)).replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")
        encoded += String(repeating:"=",count:(4-encoded.count%4)%4)
        guard let data = Data(base64Encoded:encoded),let path = String(data:data,encoding:.utf8),path.range(of:"^/(filmy|serialy|multfilmy|anime)/[0-9]+-[a-z0-9-]+\\.html$",options:.regularExpression) != nil else { throw CinemaError.message("Неверная карточка") }
        let doc = try SwiftSoup.parse(String(decoding:await fetch(hd+path),as:UTF8.self),hd)
        var result:[String:Any] = ["id":id,"provider":"hdrezka","url":"/movie/"+id,"title":try doc.select(".innerPost h1").text(),"description":try doc.select(".postText").text(),"poster":try doc.select(".postImg img").first()?.attr("abs:src") ?? "","videoSources":[]]
        for row in try doc.select(".post__info tr") {
            let label = try row.select("td").first()?.text() ?? "",value = try row.select("td").last()?.text() ?? ""
            for (match,key) in [("Дата выхода","year"),("Жанр","genre"),("Страна","countries"),("Режиссер","directors"),("Время","length")] where label.contains(match) { result[key] = value }
        };return result
    }
    private func sources(title:String,year:String) async -> [String:Any] {
        async let hdr = findSources(title:title,year:year,base:hd,provider:"hdrezka")
        async let kng = findSources(title:title,year:year,base:kg,provider:"kinogo")
        let (h,k) = await (hdr,kng)
        let order = ["Kinogo · Плеер 2","HDRezka · Плеер 3","Kinogo · Смотреть онлайн","HDRezka · Смотреть онлайн","HDRezka · Плеер 1"]
        func rank(_ s:[String:Any]) -> Int { (s["trailer"] as? Bool) == true ? 99 : order.firstIndex(of:s["name"] as? String ?? "") ?? 90 }
        let rows = (h.0+k.0).enumerated().sorted { rank($0.element) == rank($1.element) ? $0.offset < $1.offset : rank($0.element) < rank($1.element) }.map(\.element)
        return ["sources":rows,"hdrezkaUrl":h.1,"kinogoUrl":k.1]
    }
    private func norm(_ s:String) -> String {
        s.lowercased().replacingOccurrences(of:"ё",with:"е").replacingOccurrences(of:"\\([0-9]{4}[^)]*\\)",with:"",options:.regularExpression).replacingOccurrences(of:"[^a-zа-я0-9]+",with:" ",options:.regularExpression).trimmingCharacters(in:.whitespaces)
    }
    private func findSources(title:String,year:String,base:String,provider:String) async -> ([[String:Any]],String) {
        guard !title.isEmpty else { return ([],base) }
        do {
            let isHD = provider == "hdrezka"
            let search = base+(isHD ? "/index.php?do=search&subaction=search&story=" : "/search/")+PlayerRewrite.encode(title)
            let doc = try SwiftSoup.parse(String(decoding:await fetch(search),as:UTF8.self),base)
            var best:String?,score = 0
            for link in try doc.select(isHD ? "#dle-content .postTitle a" : "#dle-content .shortstorytitle h2 a") {
                let target = norm(title),candidate = norm(try link.text())
                var value = candidate == target ? 10 : (!candidate.isEmpty && (candidate.contains(target) || target.contains(candidate)) ? 5 : 0)
                guard value > 0 else { continue }
                if let card = link.parents().array().first(where: { $0.hasClass(isHD ? "postItem":"movie") }),!year.isEmpty,try card.text().contains(year) { value += 4 }
                let href = try link.attr("abs:href")
                if value > score && href.hasPrefix(base+"/") { score = value;best = href }
            }
            guard let page = best else { return ([],search) }
            let detail = try SwiftSoup.parse(String(decoding:await fetch(page),as:UTF8.self),page)
            let frames = try detail.select(isHD ? ".playerWrap .player-tabs [data-src], .playerWrap .player-container iframe" : "#preroll .box iframe")
            let tabs = try detail.select(".player-tabs li").array()
            var rows:[[String:Any]] = [],seen:Set<String> = []
            for (i,frame) in frames.enumerated() {
                let raw = try frame.hasAttr("data-src") ? frame.attr("data-src") : frame.attr("src")
                guard !raw.isEmpty, let url = URL(string:raw,relativeTo:URL(string:page))?.absoluteURL,url.scheme == "https",seen.insert(url.absoluteString).inserted else { continue }
                let label = isHD ? (frame.tagName() == "iframe" ? "Смотреть онлайн":try frame.text()) : (i < tabs.count ? try tabs[i].text():"Плеер \(i+1)")
                let trailer = label.lowercased().contains("трейлер") || url.host == "www.youtube.com" || url.host == "youtube.com" || url.path.contains("/trailer/")
                rows.append(["source":provider,"name":(isHD ? "HDRezka · ":"Kinogo · ")+label,"type":"iframe","url":trailer ? url.absoluteString:PlayerRewrite.proxyURL(url.absoluteString,ref:base),"directUrl":url.absoluteString,"trailer":trailer])
            };return (rows,page)
        } catch { return ([],base) }
    }
    private func proxy(_ request:LocalRequest) throws -> LocalResponse {
        let q = request.query,raw = q["url",default:""],ref = q["ref",default:hd+"/"]
        guard let url = URL(string:raw), PlayerRewrite.validRemote(url), let referer = URL(string:ref),PlayerRewrite.validRemote(referer) else { throw CinemaError.message("Недопустимый источник") }
        if PlayerRewrite.isAd(raw) { return LocalResponse(mime:"application/xml",data:Data("<VAST version=\"3.0\"></VAST>".utf8)) }
        guard ["GET","POST","HEAD"].contains(request.method) else { return .json(["error":"Method not allowed"],status:405) }
        var upstream = URLRequest(url:url);upstream.httpMethod = request.method
        if request.method == "POST" { upstream.httpBody = request.body }
        upstream.setValue(request.headers["user-agent"] ?? "Mozilla/5.0",forHTTPHeaderField:"User-Agent")
        upstream.setValue(ref,forHTTPHeaderField:"Referer");upstream.setValue("https://"+referer.host!+(referer.port.map{":\($0)"} ?? ""),forHTTPHeaderField:"Origin")
        upstream.setValue("identity",forHTTPHeaderField:"Accept-Encoding")
        for name in ["content-type","range","if-range","borth","authorization","accepts-block","x-requested-with"] { if let value = request.headers[name] { upstream.setValue(value,forHTTPHeaderField:name) } }
        return LocalResponse(proxy:upstream)
    }
}
