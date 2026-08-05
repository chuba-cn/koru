import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainEventProcessor } from './domain-event.processor';

describe('DomainEventProcessor.process', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs the domain event id it received — no handler dispatch yet, but it must not lose the id silently', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const processor = new DomainEventProcessor();

    await processor.process({ data: { domainEventId: 'event-1' } } as never);

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('event-1'));
  });
});
