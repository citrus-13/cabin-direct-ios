// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TeslaBLE",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "TeslaBLE", targets: ["TeslaBLE"])],
    targets: [
        .target(name: "TeslaBLE"),
        // Native offline checks also run on Command Line Tools hosts without XCTest.
        .executableTarget(name: "TeslaBLEOfflineChecks", dependencies: ["TeslaBLE"], path: "Tests/TeslaBLETests")
    ]
)
