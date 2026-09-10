import {
  columnUpToMainline,
  standsWithoutAnOrder,
  vehicleParkedInColumn,
} from './column-occupancy';

describe('columnUpToMainline', () => {
  it('keeps walking behind the slots up to and including the first mainline point', () => {
    expect(
      columnUpToMainline(
        ['0521', '0516'],
        ['0511', '0532', '0549', '0005'],
        new Set(['0532', '0549', '0005']),
      ),
    ).toEqual(['0521', '0516', '0511', '0532']);
  });

  it('takes the whole chain when it never reaches a mainline', () => {
    expect(
      columnUpToMainline(['D1'], ['W1', 'W2'], new Set()),
    ).toEqual(['D1', 'W1', 'W2']);
  });
});

describe('standsWithoutAnOrder', () => {
  it.each([
    ['IDLE', undefined, true],
    ['AWAITING_ORDER', null, true],
    ['IDLE', 'PARK-V1-P1', false],
    ['PROCESSING_ORDER', 'DROPOFF-V1-D1', false],
    ['UNAVAILABLE', null, false],
  ])('%s with order %s → %s', (procState, transportOrder, expected) => {
    expect(
      standsWithoutAnOrder({
        name: 'V1',
        currentPosition: 'W1',
        procState: procState as string,
        transportOrder: transportOrder as string | null | undefined,
      }),
    ).toBe(expected);
  });
});

describe('vehicleParkedInColumn', () => {
  const column = new Set(['D1', 'W1']);

  it('finds an orderless vehicle standing anywhere in the column', () => {
    expect(
      vehicleParkedInColumn(
        [{ name: 'V9', currentPosition: 'W1', procState: 'IDLE' }],
        column,
        'V1',
      )?.name,
    ).toBe('V9');
  });

  it('skips the requester and vehicles outside the column', () => {
    expect(
      vehicleParkedInColumn(
        [
          { name: 'V1', currentPosition: 'W1', procState: 'IDLE' },
          { name: 'V8', currentPosition: 'S1', procState: 'IDLE' },
          { name: 'V7', currentPosition: null, procState: 'IDLE' },
        ],
        column,
        'V1',
      ),
    ).toBeNull();
  });
});
