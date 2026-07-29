import axios from 'axios';
import { KernelApiService } from './kernel-api.service';

const CREATED = {
  data: { name: 'ORDER', state: 'RAW', destinations: [] },
};

const parkOrderName = (vehicle: string, point: string) =>
  `PARK-${vehicle}-${point}-0d4dd3a5-bfe5-4d90-8893-31ed8d12cae5`;

const order = (
  name: string,
  intendedVehicle: string,
  state: string,
  locationName: string,
) => ({
  name,
  intendedVehicle,
  state,
  destinations: [{ locationName, operation: 'MOVE' }],
});

const parkOrder = (vehicle: string, point: string, state: string) =>
  order(parkOrderName(vehicle, point), vehicle, state, point);

function spyOnPost(): jest.Mock {
  const post = jest.spyOn(axios, 'post') as unknown as jest.Mock;
  post.mockResolvedValue(CREATED);
  return post;
}

function spyOnGet(payload: unknown): jest.Mock {
  const get = jest.spyOn(axios, 'get') as unknown as jest.Mock;
  get.mockResolvedValue({ data: payload });
  return get;
}

function createdBody(post: jest.Mock): Record<string, unknown> {
  return post.mock.calls[0][1] as Record<string, unknown>;
}

describe('KernelApiService.createTransportOrder dispensable', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks the order dispensable when the caller asks for it', async () => {
    const post = spyOnPost();

    await new KernelApiService().createTransportOrder(
      parkOrderName('V1', '1002'),
      [{ locationName: '1002', operation: 'MOVE' }],
      'V1',
      { 'wes:leg': 'PARK' },
      { dispensable: true },
    );

    expect(createdBody(post).dispensable).toBe(true);
  });

  it('defaults to not dispensable for cargo, charge and approach orders', async () => {
    const post = spyOnPost();

    await new KernelApiService().createTransportOrder(
      'PICKUP-V1-LOC-1-uuid',
      [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
      'V1',
    );

    expect(createdBody(post).dispensable).toBe(false);
  });
});

describe('KernelApiService.getLiveParkOrders', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the whole fleet when no vehicle is given', async () => {
    const get = spyOnGet([]);

    await new KernelApiService().getLiveParkOrders();

    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('/v1/transportOrders'),
      expect.objectContaining({ params: undefined }),
    );
  });

  it('narrows the query to one vehicle when asked', async () => {
    const get = spyOnGet([]);

    await new KernelApiService().getLiveParkOrders('Vehicle-0003');

    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('/v1/transportOrders'),
      expect.objectContaining({
        params: { intendedVehicle: 'Vehicle-0003' },
      }),
    );
  });

  it('keeps only non-final park orders and tags each with its vehicle', async () => {
    spyOnGet([
      parkOrder('V1', '1002', 'RAW'),
      parkOrder('V2', '1006', 'DISPATCHABLE'),
      parkOrder('V1', '1003', 'FINISHED'),
      parkOrder('V1', '1004', 'FAILED'),
      parkOrder('V1', '1005', 'UNROUTABLE'),
      order('PICKUP-V1-LOC-1-uuid', 'V1', 'RAW', 'LOC-1'),
    ]);

    expect(await new KernelApiService().getLiveParkOrders()).toEqual([
      { name: parkOrderName('V1', '1002'), vehicle: 'V1', destination: '1002' },
      { name: parkOrderName('V2', '1006'), vehicle: 'V2', destination: '1006' },
    ]);
  });

  it('treats WITHDRAWN as still live', async () => {
    spyOnGet([parkOrder('V1', '1002', 'WITHDRAWN')]);

    expect(await new KernelApiService().getLiveParkOrders()).toEqual([
      { name: parkOrderName('V1', '1002'), vehicle: 'V1', destination: '1002' },
    ]);
  });

  it('falls back to the park point encoded in the name when destinations are unusable', async () => {
    spyOnGet([
      {
        name: parkOrderName('V1', '1002'),
        intendedVehicle: 'V1',
        state: 'DISPATCHABLE',
        destinations: [],
      },
    ]);

    expect(await new KernelApiService().getLiveParkOrders()).toEqual([
      { name: parkOrderName('V1', '1002'), vehicle: 'V1', destination: '1002' },
    ]);
  });

  it('throws instead of reporting "no claims" when the kernel call fails', async () => {
    const get = jest.spyOn(axios, 'get') as unknown as jest.Mock;
    get.mockRejectedValue(new Error('kernel down'));

    await expect(new KernelApiService().getLiveParkOrders()).rejects.toThrow(
      'kernel down',
    );
  });

  it('throws instead of reporting "no claims" on an unexpected payload', async () => {
    spyOnGet({ orders: [] });

    await expect(new KernelApiService().getLiveParkOrders()).rejects.toThrow(
      /Unexpected/,
    );
  });
});

describe('KernelApiService.getTransportOrderStateStrict', () => {
  afterEach(() => jest.restoreAllMocks());

  function rejectGet(err: unknown): void {
    const get = jest.spyOn(axios, 'get') as unknown as jest.Mock;
    get.mockRejectedValue(err);
  }

  it('returns the state the kernel reports', async () => {
    spyOnGet({ name: 'ORDER', state: 'DISPATCHABLE' });

    await expect(
      new KernelApiService().getTransportOrderStateStrict('ORDER'),
    ).resolves.toBe('DISPATCHABLE');
  });

  it('returns null only when the kernel says the order does not exist', async () => {
    rejectGet({ isAxiosError: true, response: { status: 404 } });

    await expect(
      new KernelApiService().getTransportOrderStateStrict('ORDER'),
    ).resolves.toBeNull();
  });

  it('throws when the kernel is unreachable, so a claim is never dropped on a blip', async () => {
    rejectGet(new Error('connect ECONNREFUSED'));

    await expect(
      new KernelApiService().getTransportOrderStateStrict('ORDER'),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on a server error rather than reporting the order as gone', async () => {
    rejectGet({ isAxiosError: true, response: { status: 500 } });

    await expect(
      new KernelApiService().getTransportOrderStateStrict('ORDER'),
    ).rejects.toBeDefined();
  });

  it('throws when a 200 carries no state', async () => {
    spyOnGet({ name: 'ORDER' });

    await expect(
      new KernelApiService().getTransportOrderStateStrict('ORDER'),
    ).rejects.toThrow(/no state/);
  });
});
