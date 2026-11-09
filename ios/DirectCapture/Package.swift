// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DirectCapture",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "DirectCapture", targets: ["DirectCapture"])],
    targets: [
        .target(name: "DirectCapture", path: ".", exclude: ["Tests"], sources: ["CapturePipeline.swift", "DirectMediaPipeline.swift", "FragmentedMP4.swift"]),
        .testTarget(name: "DirectCaptureTests", dependencies: ["DirectCapture"], path: "Tests")
    ]
)
