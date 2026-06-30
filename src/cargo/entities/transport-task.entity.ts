import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TaskStatus {
  CREATED = 'CREATED',
  READY_TO_ASSIGN = 'READY_TO_ASSIGN',
  BLOCKED = 'BLOCKED',
  PICKING_UP = 'PICKING_UP',
  DELIVERING = 'DELIVERING',
  DELIVERY_COMPLETED = 'DELIVERY_COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export interface TaskMetadata {
  assignedVehicleName?: string;
  to1Name?: string;
  to2Name?: string;
  to3Name?: string;
  approachLocationName?: string;
  blockedReason?: string;
}

export const TASK_META = {
  ASSIGNED_VEHICLE_NAME: 'assignedVehicleName',
  TO1_NAME: 'to1Name',
  TO2_NAME: 'to2Name',
  TO3_NAME: 'to3Name',
  APPROACH_LOCATION_NAME: 'approachLocationName',
  BLOCKED_REASON: 'blockedReason',
} as const satisfies Record<string, keyof TaskMetadata>;

@Entity('transport_requests')
export class TransportTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'request_code', type: 'varchar', length: 50, unique: true })
  requestCode!: string;

  @Column({ name: 'cargo_id', type: 'uuid', nullable: true })
  cargoId!: string | null;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    enumName: 'transport_request_status_enum',
    default: TaskStatus.CREATED,
  })
  status!: TaskStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata!: TaskMetadata;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
