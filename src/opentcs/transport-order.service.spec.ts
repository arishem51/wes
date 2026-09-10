import { TransportOrderService } from './transport-order.service';
import { ORDER_KIND } from './domain/transport-order';

function makeService() {
  const kernelApi = {
    createTransportOrder: jest.fn().mockResolvedValue(undefined),
    withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new TransportOrderService(kernelApi as never),
    kernelApi,
  };
}

describe('TransportOrderService.issue', () => {
  it('names the order after the kind, the vehicle and where it is aimed', async () => {
    const { service, kernelApi } = makeService();

    const orderName = await service.issue({
      kind: ORDER_KIND.PICKUP,
      vehicleName: 'V1',
      aimedAt: 'LOC-1',
      destinations: [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
      taskId: 'task-1',
    });

    expect(orderName).toMatch(/^PICKUP-V1-LOC-1-/);
    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      orderName,
      [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
      'V1',
      { 'wes:taskId': 'task-1', 'wes:leg': 'PICKUP' },
      { dispensable: false },
    );
  });

  it('gives every order its own name, so a retry cannot collide with the order it replaces', async () => {
    const { service } = makeService();
    const order = {
      kind: ORDER_KIND.DROPOFF,
      vehicleName: 'V1',
      aimedAt: 'SLOT-1',
      destinations: [{ locationName: 'SLOT-1', operation: 'DROP_OFF' }],
      taskId: 'task-1',
    } as const;

    expect(await service.issue(order)).not.toBe(await service.issue(order));
  });

  it('stamps the leg from the kind, so a caller cannot mislabel the order', async () => {
    const { service, kernelApi } = makeService();

    await service.issue({
      kind: ORDER_KIND.APPROACH,
      vehicleName: 'V1',
      aimedAt: '0086',
      destinations: [{ locationName: '0086', operation: 'MOVE' }],
      taskId: 'task-1',
    });

    expect(kernelApi.createTransportOrder.mock.calls[0][3]).toEqual({
      'wes:taskId': 'task-1',
      'wes:leg': 'APPROACH',
    });
  });

  it('leaves the task id off a fleet order that belongs to no task', async () => {
    const { service, kernelApi } = makeService();

    await service.issue({
      kind: ORDER_KIND.PARK,
      vehicleName: 'V1',
      aimedAt: '1002',
      destinations: [{ locationName: '1002', operation: 'MOVE' }],
      dispensable: true,
    });

    expect(kernelApi.createTransportOrder.mock.calls[0][3]).toEqual({
      'wes:leg': 'PARK',
    });
  });

  it('marks a park order dispensable so the kernel may drop it for real work', async () => {
    const { service, kernelApi } = makeService();

    await service.issue({
      kind: ORDER_KIND.PARK,
      vehicleName: 'V1',
      aimedAt: '1002',
      destinations: [{ locationName: '1002', operation: 'MOVE' }],
      dispensable: true,
    });

    expect(kernelApi.createTransportOrder.mock.calls[0][4]).toEqual({
      dispensable: true,
    });
  });

  it('keeps the aimed-at name independent of the first destination, because a retreat leg can outlive the drop', async () => {
    const { service, kernelApi } = makeService();

    const orderName = await service.issue({
      kind: ORDER_KIND.DROPOFF,
      vehicleName: 'V1',
      aimedAt: 'SLOT-9',
      destinations: [{ locationName: 'RETREAT-2', operation: 'MOVE' }],
      taskId: 'task-1',
    });

    expect(orderName).toMatch(/^DROPOFF-V1-SLOT-9-/);
    expect(kernelApi.createTransportOrder.mock.calls[0][1]).toEqual([
      { locationName: 'RETREAT-2', operation: 'MOVE' },
    ]);
  });

  it('lets the kernel failure reach the caller, which decides what to do with the task', async () => {
    const { service, kernelApi } = makeService();
    kernelApi.createTransportOrder.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.issue({
        kind: ORDER_KIND.PICKUP,
        vehicleName: 'V1',
        aimedAt: 'LOC-1',
        destinations: [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
        taskId: 'task-1',
      }),
    ).rejects.toThrow('boom');
  });
});

describe('TransportOrderService.cancel', () => {
  it('withdraws without pre-empting the vehicle by default', async () => {
    const { service, kernelApi } = makeService();

    await service.cancel('PICKUP-V1-LOC-1');

    expect(kernelApi.withdrawTransportOrder).toHaveBeenCalledWith(
      'PICKUP-V1-LOC-1',
      false,
    );
  });

  it('withdraws immediately when the caller asks for it', async () => {
    const { service, kernelApi } = makeService();

    await service.cancel('PICKUP-V1-LOC-1', { immediate: true });

    expect(kernelApi.withdrawTransportOrder).toHaveBeenCalledWith(
      'PICKUP-V1-LOC-1',
      true,
    );
  });

  it('lets the kernel failure reach the caller', async () => {
    const { service, kernelApi } = makeService();
    kernelApi.withdrawTransportOrder.mockRejectedValueOnce(new Error('boom'));

    await expect(service.cancel('PICKUP-V1-LOC-1')).rejects.toThrow('boom');
  });
});
