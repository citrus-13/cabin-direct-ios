// A narrow identity-free packaging policy for this project's fresh public build.
// It does not authorize capabilities, create profiles, or establish installability.
import { assertDeviceExecutable } from './preview-package.mjs';
export const PUBLIC_APP_ID = 'com.example.teslacompanion.direct';
export const APP_GROUP_KEY = 'com.apple.security.application-groups';

export function installerInputEntitlements(app, extension) {
  const extensionID = PUBLIC_APP_ID + '.broadcast', group = 'group.' + PUBLIC_APP_ID;
  const point = extension?.NSExtension;
  if (app?.CFBundleIdentifier !== PUBLIC_APP_ID || extension?.CFBundleIdentifier !== extensionID ||
    app?.CFBundleExecutable !== 'CabinDirect' || extension?.CFBundleExecutable !== 'DirectBroadcastExtension' ||
    app?.TCBroadcastExtensionIdentifier !== extensionID ||
    app?.TCAppGroupIdentifier !== group || extension?.TCAppGroupIdentifier !== group ||
    app?.TCInstallerIdentifierResolutionVersion !== 1 || extension?.TCInstallerIdentifierResolutionVersion !== 1 ||
    [app, extension].some(info => Object.hasOwn(info, 'ALTAppGroups') || Object.hasOwn(info, 'ALTBundleIdentifier')) ||
    point?.NSExtensionPointIdentifier !== 'com.apple.broadcast-services-upload' ||
    point?.RPBroadcastProcessMode !== 'RPBroadcastProcessModeSampleBuffer' ||
    point?.NSExtensionPrincipalClass !== 'DirectBroadcastExtension.DirectSampleHandler') {
    throw new Error('Only fresh public Cabin Direct products with the runtime resolver are supported');
  }
  return { [APP_GROUP_KEY]: [group] };
}

export function assertUnsignedInput(buffer) {
  assertDeviceExecutable(buffer);
  let offset = 32;
  for (let index = 0; index < buffer.readUInt32LE(16); index++) {
    if (buffer.readUInt32LE(offset) === 0x1d) throw new Error('Previously signed executable is not a fresh unsigned input');
    offset += buffer.readUInt32LE(offset + 4);
  }
}
