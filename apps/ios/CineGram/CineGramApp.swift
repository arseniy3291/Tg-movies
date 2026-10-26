import SwiftUI
import CineGramCore

@main
struct CineGramApp: App {
    @StateObject private var model = LocalAppModel()
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red:0.03,green:0.03,blue:0.03).ignoresSafeArea()
                if model.ready { CinemaWebView() }
                else if let error = model.error {
                    VStack(spacing:20) {
                        Text("CineGram").font(.largeTitle.bold())
                        Text(error).multilineTextAlignment(.center)
                        Button("Повторить") { model.start() }.buttonStyle(.borderedProminent).tint(.red)
                    }.padding().foregroundStyle(.white)
                } else { VStack(spacing:16) { Text("CineGram").font(.largeTitle.bold());ProgressView("Запуск кинотеатра…") }.foregroundStyle(.white) }
            }.preferredColorScheme(.dark).task { if !model.started { model.start() } }
        }
    }
}
@MainActor final class LocalAppModel: ObservableObject {
    @Published var ready = false
    @Published var error: String?
    var started = false
    private var server:LocalServer?
    func start() {
        started = true;error = nil;ready = false;server?.stop()
        do {
            guard let resources = Bundle.main.url(forResource:"WebAssets",withExtension:nil) else { throw CocoaError(.fileNoSuchFile) }
            let config = try JSONSerialization.jsonObject(with:Data(contentsOf:resources.appendingPathComponent("config.json"))) as? [String:String]
            guard let key = config?["metadataKey"],!key.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
            let shield = try String(contentsOf:resources.appendingPathComponent("shield.html"),encoding:.utf8)
            let server = LocalServer(resources:resources,metadataKey:key,shield:shield);self.server = server
            try server.start { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success:self?.ready = true
                    case .failure(let error):self?.error = "Не удалось запустить локальный сервис: " + error.localizedDescription
                    }
                }
            }
        } catch { self.error = "Не удалось запустить CineGram: " + error.localizedDescription }
    }
}
