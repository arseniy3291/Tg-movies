import SwiftUI
import WebKit
import CineGramCore

struct CinemaWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context:Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isElementFullscreenEnabled = true
        let view = WKWebView(frame:.zero,configuration:config)
        view.navigationDelegate = context.coordinator;view.uiDelegate = context.coordinator
        view.isOpaque = false;view.backgroundColor = .black;view.scrollView.backgroundColor = .black
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url:URL(string:LocalServer.origin)!))
        return view
    }
    func updateUIView(_ uiView:WKWebView,context:Context) {}
    final class Coordinator:NSObject,WKNavigationDelegate,WKUIDelegate {
        func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
            guard navigationAction.targetFrame?.isMainFrame == true else { decisionHandler(.allow);return }
            guard let url = navigationAction.request.url else { decisionHandler(.cancel);return }
            if url.scheme == "http" && url.host == "127.0.0.1" && url.port == 31849 { decisionHandler(.allow);return }
            if navigationAction.navigationType == .linkActivated && ["https","http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
        func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures) -> WKWebView? {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,["https","http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            return nil
        }
        func webView(_ webView:WKWebView,requestMediaCapturePermissionFor origin:WKSecurityOrigin,initiatedByFrame frame:WKFrameInfo,type:WKMediaCaptureType,decisionHandler:@escaping(WKPermissionDecision)->Void) { decisionHandler(.deny) }
    }
}
