import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('dispatch_policies')
export class DispatchPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ name: 'weight_urgency', type: 'double precision', default: 1.0 })
  weightUrgency!: number;

  @Column({ name: 'weight_proximity', type: 'double precision', default: 1.0 })
  weightProximity!: number;

  @Column({
    name: 'weight_inventory_position',
    type: 'double precision',
    default: 1.0,
  })
  weightInventoryPosition!: number;

  @Column({ name: 'weight_battery', type: 'double precision', default: 0 })
  weightBattery!: number;

  @Column({ name: 'max_agv_per_block', type: 'smallint', default: 1 })
  maxAgvPerBlock!: number;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
