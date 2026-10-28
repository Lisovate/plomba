import type { Handover } from '@plomba/contracts';
import { formatWagonNumber } from '@plomba/core';
import type { Translate } from '../i18n/index.tsx';

/** "Wagon 21 81 2471 217-3" or "Truck GD 4T812", or null when not recorded. */
export function describeTransport(t: Translate, handover: Handover): string | null {
  if (!handover.transportMode) return null;
  const vehicle =
    handover.transportMode === 'rail' && handover.vehicleId
      ? formatWagonNumber(handover.vehicleId)
      : (handover.vehicleId ?? '');
  return t(handover.transportMode === 'rail' ? 'handover.rail' : 'handover.road', {
    vehicle,
  }).trim();
}
