import Foundation
import CryptoKit
import Security

/// App and extension must use the SAME provisioned Keychain access group and VIN-specific tag.
/// App Groups and Keychain access groups are different entitlements. Nothing is stored in files.
public final class TeslaKeyStore {
    private let service: String
    private let accessGroup: String?
    private let tag: String

    public init(service: String = "CabinDirect.TeslaBLE", accessGroup: String?, tag: String) {
        self.service = service; self.accessGroup = accessGroup; self.tag = tag
    }
    private var query: [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: tag,
                                    kSecAttrSynchronizable as String: false]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
    public func hasKey() throws -> Bool { try load() != nil }

    // Internal: callers cannot export the private scalar through the public API.
    func load() throws -> P256.KeyAgreement.PrivateKey? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw TeslaProtocolError.keychain(status) }
        guard let data = result as? Data, data.count == 32 else { throw TeslaProtocolError.authentication }
        return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
    }
    // Only called from enrollMonitorKeyExplicitly() after the client's capability gate.
    func createForExplicitEnrollmentIfMissing() throws -> P256.KeyAgreement.PrivateKey {
        if let existing = try load() { return existing }
        let generated = P256.KeyAgreement.PrivateKey()
        var add = query
        add[kSecValueData as String] = generated.rawRepresentation
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem, let existing = try load() { return existing }
        guard status == errSecSuccess else { throw TeslaProtocolError.keychain(status) }
        return generated
    }
}
