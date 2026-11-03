/**
 * Links into a Plomba installation for one handover, in the same shape as
 * the `links` of a webhook event. API answers carry ids, not links, so a
 * client builds them from the installation's address.
 */

export interface HandoverLinks {
  /** The handover in the app. */
  readonly app: string;
  /** The equipment interchange receipt (EIR), to print or save as PDF. */
  readonly receipt: string;
  /** The EDIFACT CODECO gate message (sealed handovers only). */
  readonly codeco: string;
  /** The container's history and damage passport. */
  readonly container: string;
}

export function handoverLinks(
  baseUrl: string,
  handover: { readonly id: string; readonly containerNumber: string },
): HandoverLinks {
  const base = baseUrl.replace(/\/+$/, '');
  const id = encodeURIComponent(handover.id);
  return {
    app: `${base}/handovers/${id}`,
    receipt: `${base}/handovers/${id}/report`,
    codeco: `${base}/api/handovers/${id}/codeco`,
    container: containerLink(base, handover.containerNumber),
  };
}

/** The container's history and damage passport in the app. */
export function containerLink(baseUrl: string, containerNumber: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/containers/${encodeURIComponent(containerNumber)}`;
}
