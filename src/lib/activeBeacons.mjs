// In-memory active beacon positions (ephemeral — not persisted per ping)

const _activeBeacons = new Map();

const STALE_MS = 5 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - STALE_MS;
  for (const [key, b] of _activeBeacons) {
    if (b.lastSeen < cutoff) _activeBeacons.delete(key);
  }
}, 2 * 60 * 1000).unref?.();

export function touchActiveBeacon(beaconKey, data) {
  const prev = _activeBeacons.get(beaconKey) || {};
  _activeBeacons.set(beaconKey, {
    ...prev,
    ...data,
    lastSeen: Date.now(),
  });
}

export function clearActiveBeacon(beaconKey) {
  _activeBeacons.delete(beaconKey);
}

export function hasActiveBeacon(beaconKey) {
  return _activeBeacons.has(beaconKey);
}

export function getActiveBeaconForUser(userId) {
  const uid = String(userId);
  for (const b of _activeBeacons.values()) {
    if (String(b.userId) === uid) return b;
  }
  return null;
}

export function getActiveBeaconForWorkOrder(workOrderId) {
  const woId = String(workOrderId);
  for (const b of _activeBeacons.values()) {
    if (b.workOrderId && String(b.workOrderId) === woId) return b;
  }
  return null;
}
