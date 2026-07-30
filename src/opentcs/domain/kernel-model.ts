export interface KernelVehiclePrecisePosition {
  x: number;
  y: number;
  z: number;
}

export interface KernelVehicleState {
  name: string;
  state:
    | 'UNKNOWN'
    | 'UNAVAILABLE'
    | 'ERROR'
    | 'IDLE'
    | 'EXECUTING'
    | 'CHARGING';
  procState: 'UNAVAILABLE' | 'IDLE' | 'AWAITING_ORDER' | 'PROCESSING_ORDER';
  integrationLevel:
    | 'TO_BE_IGNORED'
    | 'TO_BE_NOTICED'
    | 'TO_BE_RESPECTED'
    | 'TO_BE_UTILIZED';
  energyLevel: number;
  paused: boolean;
  currentPosition: string | null;
  precisePosition?: KernelVehiclePrecisePosition | null;
  orientationAngle?: number | null;
  allocatedResources?: string[][];
  transportOrder?: string | null;
  properties?: Record<string, string>;
  observedAt?: string;
}

export interface KernelLocationType {
  name: string;
  allowedOperations: string[];
}

export interface KernelLocationLink {
  pointName?: string;
  point?: string;
}

export interface KernelLocation {
  name: string;
  typeName?: string;
  type?: string;
  links?: KernelLocationLink[] | Record<string, unknown>;
}

export interface KernelPointPosition {
  x: number;
  y: number;
}

export interface KernelPoint {
  name: string;
  type: string;
  position: KernelPointPosition;
  parkingPriority: number | null;
}

export interface KernelPath {
  srcPointName: string;
  destPointName: string;
  length: number;
  maxVelocity: number;
  maxReverseVelocity: number;
  locked: boolean;
}

export interface KernelPlantModel {
  points: KernelPoint[];
  paths: KernelPath[];
  locationTypes: KernelLocationType[];
  locations: KernelLocation[];
}

export interface KernelParkingPoint {
  name: string;
  priority: number | null;
}

export interface KernelChargeLocation {
  name: string;
  points: string[];
}

export interface KernelTransportOrder {
  name: string;
  state: string;
  intendedVehicle: string | null;
  processingVehicle: string | null;
  destinations: string[];
}

export interface KernelTransportOrderSummary {
  name: string;
  state: string;
  destinations: string[];
}

export interface KernelTransportOrderDebug {
  name?: string;
  state?: string;
  intendedVehicle?: string;
  processingVehicle?: string;
  destinations?: unknown;
}

export interface KernelRoute {
  destinationPoint: string;
  costs: number;
  steps: unknown[] | null;
}

export interface CreateTransportOrderOptions {
  dispensable?: boolean;
}

export interface TransportOrderDestinationResponse {
  locationName: string;
  operation: string;
}

export interface TransportOrderResponse {
  name: string;
  state: string;
  intendedVehicle: string | null;
  processingVehicle: string | null;
  destinations: TransportOrderDestinationResponse[];
}
