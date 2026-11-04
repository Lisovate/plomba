import type { Handover } from '@plomba/contracts';
import { formatWagonNumber } from '@plomba/core';
import type { Translate } from '../i18n/index.tsx';

/** The truck's registration, or the wagon's number grouped as painted ("21 81 2471 217-3"). */
export function vehicleLabel(handover: Pick<Handover, 'transportMode' | 'vehicleId'>): string {
  if (!handover.vehicleId) return '';
  return handover.transportMode === 'rail'
    ? formatWagonNumber(handover.vehicleId)
    : handover.vehicleId;
}

/** "Wagon 21 81 2471 217-3" or "Truck GD 4T812", or null when not recorded. */
export function describeTransport(t: Translate, handover: Handover): string | null {
  if (!handover.transportMode) return null;
  return t(handover.transportMode === 'rail' ? 'handover.rail' : 'handover.road', {
    vehicle: vehicleLabel(handover),
  }).trim();
}
