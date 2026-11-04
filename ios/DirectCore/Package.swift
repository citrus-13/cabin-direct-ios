// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "DirectCore", platforms: [.macOS(.v12), .iOS(.v15)], products: [
    .library(name: "DirectCore", targets: ["DirectCore"]),
    .executable(name: "direct-fixture", targets: ["DirectFixture"]),
    .executable(name: "direct-core-tests", targets: ["DirectCoreTests"])
], targets: [
    .target(name: "DirectCore", path: ".", exclude: ["Tests", "Fixture", "Package.swift"], sources: ["LocalHTTPServer.swift"]),
    .executableTarget(name: "DirectFixture", dependencies: ["DirectCore"], path: "Fixture"),
    .executableTarget(name: "DirectCoreTests", dependencies: ["DirectCore"], path: "Tests")
])
