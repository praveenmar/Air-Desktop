export function trackSelectorPacket(packet) {
  if (!packet) return;

  if (!globalThis.__AIR_TELEMETRY__) {
    globalThis.__AIR_TELEMETRY__ = {
      packetCount: 0,
      candidateCount: 0,
      classCounts: {}
    };
  }

  const telemetry = globalThis.__AIR_TELEMETRY__;
  telemetry.packetCount += 1;

  if (Array.isArray(packet.candidates)) {
    telemetry.candidateCount += packet.candidates.length;

    for (const candidate of packet.candidates) {
      if (candidate && candidate.classId) {
        if (!telemetry.classCounts[candidate.classId]) {
          telemetry.classCounts[candidate.classId] = 0;
        }
        telemetry.classCounts[candidate.classId] += 1;
      }
    }
  }

  if (typeof window !== 'undefined' && window.__syncAirTelemetry) {
    window.__syncAirTelemetry(telemetry);
  }
}
