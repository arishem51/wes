import type { CargoEntity } from './entities/cargo.entity';
import type { TransportTaskEntity } from './entities/transport-task.entity';
import type {
  DispatchMatcher,
  VehicleCandidate,
} from './domain/dispatch.policy';
import type { DispatchDistances } from './dispatch-distance.service';

export interface DispatchMeasurement {
  readonly matcher: DispatchMatcher;
  readonly batchSize: number;
  readonly altVehicleName: string | null;
  readonly altDistanceToSource: number | null;
  readonly approachDistance: number | null;
}

export interface DispatchContext {
  readonly task: TransportTaskEntity;
  readonly cargo: CargoEntity;
  readonly distanceByPoint: ReadonlyMap<string, number> | null;
  readonly approachDistance: number | null;
}

export interface DispatchSession {
  readonly tasks: readonly TransportTaskEntity[];
  readonly candidates: readonly VehicleCandidate[];
  readonly distances: DispatchDistances;
  readonly batteryWeight: number;
  readonly pending: Map<string, DispatchContext>;
  readonly quarantined: Set<string>;
  cursor: number;
}
