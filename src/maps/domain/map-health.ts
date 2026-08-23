import {
  ALIGNMENT_TOLERANCE_MM,
  alignPoints,
  type AxisShift,
} from '../../opentcs/domain/point-alignment';
import type {
  KernelLocation,
  KernelLocationType,
  KernelPath,
  KernelPoint,
} from '../../opentcs/domain/kernel-model';

export type MapHealthCode = 'MISALIGNED_POINT' | 'PARK_CAPACITY' | 'SINK_POINT';

export type MapHealthSeverity = 'ok' | 'warn';

export interface MapHealthFinding {
  readonly detail: string;
  readonly pointNames: readonly string[];
  readonly locationNames: readonly string[];
}

export interface MapHealthCheck {
  readonly code: MapHealthCode;
  readonly severity: MapHealthSeverity;
  readonly title: string;
  readonly summary: string;
  readonly findings: readonly MapHealthFinding[];
}

export interface MapHealthReport {
  readonly mapName: string | null;
  readonly toleranceMm: number;
  readonly counts: { readonly ok: number; readonly warn: number };
  readonly checks: readonly MapHealthCheck[];
}

export interface MapHealthInput {
  readonly mapName: string | null;
  readonly points: readonly KernelPoint[];
  readonly paths: readonly KernelPath[];
  readonly locations: readonly KernelLocation[];
  readonly locationTypes: readonly KernelLocationType[];
  readonly chargeOperation: string;
  readonly vehicleNames: readonly string[];
}

export function buildMapHealthReport(
  input: MapHealthInput,
  toleranceMm: number = ALIGNMENT_TOLERANCE_MM,
): MapHealthReport {
  const checks: MapHealthCheck[] = [
    misalignedPoints(input, toleranceMm),
    parkCapacity(input),
    sinkPoints(input),
  ];

  return {
    mapName: input.mapName,
    toleranceMm,
    counts: {
      ok: checks.filter((check) => check.severity === 'ok').length,
      warn: checks.filter((check) => check.severity === 'warn').length,
    },
    checks,
  };
}

function misalignedPoints(
  { points }: MapHealthInput,
  toleranceMm: number,
): MapHealthCheck {
  const { shifts } = alignPoints(points, toleranceMm);
  const drifted = new Set(shifts.flatMap((shift) => shift.pointNames));
  const worst = shifts.reduce(
    (largest, shift) => Math.max(largest, Math.abs(shift.to - shift.from)),
    0,
  );

  return check({
    code: 'MISALIGNED_POINT',
    title: 'Điểm lệch hàng/cột',
    okSummary: `Mọi điểm đều thẳng hàng và thẳng cột (dung sai ${toleranceMm}mm)`,
    warnSummary: `${drifted.size} điểm lệch khỏi hàng/cột, lệch nhiều nhất ${worst}mm — WES đã tự nắn về giá trị của số đông`,
    findings: shifts.map((shift) => ({
      detail: describeDrift(shift),
      pointNames: shift.pointNames,
      locationNames: [],
    })),
  });
}

function describeDrift(shift: AxisShift): string {
  const delta = shift.to - shift.from;
  return `${shift.axis} ${shift.from} → ${shift.to} (${delta > 0 ? '+' : ''}${delta}mm)`;
}

function parkCapacity(input: MapHealthInput): MapHealthCheck {
  const { points, vehicleNames } = input;
  const parkPointNames = points
    .filter((point) => point.type === 'PARK_POSITION')
    .map((point) => point.name)
    .sort();
  const chargeLocationNames = chargeLocationsOf(input);

  const fleet = vehicleNames.length;
  const parks = parkPointNames.length;
  const chargers = chargeLocationNames.length;
  const shortfall = fleet - parks;

  return check({
    code: 'PARK_CAPACITY',
    title: 'Sức chứa điểm đỗ & sạc',
    okSummary: `${parks} điểm đỗ + ${chargers} điểm sạc cho ${fleet} xe`,
    warnSummary: `Thiếu điểm đỗ cho ${shortfall} xe`,
    findings:
      shortfall > 0
        ? [
            {
              detail: `${fleet} xe / ${parks} điểm đỗ + ${chargers} điểm sạc`,
              pointNames: parkPointNames,
              locationNames: chargeLocationNames,
            },
          ]
        : [],
  });
}

function chargeLocationsOf({
  locations,
  locationTypes,
  chargeOperation,
}: MapHealthInput): string[] {
  const chargeTypeNames = new Set(
    locationTypes
      .filter((type) => type.allowedOperations.includes(chargeOperation))
      .map((type) => type.name),
  );
  return locations
    .filter((location) =>
      chargeTypeNames.has(location.typeName ?? location.type ?? ''),
    )
    .map((location) => location.name)
    .sort();
}

function sinkPoints({ points, paths }: MapHealthInput): MapHealthCheck {
  const wayOut = new Set<string>();
  const reachable = new Set<string>();
  for (const path of paths) {
    reachable.add(path.srcPointName);
    reachable.add(path.destPointName);
    if (path.maxVelocity > 0) wayOut.add(path.srcPointName);
    if (path.maxReverseVelocity > 0) wayOut.add(path.destPointName);
  }
  const sinks = points
    .filter((point) => reachable.has(point.name) && !wayOut.has(point.name))
    .map((point) => point.name)
    .sort();

  return check({
    code: 'SINK_POINT',
    title: 'Điểm cụt không lối ra',
    okSummary: 'Mọi điểm đều có đường ra, kể cả khi phải lùi',
    warnSummary: `${sinks.length} điểm vào được nhưng không ra được, kể cả lùi — xe tới đó là kẹt vĩnh viễn`,
    findings: sinks.map((name) => ({
      detail: `${name} không có path nào đi ra, kể cả chiều lùi`,
      pointNames: [name],
      locationNames: [],
    })),
  });
}

function check(spec: {
  code: MapHealthCode;
  title: string;
  okSummary: string;
  warnSummary: string;
  findings: readonly MapHealthFinding[];
}): MapHealthCheck {
  const clean = spec.findings.length === 0;
  return {
    code: spec.code,
    severity: clean ? 'ok' : 'warn',
    title: spec.title,
    summary: clean ? spec.okSummary : spec.warnSummary,
    findings: spec.findings,
  };
}
