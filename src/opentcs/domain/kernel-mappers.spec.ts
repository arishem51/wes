import {
  locationPointNames,
  orientationAngleFromSsePose,
  precisePositionFromSsePose,
  toAllocatedResources,
  toKernelPlantModel,
  toKernelTransportOrder,
  toKernelVehicleState,
  unusablePlantModelEntries,
  toTransportOrderDebugList,
} from './kernel-mappers';

describe('toKernelPlantModel', () => {
  it('rejects anything that is not an object', () => {
    expect(toKernelPlantModel(null)).toBeNull();
    expect(toKernelPlantModel('v7')).toBeNull();
  });

  it('yields empty collections when the kernel omits them', () => {
    expect(toKernelPlantModel({})).toEqual({
      points: [],
      paths: [],
      locationTypes: [],
      locations: [],
    });
  });

  it('reads parking priority from the REST array shape and the SSE map shape', () => {
    const model = toKernelPlantModel({
      points: [
        {
          name: '1001',
          type: 'PARK_POSITION',
          properties: [{ key: 'tcs:parkingPositionPriority', value: '3' }],
        },
        {
          name: '1002',
          type: 'PARK_POSITION',
          properties: { 'tcs:parkingPositionPriority': 5 },
        },
        { name: '1003', type: 'PARK_POSITION', properties: [] },
      ],
    });

    expect(model?.points.map((point) => point.parkingPriority)).toEqual([
      3,
      5,
      null,
    ]);
  });

  it('defaults a point position to the origin and keeps its name and type', () => {
    const model = toKernelPlantModel({ points: [{ name: '0047' }] });

    expect(model?.points).toEqual([
      {
        name: '0047',
        type: '',
        position: { x: 0, y: 0 },
        parkingPriority: null,
      },
    ]);
  });

  it('drops points with no name', () => {
    const model = toKernelPlantModel({ points: [{ type: 'PARK_POSITION' }] });

    expect(model?.points).toEqual([]);
  });

  it('drops paths missing an endpoint or a velocity — a router cannot use them', () => {
    const usable = {
      srcPointName: 'A',
      destPointName: 'B',
      maxVelocity: 1,
      maxReverseVelocity: 0,
    };
    const model = toKernelPlantModel({
      paths: [
        usable,
        { ...usable, destPointName: undefined },
        { ...usable, maxReverseVelocity: '0' },
      ],
    });

    expect(model?.paths).toEqual([
      {
        srcPointName: 'A',
        destPointName: 'B',
        length: 0,
        maxVelocity: 1,
        maxReverseVelocity: 0,
        locked: false,
      },
    ]);
  });

  it('carries path length and locked through', () => {
    const model = toKernelPlantModel({
      paths: [
        {
          srcPointName: 'A',
          destPointName: 'B',
          length: 950,
          maxVelocity: 1,
          maxReverseVelocity: 1,
          locked: true,
        },
      ],
    });

    expect(model?.paths[0]).toMatchObject({ length: 950, locked: true });
  });

  it('normalises location links from either shape and keeps the type key it was given', () => {
    const model = toKernelPlantModel({
      locations: [
        { name: 'L1', typeName: 'Pick up', links: [{ pointName: '3065' }] },
        { name: 'L2', type: 'Drop off', links: { '3066': [] } },
        { name: 'L3' },
      ],
    });

    expect(
      model?.locations.map((loc) => locationPointNames(loc.links)),
    ).toEqual([['3065'], ['3066'], []]);
    expect(model?.locations[0].typeName).toBe('Pick up');
    expect(model?.locations[1].type).toBe('Drop off');
  });
});

describe('unusablePlantModelEntries', () => {
  it('reports nothing when every entry survived mapping', () => {
    const raw = { points: [{ name: 'P1' }] };

    expect(unusablePlantModelEntries(raw, toKernelPlantModel(raw)!)).toEqual(
      [],
    );
  });

  it('counts what the mapper dropped, per collection', () => {
    const raw = {
      points: [{ name: 'P1' }, {}],
      paths: [{}, {}],
      locations: [{ name: 'L1' }],
    };

    expect(unusablePlantModelEntries(raw, toKernelPlantModel(raw)!)).toEqual([
      '1 point(s)',
      '2 path(s)',
    ]);
  });
});

