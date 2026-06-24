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
  IN_FLIGHT = 'IN_FLIGHT',
  PICKUP_COMPLETED = 'PICKUP_COMPLETED',
  DELIVERY_COMPLETED = 'DELIVERY_COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export interface TaskMetadata {
  assignedVehicleName?: string;
  to1Name?: string;
  to2Name?: string;
}

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
