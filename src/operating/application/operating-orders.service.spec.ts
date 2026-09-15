import { OperatingOrdersService } from './operating-orders.service';
import { KernelApiService } from '../../opentcs/kernel-api.service';

function rawOrder() {
  return {
    currentDriveOrderIndex: 0,
    currentRouteStepIndex: -1,
    driveOrders: [
      {
        route: {
          steps: [
            { routeIndex: 0, destinationPoint: 'P1' },
            { routeIndex: 1, destinationPoint: 'P2' },
          ],
        },
      },
    ],
  };
}

describe('OperatingOrdersService.routeProgress', () => {
  it('coalesces concurrent cache-misses for the same order into a single kernel call', async () => {
    let resolveKernelCall!: (value: unknown) => void;
    const kernelApi = {
      getTransportOrderRaw: jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveKernelCall = resolve;
        }),
      ),
    };
    const service = new OperatingOrdersService(
      kernelApi as unknown as KernelApiService,
    );

    const first = service.routeProgress('TO-1');
    const second = service.routeProgress('TO-1');
    const third = service.routeProgress('TO-1');
    resolveKernelCall(rawOrder());
    const [a, b, c] = await Promise.all([first, second, third]);

    expect(kernelApi.getTransportOrderRaw).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.percent).toBe(0);
    expect(a.points).toEqual(['P1', 'P2']);
  });

  it('calls the kernel again for a different order while one is in flight', async () => {
    const kernelApi = {
      getTransportOrderRaw: jest.fn().mockResolvedValue(rawOrder()),
    };
    const service = new OperatingOrdersService(
      kernelApi as unknown as KernelApiService,
    );

    await Promise.all([
      service.routeProgress('TO-1'),
      service.routeProgress('TO-2'),
    ]);

    expect(kernelApi.getTransportOrderRaw).toHaveBeenCalledTimes(2);
  });

  it('serves the second call from cache without hitting the kernel again', async () => {
    const kernelApi = {
      getTransportOrderRaw: jest.fn().mockResolvedValue(rawOrder()),
    };
    const service = new OperatingOrdersService(
      kernelApi as unknown as KernelApiService,
    );

    await service.routeProgress('TO-1');
    await service.routeProgress('TO-1');

    expect(kernelApi.getTransportOrderRaw).toHaveBeenCalledTimes(1);
  });
});

describe('OperatingOrdersService.changes$', () => {
  it('emits once per onOrderChanged() call, for any subscriber', async () => {
    const service = new OperatingOrdersService(
      {} as unknown as KernelApiService,
    );
    const received: void[] = [];
    const sub = service.changes$.subscribe((v) => received.push(v));

    service.onOrderChanged();
    service.onOrderChanged();
    sub.unsubscribe();

    expect(received).toHaveLength(2);
  });
});
