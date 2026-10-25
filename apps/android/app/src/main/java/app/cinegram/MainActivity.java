package app.cinegram;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static CineServer server;
    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(8,8,8)); root.setFitsSystemWindows(true); setContentView(root);
        TextView loading = new TextView(this); loading.setText("CineGram\nЗапуск кинотеатра…"); loading.setTextColor(Color.WHITE);
        loading.setGravity(17); root.addView(loading,new FrameLayout.LayoutParams(-1,-1));
        new Thread(() -> {
            try {
                synchronized (MainActivity.class) {
                    if (server == null) { server = new CineServer(getApplicationContext()); server.start(30000, false); }
                }
                runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) createWebView(state); });
            } catch (Exception error) {
                runOnUiThread(() -> new AlertDialog.Builder(this).setTitle("CineGram")
                    .setMessage("Не удалось запустить локальный сервис: " + error.getMessage()).setPositiveButton("Закрыть",(d,w)->finish()).show());
            }
        },"CineGram-start").start();
    }
    @SuppressWarnings("SetJavaScriptEnabled") private void createWebView(Bundle state) {
        root.removeAllViews(); web = new WebView(this); root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        web.setBackgroundColor(Color.rgb(8,8,8));
        WebSettings settings=web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri=request.getUrl();
                if ("127.0.0.1".equals(uri.getHost()) && uri.getPort()==31848) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen!=null) { callback.onCustomViewHidden(); return; }
                fullscreen=view;fullscreenCallback=callback;web.setVisibility(View.GONE);root.addView(view,new FrameLayout.LayoutParams(-1,-1));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            @Override public void onHideCustomView() { exitFullscreen(); }
        });
        if (state == null || web.restoreState(state)==null) web.loadUrl(CineServer.ORIGIN);
    }
    private void exitFullscreen() {
        if (fullscreen==null) return;
        root.removeView(fullscreen);fullscreen=null;web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (fullscreenCallback!=null) {fullscreenCallback.onCustomViewHidden();fullscreenCallback=null;}
    }
    @Override public void onBackPressed() { if(fullscreen!=null)exitFullscreen();else if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out);if(web!=null)web.saveState(out); }
    @Override protected void onDestroy() { if(web!=null)web.destroy();super.onDestroy(); }
}
