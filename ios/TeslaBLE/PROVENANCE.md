# Source provenance and third-party licensing

Primary source: Tesla's official `teslamotors/vehicle-command`, pinned to commit
[`0a582da430c4aca6d397fb6cbed5b4d6bb380125`](https://github.com/teslamotors/vehicle-command/tree/0a582da430c4aca6d397fb6cbed5b4d6bb380125).
No mutable `main` source is used as the implementation contract.

The upstream repository is Apache License 2.0. An unmodified copy of its actual
license is included as [LICENSE-TESLA](LICENSE-TESLA). The pinned tree has no
separate NOTICE file. Preserve this license and attribution with distributed
source/binaries containing the adapted protocol implementation/test vectors.
This notice does not invent a license or copyright assignment for the enclosing
project or unrelated newly authored files.

The Swift files are a changed, reduced implementation/adaptation: a strict
minimal wire codec replaces generated Go protobuf bindings; CryptoKit replaces
Go cryptographic APIs; only authenticated media reads and an explicitly gated
Vehicle Monitor enrollment request are exposed. No complete upstream source
file or generated protobuf binding is included. Public upstream keys/vectors
appear only in offline checks and must never be used as vehicle credentials.

## Source mapping

All links below refer to the same pinned commit.

- [Protocol specification](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protocol.md): BLE IDs/name/framing, ECDH KDF, metadata TLV,
  session authentication, encrypted command/response fields, request hashes,
  replay and synchronization rules, public worked vectors.
- [native.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/native.go),
  [peer.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/peer.go),
  [signer.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/signer.go),
  [metadata.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/metadata.go): Authentication.swift algorithms/field order.
- [protocol_doc_test.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/protocol_doc_test.go),
  [native_test.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/internal/authentication/native_test.go): exact AES-GCM fixture and leading-zero ECDH test.
  Additional negative/read-response tests here are original synthetic cases, not
  claimed upstream fixture outputs or real vehicle captures.
- [signatures.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/signatures.proto),
  [universal_message.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/universal_message.proto): envelopes, session/signature fields, counters, flags.
- [car_server.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/car_server.proto),
  [vehicle.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/vehicle.proto),
  [common.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/common.proto): read-only action nesting, optional media fields, playback enum and response status.
- [keys.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/keys.proto),
  [vcsec.proto](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/protocol/protobuf/vcsec.proto),
  [security.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/vehicle/security.go),
  [vcsec.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/vehicle/vcsec.go): monitor role 5, iOS form factor 6 and raw NFC-present-key enrollment envelope.
- [ble.go](https://github.com/teslamotors/vehicle-command/blob/0a582da430c4aca6d397fb6cbed5b4d6bb380125/pkg/connector/ble/ble.go): 1,024-byte message cap, characteristic UUIDs, framed writes and receive-fragment expiry.

## Schema fingerprints (SHA-256)

```text
f97c4427b954b0169f043116a21211d7b80b67caa03360d7c0deb7c31abbd73d signatures.proto
110ac4372e3ebdfe94191de857832302d75717fc105820b9f391dbc68e31979f universal_message.proto
c4c7815da826bb7b6139b5bc19ebecf927e216b44ed3cdee1e2a5b9923ca2dcb car_server.proto
dd9d05478495af3fa4810e57c80c4236dbe8e45ba3e051d8716f1a3fd3fad9a8 vehicle.proto
3825cd6a149880ef3d833e928c5efced93e62a98a788773cfc5a51bb7feaf323 vcsec.proto
1628c14e1779cd6cf6a87dcceb79f4f7152ec5067d402fbc4990c45b78241b80 keys.proto
```
