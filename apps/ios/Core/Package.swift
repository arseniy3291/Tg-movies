// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "CineGramCore", platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "CineGramCore", targets: ["CineGramCore"])],
    dependencies: [.package(url: "https://github.com/scinfu/SwiftSoup.git", exact: "2.13.9")],
    targets: [.target(name: "CineGramCore", dependencies: ["SwiftSoup"]),
              .testTarget(name: "CineGramCoreTests", dependencies: ["CineGramCore"])])