describe('toKernelVehicleState', () => {
  it('drops a payload with no vehicle name', () => {
    expect(toKernelVehicleState({ state: 'IDLE' })).toBeNull();
  });

  it('falls back to the safest value for every enum it does not recognise', () => {
    expect(
      toKernelVehicleState({
        name: 'V1',
        state: 'DANCING',
        procState: 'DANCING',
        integrationLevel: 'DANCING',
      }),
    ).toMatchObject({
      state: 'UNKNOWN',
      procState: 'UNAVAILABLE',
      integrationLevel: 'TO_BE_IGNORED',
      energyLevel: 0,
      paused: false,
      currentPosition: null,
      transportOrder: null,
    });
  });

  it('keeps pose and allocated resources when they are well formed', () => {
    expect(
      toKernelVehicleState({
        name: 'V1',
        state: 'CHARGING',
        energyLevel: 42,
        currentPosition: '1002',
        precisePosition: { x: 1, y: 2, z: 3 },
        orientationAngle: 90,
        allocatedResources: [['1002', 'path-1'], 'junk', [7]],
      }),
    ).toMatchObject({
      state: 'CHARGING',
      energyLevel: 42,
      currentPosition: '1002',
      precisePosition: { x: 1, y: 2, z: 3 },
      orientationAngle: 90,
      allocatedResources: [['1002', 'path-1'], []],
    });
  });

  it('nulls a precise position that is missing an axis', () => {
    expect(
      toKernelVehicleState({
        name: 'V1',
        precisePosition: { x: 1, y: 2 },
        orientationAngle: Number.NaN,
      }),
    ).toMatchObject({ precisePosition: null, orientationAngle: null });
  });
});

describe('SSE pose helpers', () => {
  it('reads the pose object openTCS wraps position and angle in', () => {
    const pose = { position: { x: 1, y: 2, z: 0 }, orientationAngle: 180 };

    expect(precisePositionFromSsePose(pose)).toEqual({ x: 1, y: 2, z: 0 });
    expect(orientationAngleFromSsePose(pose)).toBe(180);
  });

  it('reports null rather than guessing when the pose is absent', () => {
    expect(precisePositionFromSsePose(undefined)).toBeNull();
    expect(orientationAngleFromSsePose(undefined)).toBeNull();
  });

  it('keeps only string resources inside each allocation group', () => {
    expect(toAllocatedResources([['1002', 5, null], 'junk'])).toEqual([
      ['1002'],
    ]);
    expect(toAllocatedResources(undefined)).toEqual([]);
  });
});

describe('toKernelTransportOrder', () => {
  it('drops a payload with no order name', () => {
    expect(toKernelTransportOrder({ state: 'RAW' })).toBeNull();
  });

  it('flattens destinations to location names and defaults the rest', () => {
    expect(
      toKernelTransportOrder({
        name: 'ORDER-1',
        destinations: [{ locationName: 'LOC-1' }, { operation: 'MOVE' }],
      }),
    ).toEqual({
      name: 'ORDER-1',
      state: 'UNKNOWN',
      intendedVehicle: null,
      processingVehicle: null,
      destinations: ['LOC-1'],
    });
  });
});

describe('toTransportOrderDebugList', () => {
  it('keeps destinations raw so the debug endpoint shows what the kernel sent', () => {
    expect(
      toTransportOrderDebugList([
        { name: 'ORDER-1', destinations: [{ locationName: 'LOC-1' }] },
        'junk',
      ]),
    ).toEqual([
      {
        name: 'ORDER-1',
        state: undefined,
        intendedVehicle: undefined,
        processingVehicle: undefined,
        destinations: [{ locationName: 'LOC-1' }],
      },
    ]);
  });
});
