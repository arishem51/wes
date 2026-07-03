import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Insert-only log of observed vehicle state changes (position / procState /
 * state / transport order), one row per change, batched by
 * FleetTelemetryService. Previous state is NOT stored: every metric over this
 * table is an interval metric, computed with LEAD()/LAG() partitioned by
 * (vehicle_name, session_id) so intervals never span an SSE reconnect gap.
 */
@Entity('vehicle_state_transitions')
export class VehicleStateTransitionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'session_id', type: 'bigint' })
  sessionId!: string;

  @Column({ name: 'vehicle_name', type: 'varchar', length: 50 })
  vehicleName!: string;

  /** Current point; null while between points or unknown. */
  @Column({ name: 'point_name', type: 'varchar', length: 50, nullable: true })
  pointName!: string | null;

  @Column({ name: 'proc_state', type: 'varchar', length: 30, nullable: true })
  procState!: string | null;

  @Column({ name: 'vehicle_state', type: 'varchar', length: 30, nullable: true })
  vehicleState!: string | null;

  @Column({ name: 'order_name', type: 'varchar', length: 80, nullable: true })
  orderName!: string | null;

  /** Kernel-side observation time when the SSE payload carries one, else ingest time. */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
