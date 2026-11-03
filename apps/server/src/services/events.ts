/**
 * Handover events inside the server: the handover service publishes them,
 * and integrations (webhooks today) subscribe. Subscribers run after the
 * request that caused the event, and their failures never reach it.
 */

import type { WebhookEvent } from '@plomba/contracts';
import type { Logger } from 'pino';
import type { EventPublisher, HandoverEvent } from '../ports.ts';
import type { HandoverService } from './handovers.ts';

export class EventBus implements EventPublisher {
  readonly #subscribers: ((event: HandoverEvent) => Promise<void> | void)[] = [];
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  subscribe(subscriber: (event: HandoverEvent) => Promise<void> | void): void {
    this.#subscribers.push(subscriber);
  }

  publish(event: HandoverEvent): void {
    for (const subscriber of this.#subscribers) {
      queueMicrotask(() => {
        Promise.resolve()
          .then(() => subscriber(event))
          .catch((error: unknown) =>
            this.#logger.error({ err: error, event: event.type }, 'Event subscriber failed'),
          );
      });
    }
  }
}

/**
 * The webhook payload for an event: the handover as it is now, its marks,
 * and for a sealed handover the history of each damage it recorded, with
 * links to the app, the receipt, the CODECO message and the container.
 */
export async function describeHandoverEvent(
  handovers: HandoverService,
  event: HandoverEvent,
  options: { readonly id: string; readonly publicUrl: string },
): Promise<WebhookEvent> {
  const { handover, container, marks } = handovers.detail(event.handoverId);
  const recorded = new Set(marks.map((m) => m.id));
  const damage =
    event.type === 'handover.sealed'
      ? (await handovers.history(container.number)).damage.filter((d) =>
          d.trail.some((step) => recorded.has(step.markId)),
        )
      : [];
  const base = options.publicUrl.replace(/\/+$/, '');
  return {
    id: options.id,
    type: event.type,
    occurredAt: event.occurredAt,
    data: {
      handover,
      container,
      marks: marks.filter((m) => m.source !== 'rejected'),
      damage,
      links: {
        app: `${base}/handovers/${handover.id}`,
        receipt: `${base}/handovers/${handover.id}/report`,
        codeco: `${base}/api/handovers/${handover.id}/codeco`,
        container: `${base}/containers/${container.number}`,
      },
    },
  };
}
