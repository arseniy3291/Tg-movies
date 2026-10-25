package app.cinegram;

import java.lang.reflect.Method;
import java.net.URLDecoder;
import org.junit.Test;
import static org.junit.Assert.*;

public class MediaRewriteTest {
    private String invoke(String name, String body, String base, String ref) throws Exception {
        Method method = CineServer.class.getDeclaredMethod(name, String.class, String.class, String.class);
        method.setAccessible(true);
        return (String) method.invoke(null, body, base, ref);
    }
    @Test public void hlsRetainsSignedSegmentsAndEncryptionKeys() throws Exception {
        String result = invoke("rewriteHls", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key?token=a%2Fb\"\nseg.ts?token=x%2Fy\n",
            "https://cdn.example/show/master.m3u8", "https://player.example/embed/1");
        String decoded = URLDecoder.decode(result, "UTF-8");
        assertTrue(decoded.contains("url=https://cdn.example/key?token=a%2Fb"));
        assertTrue(decoded.contains("url=https://cdn.example/show/seg.ts?token=x%2Fy"));
        assertTrue(decoded.contains("ref=https://player.example/embed/1"));
    }
    @Test public void cssPreservesLocalSymbolsAndProxiesExternalSprites() throws Exception {
        String result = invoke("rewriteCss", "a{mask:url(#local)}b{background:url(../icons.svg#gear)}",
            "https://player.example/css/main.css", "https://player.example/embed/1");
        assertTrue(result.contains("url(#local)"));
        assertTrue(result.contains("#gear"));
        assertTrue(URLDecoder.decode(result,"UTF-8").contains("url=https://player.example/icons.svg"));
    }
    @Test public void hlsKeepsEmbeddedKeys() throws Exception {
        String body = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"data:application/octet-stream;base64,AAAA\"";
        assertTrue(invoke("rewriteHls",body,"https://cdn.example/list.m3u8","https://player.example/").contains("URI=\"data:application/octet-stream;base64,AAAA\""));
    }
}
