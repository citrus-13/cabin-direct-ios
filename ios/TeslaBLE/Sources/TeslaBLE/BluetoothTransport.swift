// Reduced, changed Swift adaptation of Tesla vehicle-command BLE transport (Apache-2.0).
// Source attribution and changes: ../../PROVENANCE.md; license: ../../LICENSE-TESLA.
import Foundation
#if canImport(CoreBluetooth)
import CoreBluetooth

// Compiles on macOS for API/type checks, but the public client starts it only on iOS.
// No CBCentralManager is created until an explicitly called startReading/enrollment path.
final class TeslaBluetoothTransport: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let service = CBUUID(string: "00000211-b2d1-43f0-9b88-960cebf8b91e")
    static let write = CBUUID(string: "00000212-b2d1-43f0-9b88-960cebf8b91e")
    static let notify = CBUUID(string: "00000213-b2d1-43f0-9b88-960cebf8b91e")
    private let queue: DispatchQueue
    private let expectedName: String
    private let ready: () -> Void
    private let received: (Data) -> Void
    private let failed: (Error) -> Void
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var writeCharacteristic: CBCharacteristic?
    private var readCharacteristic: CBCharacteristic?
    private var outgoing: [Data] = []
    private var sendCompleted: (() -> Void)?
    private var framer = BLEFramer()
    private var lastFragmentAt: Double?
    private var deadline: DispatchWorkItem?
    private var stopped = true
    private var subscribed = false
    var isSending: Bool { !outgoing.isEmpty }

    init(vin: String, queue: DispatchQueue, ready: @escaping () -> Void,
         received: @escaping (Data) -> Void, failed: @escaping (Error) -> Void) {
        expectedName = TeslaSession.advertisementName(vin: vin); self.queue = queue
        self.ready = ready; self.received = received; self.failed = failed
    }
    func start() {
        guard stopped else { return }
        stopped = false
        armDeadline(seconds: 20)
        central = CBCentralManager(delegate: self, queue: queue,
                                    options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }
    func stop() {
        stopped = true; subscribed = false
        deadline?.cancel(); deadline = nil
        central?.stopScan()
        if let peripheral { central?.cancelPeripheralConnection(peripheral); peripheral.delegate = nil }
        central?.delegate = nil; central = nil; peripheral = nil
        writeCharacteristic = nil; readCharacteristic = nil
        outgoing.removeAll(); sendCompleted = nil; framer.reset(); lastFragmentAt = nil
    }
    private func fail(_ error: Error = TeslaProtocolError.transport) {
        guard !stopped else { return }
        stop(); failed(error)
    }
    private func armDeadline(seconds: Double) {
        deadline?.cancel()
        let task = DispatchWorkItem { [weak self] in self?.fail(TeslaProtocolError.expired) }
        deadline = task
        queue.asyncAfter(deadline: .now() + seconds, execute: task)
    }
    func send(_ message: Data, completed: (() -> Void)? = nil) throws {
        guard !stopped, subscribed, let peripheral, let characteristic = writeCharacteristic,
              outgoing.isEmpty else { throw TeslaProtocolError.transport }
        outgoing = try BLEFramer.chunks(message, maximumWriteLength: peripheral.maximumWriteValueLength(for: .withResponse))
        sendCompleted = completed
        armDeadline(seconds: 5)
        peripheral.writeValue(outgoing[0], for: characteristic, type: .withResponse)
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard !stopped else { return }
        switch central.state {
        case .poweredOn:
            // Official SDK filters by local name; not every vehicle advertises its service UUID.
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        case .unknown, .resetting: break
        default: fail(TeslaProtocolError.unavailable)
        }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard !stopped, self.peripheral == nil,
              advertisementData[CBAdvertisementDataLocalNameKey] as? String == expectedName else { return }
        central.stopScan(); self.peripheral = peripheral; peripheral.delegate = self
        central.connect(peripheral, options: nil)
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard !stopped, self.peripheral === peripheral else { return }
        peripheral.discoverServices([Self.service])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { fail() }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) { fail() }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard !stopped else { return }
        guard error == nil, let services = peripheral.services,
              let service = services.first(where: { $0.uuid == Self.service }) else { fail(); return }
        peripheral.discoverCharacteristics([Self.write, Self.notify], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard !stopped else { return }
        guard error == nil, let characteristics = service.characteristics,
              let write = characteristics.first(where: { $0.uuid == Self.write }), write.properties.contains(.write),
              let read = characteristics.first(where: { $0.uuid == Self.notify }), read.properties.contains(.notify) else {
            fail(); return
        }
        writeCharacteristic = write; readCharacteristic = read
        peripheral.setNotifyValue(true, for: read)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard !stopped, characteristic.uuid == Self.notify else { return }
        guard error == nil, characteristic.isNotifying else { fail(); return }
        deadline?.cancel(); deadline = nil
        guard !subscribed else { return }
        subscribed = true; ready()
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard !stopped, characteristic.uuid == Self.write else { return }
        guard error == nil, !outgoing.isEmpty else { fail(); return }
        outgoing.removeFirst()
        if let next = outgoing.first {
            peripheral.writeValue(next, for: characteristic, type: .withResponse)
        } else {
            deadline?.cancel(); deadline = nil
            let done = sendCompleted; sendCompleted = nil; done?()
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard !stopped, characteristic.uuid == Self.notify else { return }
        guard error == nil, let fragment = characteristic.value else { fail(); return }
        let now = ProcessInfo.processInfo.systemUptime
        // Match the official one-second fragment timeout. A stale partial frame is discarded.
        if let last = lastFragmentAt, now - last > 1 { framer.reset() }
        lastFragmentAt = now
        do {
            for frame in try framer.receive(fragment) {
                guard !stopped else { return }
                received(frame)
            }
        } catch { fail(error) }
    }
}
#endif
