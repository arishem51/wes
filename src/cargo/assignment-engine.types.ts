import type { CargoEntity } from './entities/cargo.entity';
import type { TransportTaskEntity } from './entities/transport-task.entity';
import type {
  DispatchMatcher,
  VehicleCandidate,
} from './domain/dispatch.policy';

export interface DispatchMeasurement {
  readonly matcher: DispatchMatcher;
  readonly batchSize: number;
  readonly altVehicleName: string | null;
  readonly altDistanceToSource: number | null;
  readonly approachDistance: number | null;
  readonly swapCount: number | null;
}

export interface DispatchContext {
  readonly task: TransportTaskEntity;
  readonly cargo: CargoEntity;
  readonly distanceByPoint: ReadonlyMap<string, number> | null;
  readonly approachDistance: number | null;
  readonly pinned: boolean;
}

export interface PlannedAction {
  readonly context: DispatchContext;
  readonly vehicle: VehicleCandidate;
  readonly distance: number | null;
}
