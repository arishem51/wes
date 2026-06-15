import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agvs')
export class AgvEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 100 })
  code!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ nullable: true, type: 'varchar' })
  model!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  manufacturer!: string | null;

  @Column({ name: 'serial_number', nullable: true, type: 'varchar' })
  serialNumber!: string | null;

  @Column({ name: 'is_dispatch_enabled', default: true })
  isDispatchEnabled!: boolean;

  @Column({ name: 'is_ignored', default: false })
  isIgnored!: boolean;

  @Column({ name: 'operational_battery_threshold', type: 'smallint', default: 20 })
  operationalBatteryThreshold!: number;

  @Column({ name: 'charging_battery_threshold', type: 'smallint', default: 10 })
  chargingBatteryThreshold!: number;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
}
