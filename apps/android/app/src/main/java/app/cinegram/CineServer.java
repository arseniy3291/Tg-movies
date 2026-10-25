package app.cinegram;

import android.content.Context;
import android.util.Base64;
import fi.iki.elonen.NanoHTTPD;
import okhttp3.*;
import org.json.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.*;

/** Private, device-local API. No public backend or account is required. */
final class CineServer extends NanoHTTPD {
    static final String ORIGIN="http://127.0.0.1:31848";
    private static final String HD="https://lv.hdrezka.inc", KG="https://kinogo.la";
    private final android.content.res.AssetManager assets;
    private final OkHttpClient client=new OkHttpClient.Builder().connectTimeout(12,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS).build();
    private final Map<String,Cache> cache=Collections.synchronizedMap(new LinkedHashMap<>());
    private final String shield;
    private static final Pattern ADS=Pattern.compile("distribrey\\.com|agl00\\d\\.|bidster\\.net|bracdn\\.online|tds\\.bid|adfox|googlesyndication\\.com|doubleclick\\.net|adhigh\\.net|buzzoola\\.com|mixadvert\\.com|traforet\\.com|adriver\\.ru|betweendigital\\.com|temptcdn\\.com|getsdk\\.online|vavada|1xbet|melbet|mostbet|rmp-vast|/load-xml/|/vast/|[?&]roll=(pre|mid|post)",Pattern.CASE_INSENSITIVE);
    private static class Cache { final String value; final long time=System.currentTimeMillis();Cache(String value){this.value=value;} }
    CineServer(Context context) throws IOException { super("127.0.0.1",31848);this.assets=context.getAssets();this.shield=readAsset("shield.html"); }
    @Override public NanoHTTPD.Response serve(IHTTPSession session) {
        try {
            String path=session.getUri();Map<String,String> q=session.getParms();
            if(path.equals("/api/player-proxy"))return proxy(session,q);
            if(path.equals("/api/image"))return image(q.get("url"));
            if(path.equals("/api/hdrezka/image"))return image(HD+q.getOrDefault("path",""));
            if(path.equals("/api/video-sources"))return json(sources(q.getOrDefault("title",q.getOrDefault("originalTitle","")),q.getOrDefault("year","")));
            if(path.equals("/api/movie"))return json(movie(q.getOrDefault("id",q.getOrDefault("url",""))));
            if(path.equals("/api/popular")) {
                boolean series="series".equals(q.get("type")),rating="rating".equals(q.get("sort"));
                String type=series?(rating?"TOP_250_TV_SHOWS":"POPULAR_SERIES"):(rating?"TOP_250_MOVIES":"TOP_POPULAR_MOVIES");
                return json(cards(kp("/api/v2.2/films/collections?type="+type+"&page="+page(q)).optJSONArray("items")));
            }
            if(path.equals("/api/discover")) {
                String p="/api/v2.2/films?order="+("rating".equals(q.get("sort"))?"RATING":"NUM_VOTE")+"&ratingFrom=6&type="+("series".equals(q.get("type"))?"TV_SERIES":"FILM")+"&page="+page(q);
                if(!q.getOrDefault("genre","").isEmpty())p+="&genres="+enc(q.get("genre"));
                return json(cards(kp(p).optJSONArray("items")));
            }
            if(path.equals("/api/search"))return json(search(q));
            if(path.startsWith("/api/"))return newFixedLengthResponse(Response.Status.NOT_FOUND,"application/json","{\"error\":\"Неизвестный API\"}");
            String file=path.equals("/")?"index.html":path.substring(1);
            if(file.contains("..")||file.contains("\\"))return newFixedLengthResponse(Response.Status.BAD_REQUEST,"text/plain","Invalid path");
            try {return asset(file);}catch(IOException e){return asset("index.html");}
        }catch(Exception e){return newFixedLengthResponse(status(502),"application/json; charset=utf-8","{\"error\":"+JSONObject.quote("Не удалось загрузить данные: "+e.getMessage())+"}");}
    }
    private static NanoHTTPD.Response.IStatus status(int code) {
        NanoHTTPD.Response.Status known = NanoHTTPD.Response.Status.lookup(code);
        if (known != null) return known;
        return new NanoHTTPD.Response.IStatus() {
            public int getRequestStatus() { return code; }
            public String getDescription() { return code + " Upstream Response"; }
        };
    }
    private int page(Map<String,String> q){try{return Math.max(1,Math.min(10000,Integer.parseInt(q.getOrDefault("page","1"))));}catch(Exception e){return 1;}}
    private String readAsset(String name)throws IOException{try(InputStream in=assets.open(name)){return new String(readAll(in,8*1024*1024),StandardCharsets.UTF_8);}}
    private NanoHTTPD.Response asset(String file)throws IOException{
        String mime=file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".png")?"image/png":"text/html";
        NanoHTTPD.Response response=newChunkedResponse(Response.Status.OK,mime,assets.open("public/"+file));response.addHeader("Cache-Control","no-cache");return response;
    }
    private NanoHTTPD.Response json(Object data){NanoHTTPD.Response response=newFixedLengthResponse(Response.Status.OK,"application/json; charset=utf-8",data.toString());response.addHeader("Cache-Control","no-store");return response;}
    private static String enc(String value){try{return URLEncoder.encode(value,"UTF-8");}catch(Exception e){return "";}}
    private static String clean(String s){return s==null?"":s.replaceAll("\\s+"," ").trim();}
    private String fetch(String url,boolean kp)throws Exception{
        Cache hit=cache.get(url);if(hit!=null&&System.currentTimeMillis()-hit.time<120000)return hit.value;
        Request.Builder request=new Request.Builder().url(url).header("User-Agent","Mozilla/5.0");if(kp)request.header("X-API-KEY",AppConfig.KP_KEY);
        try(okhttp3.Response response=client.newCall(request.build()).execute()){
            if(!response.isSuccessful())throw new IOException("Источник вернул HTTP "+response.code());
            String body=response.body().string();if(cache.size()>100)cache.clear();cache.put(url,new Cache(body));return body;
        }
    }
    private JSONObject kp(String path)throws Exception{return new JSONObject(fetch("https://kinopoiskapiunofficial.tech"+path,true));}
    private static String str(JSONObject o,String...keys){for(String key:keys){Object v=o.opt(key);if(v!=null&&v!=JSONObject.NULL&&!v.toString().isEmpty())return v.toString();}return "";}
    private static String rating(String value){try{double n=Double.parseDouble(value.replace("%",""));if(value.endsWith("%"))n/=10;return n>0?String.format(Locale.US,"%.1f",n):"";}catch(Exception e){return "";}}
    private static String join(JSONArray rows,String key,int max){List<String> values=new ArrayList<>();if(rows!=null)for(int i=0;i<Math.min(max,rows.length());i++){JSONObject row=rows.optJSONObject(i);if(row!=null)values.add(row.optString(key));}return String.join(", ",values);}
    private JSONArray cards(JSONArray rows)throws JSONException{JSONArray result=new JSONArray();if(rows==null)return result;for(int i=0;i<rows.length();i++){
        JSONObject row=rows.optJSONObject(i);if(row==null)continue;
        String id=str(row,"kinopoiskId","filmId"),poster=str(row,"posterUrlPreview","posterUrl");if(id.isEmpty()||poster.isEmpty()||poster.contains("no-poster"))continue;
        String year=str(row,"year"),genre=join(row.optJSONArray("genres"),"genre",2),kpRate=rating(str(row,"ratingKinopoisk","rating")),imdb=rating(str(row,"ratingImdb"));
        result.put(new JSONObject().put("id",id).put("provider","kinopoisk").put("title",str(row,"nameRu","nameOriginal","nameEn")).put("originalTitle",str(row,"nameOriginal","nameEn"))
            .put("poster","/api/image?url="+enc(poster)).put("year",year).put("info",year+(genre.isEmpty()?"":", "+genre)).put("rating",kpRate.isEmpty()?imdb:kpRate).put("ratingKp",kpRate).put("ratingImdb",imdb).put("url","/movie/"+id));
    }return result;}
    private JSONArray search(Map<String,String> q)throws Exception{
        String text=q.getOrDefault("q","").trim(),genre=q.getOrDefault("genre",""),year=q.getOrDefault("year","");
        if(text.isEmpty()&&genre.isEmpty()&&year.isEmpty())return new JSONArray();
        if(genre.isEmpty()&&year.isEmpty())return cards(kp("/api/v2.1/films/search-by-keyword?keyword="+enc(text)+"&page="+page(q)).optJSONArray("films"));
        String path="/api/v2.2/films?order=NUM_VOTE&page="+page(q)+"&keyword="+enc(text);
        if(!genre.isEmpty())path+="&genres="+enc(genre);
        if(!year.isEmpty()){String[] y=year.split("-");path+="&yearFrom="+enc(y[0])+"&yearTo="+enc(y[y.length-1]);}
        return cards(kp(path).optJSONArray("items"));
    }
    private JSONObject movie(String raw)throws Exception{
        String id=raw.substring(raw.lastIndexOf('/')+1);
        if(id.startsWith("hd_"))return hdMovie(id);
        if(!id.matches("\\d+"))throw new IOException("Неверный ID фильма");
        JSONObject row=kp("/api/v2.2/films/"+id);List<String> directors=new ArrayList<>(),actors=new ArrayList<>();
        try{JSONArray staff=new JSONArray(fetch("https://kinopoiskapiunofficial.tech/api/v1/staff?filmId="+id,true));for(int i=0;i<staff.length();i++){
            JSONObject p=staff.getJSONObject(i);String name=str(p,"nameRu","nameEn");if("DIRECTOR".equals(p.optString("professionKey"))&&directors.size()<3)directors.add(name);if("ACTOR".equals(p.optString("professionKey"))&&actors.size()<8)actors.add(name);
        }}catch(Exception ignored){}
        String kpRate=rating(str(row,"ratingKinopoisk")),imdb=rating(str(row,"ratingImdb"));
        return new JSONObject().put("id",id).put("provider","kinopoisk").put("title",str(row,"nameRu","nameOriginal","nameEn")).put("originalTitle",str(row,"nameOriginal","nameEn"))
            .put("description",str(row,"description","shortDescription")).put("poster","/api/image?url="+enc(str(row,"posterUrl"))).put("year",str(row,"year")).put("genre",join(row.optJSONArray("genres"),"genre",20))
            .put("rating",kpRate.isEmpty()?imdb:kpRate).put("ratingKp",kpRate).put("ratingImdb",imdb).put("countries",join(row.optJSONArray("countries"),"country",20))
            .put("length",row.optInt("filmLength")>0?row.optInt("filmLength")+" мин.":"").put("directors",String.join(", ",directors)).put("actors",String.join(", ",actors)).put("url","/movie/"+id).put("videoSources",new JSONArray());
    }
    private JSONObject hdMovie(String id)throws Exception{
        String path=new String(Base64.decode(id.substring(3),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8);
        if(!path.matches("/(filmy|serialy|multfilmy|anime)/[0-9]+-[a-z0-9-]+\\.html"))throw new IOException("Неверная карточка");
        Document doc=Jsoup.parse(fetch(HD+path,false),HD);JSONObject result=new JSONObject().put("id",id).put("provider","hdrezka").put("url","/movie/"+id).put("title",doc.select(".innerPost h1").text()).put("description",doc.select(".postText").text()).put("poster",doc.select(".postImg img").attr("abs:src"));
        for(Element row:doc.select(".post__info tr")){String label=row.select("td").first().text();String value=row.select("td").last().text();String key=label.contains("Дата выхода")?"year":label.contains("Жанр")?"genre":label.contains("Страна")?"countries":label.contains("Режиссер")?"directors":label.contains("Время")?"length":"";if(!key.isEmpty())result.put(key,value);}
        return result.put("videoSources",new JSONArray());
    }
    private static String norm(String title){return clean(title).toLowerCase(Locale.ROOT).replace('ё','е').replaceAll("\\([0-9]{4}[^)]*\\)","").replaceAll("[^a-zа-я0-9]+"," ").trim();}
    private JSONObject source(Element frame,String name,String base,String provider){
        String raw=frame.hasAttr("data-src")?frame.attr("data-src"):frame.attr("src");
        try{String url=new URL(new URL(base),raw).toString();if(!url.startsWith("https://"))return null;
            boolean trailer=name.toLowerCase(Locale.ROOT).contains("трейлер")||url.contains("youtube.com/")||url.contains("/trailer/");
            return new JSONObject().put("source",provider).put("name",provider.equals("kinogo")?"Kinogo · "+name:"HDRezka · "+name).put("type","iframe").put("url",trailer?url:proxyUrl(url,base)).put("directUrl",url).put("trailer",trailer);
        }catch(Exception e){return null;}
    }
    private JSONObject sources(String title,String year)throws Exception{
        List<JSONObject> sources=new ArrayList<>();String[] sourcePages={HD,KG};
        for(int provider=0;provider<2;provider++)try{
            String base=provider==0?HD:KG;
            Document search=Jsoup.parse(fetch(base+(provider==0?"/index.php?do=search&subaction=search&story=":"/search/")+enc(title),false),base);
            Element best=null;int score=0;
            for(Element a:search.select(provider==0?"#dle-content .postTitle a":"#dle-content .shortstorytitle h2 a")){
                String target=norm(title),candidate=norm(a.text());int value=candidate.equals(target)?10:(!candidate.isEmpty()&&(candidate.contains(target)||target.contains(candidate))?5:0);
                if(value==0)continue;
                Element card=a.closest(provider==0?".postItem":".movie");if(card!=null&&!year.isEmpty()&&card.text().contains(year))value+=4;
                if(value>score&&a.attr("abs:href").startsWith(base+"/")){score=value;best=a;}
            }
            if(best==null)continue;
            String page=best.attr("abs:href");sourcePages[provider]=page;Document detail=Jsoup.parse(fetch(page,false),page);
            Set<String> seen=new HashSet<>();
            if(provider==0){for(Element frame:detail.select(".playerWrap .player-tabs [data-src], .playerWrap .player-container iframe")){
                JSONObject s=source(frame,frame.tagName().equals("iframe")?"Смотреть онлайн":frame.text(),base,"hdrezka");if(s!=null&&seen.add(s.optString("directUrl")))sources.add(s);
            }}else{List<Element> tabs=detail.select(".player-tabs li");int i=0;for(Element frame:detail.select("#preroll .box iframe")){
                String name=i<tabs.size()?tabs.get(i).text():"Плеер "+(i+1);i++;JSONObject s=source(frame,name,base,"kinogo");if(s!=null&&seen.add(s.optString("directUrl")))sources.add(s);
            }}
        }catch(Exception ignored){}
        List<String> order=Arrays.asList("Kinogo · Плеер 2","HDRezka · Плеер 3","Kinogo · Смотреть онлайн","HDRezka · Смотреть онлайн","HDRezka · Плеер 1");
        sources.sort(Comparator.comparingInt(s->s.optBoolean("trailer")?99:order.contains(s.optString("name"))?order.indexOf(s.optString("name")):90));
        JSONArray result=new JSONArray();for(JSONObject source:sources)result.put(source);
        return new JSONObject().put("sources",result).put("hdrezkaUrl",sourcePages[0]).put("kinogoUrl",sourcePages[1]);
    }
    private NanoHTTPD.Response image(String url)throws Exception{
        URL parsed=new URL(url);String host=parsed.getHost();if(!parsed.getProtocol().equals("https")||!(host.equals("kinopoiskapiunofficial.tech")||host.equals("lv.hdrezka.inc")||host.endsWith(".kinopoisk.ru")))throw new IOException("Недопустимый постер");
        okhttp3.Response response=client.newCall(new Request.Builder().url(url).header("User-Agent","Mozilla/5.0").header("X-API-KEY",AppConfig.KP_KEY).build()).execute();
        return streamed(response);
    }
    private static String proxyUrl(String raw,String ref){try{URI url=new URI(raw);String hash=url.getRawFragment();String target=hash==null?raw:raw.substring(0,raw.indexOf('#'));return ORIGIN+"/api/player-proxy?url="+enc(target)+"&ref="+enc(ref)+"&sub=1"+(hash==null?"":"#"+hash);}catch(Exception e){return raw;}}
    private NanoHTTPD.Response proxy(IHTTPSession session,Map<String,String> q)throws Exception{
        String url=q.getOrDefault("url",""),ref=q.getOrDefault("ref",HD+"/");URL parsed=new URL(url),referer=new URL(ref);
        if(!parsed.getProtocol().equals("https")||parsed.getUserInfo()!=null||!referer.getProtocol().equals("https"))throw new IOException("Недопустимый источник");
        if(ADS.matcher(url).find())return newFixedLengthResponse(Response.Status.OK,"application/xml","<VAST version=\"3.0\"></VAST>");
        Map<String,String> h=session.getHeaders();Request.Builder request=new Request.Builder().url(url).header("User-Agent",h.getOrDefault("user-agent","Mozilla/5.0")).header("Accept-Encoding","identity").header("Referer",ref).header("Origin",referer.getProtocol()+"://"+referer.getAuthority());
        for(String name:Arrays.asList("content-type","range","if-range","borth","authorization","accepts-block","x-requested-with"))if(h.containsKey(name))request.header(name,h.get(name));
        if(session.getMethod()==Method.POST){int size=Integer.parseInt(h.getOrDefault("content-length","0"));if(size<0||size>2097152)throw new IOException("Слишком большой запрос");byte[] body=new byte[size];int offset=0;while(offset<size){int count=session.getInputStream().read(body,offset,size-offset);if(count<0)break;offset+=count;}request.post(RequestBody.create(body,MediaType.parse(h.getOrDefault("content-type","application/octet-stream"))));}
        else if(session.getMethod()==Method.HEAD)request.head();
        okhttp3.Response remote=client.newCall(request.build()).execute();String mime=remote.header("Content-Type","application/octet-stream"),finalUrl=remote.request().url().toString();
        boolean html=mime.contains("text/html"),css=mime.contains("text/css"),hls=mime.toLowerCase(Locale.ROOT).contains("mpegurl")||finalUrl.split("\\?")[0].endsWith(".m3u8");
        if(!html&&!css&&!hls&&remote.code()==200&&!mime.startsWith("video/"))hls=remote.peekBody(32).string().trim().startsWith("#EXTM3U");
        if(remote.code()==200&&(html||css||hls)&&session.getMethod()!=Method.HEAD){
            String body=remote.body().string();remote.close();
            if(html){body=cleanHtml(body,finalUrl);mime="text/html; charset=utf-8";}
            else if(hls){body=rewriteHls(body,finalUrl,ref);mime="application/vnd.apple.mpegurl";}
            else body=rewriteCss(body,finalUrl,ref);
            NanoHTTPD.Response response=newFixedLengthResponse(Response.Status.OK,mime,body);response.addHeader("Cache-Control","no-store");return response;
        }
        return streamed(remote);
    }
    private NanoHTTPD.Response streamed(okhttp3.Response remote){
        InputStream stream=new FilterInputStream(remote.body().byteStream()){@Override public void close()throws IOException{super.close();remote.close();}};
        NanoHTTPD.Response response=newChunkedResponse(status(remote.code()),remote.header("Content-Type","application/octet-stream"),stream);
        for(String h:Arrays.asList("Content-Range","Accept-Ranges"))if(remote.header(h)!=null)response.addHeader(h,remote.header(h));
        response.addHeader("Cache-Control","no-store");return response;
    }
    private String cleanHtml(String body,String target)throws Exception{
        Document doc=Jsoup.parse(body,target);
        for(Element script:doc.select("script")){
            String src=script.attr("src");if(src.contains("rocket-loader.min.js")||ADS.matcher(src).find()){
                if(src.contains("rmp-vast"))script.removeAttr("src").html("window.RmpVast=function(){};");else script.remove();continue;
            }
            if(script.attr("type").matches("[a-f0-9]+-text/javascript"))script.attr("type","text/javascript");
            if("ad".equals(script.attr("data-name")))script.html("var middleCount=0,adTimeouts={},adsConfig={};");
            else if(!script.hasAttr("src"))script.html(script.html().replaceAll("ads\\s*:\\s*adsConfig","ads: {}").replaceAll("if\\s*\\(\\s*!isFramed\\s*\\)","if(false)"));
        }
        for(Element el:doc.select("script[src],link[href],video[src],source[src],track[src],img[src]")){
            String attr=el.tagName().equals("link")?"href":"src",value=el.attr(attr);
            if(value.isEmpty()||value.startsWith("data:")||value.startsWith("blob:")||value.startsWith("#"))continue;
            try{String absolute=new URL(new URL(target),value).toString();if(absolute.startsWith("https://"))el.attr(attr,proxyUrl(absolute,target));}catch(Exception ignored){}
            el.removeAttr("integrity").removeAttr("crossorigin");
        }
        doc.head().prepend(shield.replace(JSONObject.quote("https://cinegram-origin.invalid/__SOURCE__"),JSONObject.quote(target)));
        return doc.outerHtml();
    }
    private static String rewriteHls(String body,String base,String ref)throws Exception{
        StringBuilder out=new StringBuilder();Pattern uri=Pattern.compile("URI=\"([^\"]+)\"");
        for(String line:body.split("\\r?\\n",-1)){
            if(line.startsWith("#")){Matcher matcher=uri.matcher(line);StringBuffer sb=new StringBuffer();while(matcher.find()){String value=matcher.group(1);String rewritten=value.startsWith("data:")||value.startsWith("skd:")?value:proxyUrl(new URL(new URL(base),value).toString(),ref);matcher.appendReplacement(sb,Matcher.quoteReplacement("URI=\""+rewritten+"\""));}matcher.appendTail(sb);out.append(sb);}
            else if(!line.trim().isEmpty())out.append(proxyUrl(new URL(new URL(base),line.trim()).toString(),ref));
            out.append('\n');
        }return out.toString();
    }
    private static String rewriteCss(String body,String base,String ref){
        Matcher m=Pattern.compile("url\\(\\s*(['\"]?)([^)'\"\\s]+)\\1\\s*\\)").matcher(body);StringBuffer result=new StringBuffer();
        while(m.find()){String uri=m.group(2);if(uri.startsWith("data:")||uri.startsWith("#"))continue;
            try{m.appendReplacement(result,Matcher.quoteReplacement("url(\""+proxyUrl(new URL(new URL(base),uri).toString(),ref)+"\")"));}catch(Exception ignored){}
        }m.appendTail(result);return result.toString();
    }
    private static byte[] readAll(InputStream in,int max)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>max)throw new IOException("Слишком большой файл");}return out.toByteArray();}
}
