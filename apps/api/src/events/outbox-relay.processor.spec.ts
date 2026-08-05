import { describe, expect, it, vi } from 'vitest';
import { OutboxRelayProcessor } from './outbox-relay.processor';

function fakeTx(claimedRows: { id: string }[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(claimedRows),
    domainEvent: { updateMany: vi.fn().mockResolvedValue({ count: claimedRows.length }) },
  };
}

function makeProcessor(claimedRows: { id: string }[]) {
  const tx = fakeTx(claimedRows);
  const prisma = { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  const domainEventsQueue = { addBulk: vi.fn().mockResolvedValue(undefined) };
  const relayQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const processor = new OutboxRelayProcessor(
    prisma as never,
    domainEventsQueue as never,
    relayQueue as never,
  );
  return { processor, tx, prisma, domainEventsQueue, relayQueue };
}

describe('OutboxRelayProcessor.relay', () => {
  it('claims rows, enqueues one bulk call with jobId per row, then marks them published — in that order', async () => {
    const rows = [{ id: 'event-1' }, { id: 'event-2' }];
    const { processor, tx, domainEventsQueue } = makeProcessor(rows);
    const callOrder: string[] = [];
    domainEventsQueue.addBulk.mockImplementation(async () => {
      callOrder.push('enqueue');
    });
    tx.domainEvent.updateMany.mockImplementation(async () => {
      callOrder.push('mark');
      return { count: rows.length };
    });

    const claimed = await processor.relay();

    expect(claimed).toEqual(rows);
    expect(domainEventsQueue.addBulk).toHaveBeenCalledWith([
      { name: 'deliver', data: { domainEventId: 'event-1' }, opts: { jobId: 'event-1' } },
      { name: 'deliver', data: { domainEventId: 'event-2' }, opts: { jobId: 'event-2' } },
    ]);
    expect(tx.domainEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2'] } },
      data: { publishedAt: expect.any(Date) },
    });
    // Enqueue must happen before the mark — publish-then-mark, not the
    // reverse, is the whole safety argument for this design.
    expect(callOrder).toEqual(['enqueue', 'mark']);
  });

  it('does nothing — no enqueue, no update — when there is nothing unpublished', async () => {
    const { processor, tx, domainEventsQueue } = makeProcessor([]);

    const claimed = await processor.relay();

    expect(claimed).toEqual([]);
    expect(domainEventsQueue.addBulk).not.toHaveBeenCalled();
    expect(tx.domainEvent.updateMany).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayProcessor.process', () => {
  it('requeues an immediate extra tick when the claim batch comes back full (100 rows)', async () => {
    const fullBatch = Array.from({ length: 100 }, (_, i) => ({ id: `event-${i}` }));
    const { processor, relayQueue } = makeProcessor(fullBatch);

    await processor.process();

    expect(relayQueue.add).toHaveBeenCalledWith('tick', {});
  });

  it('does not requeue an extra tick when the batch is not full', async () => {
    const { processor, relayQueue } = makeProcessor([{ id: 'event-1' }]);

    await processor.process();

    expect(relayQueue.add).not.toHaveBeenCalled();
  });

  it('does not requeue when nothing was unpublished', async () => {
    const { processor, relayQueue } = makeProcessor([]);

    await processor.process();

    expect(relayQueue.add).not.toHaveBeenCalled();
  });
});
