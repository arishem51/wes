import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CargoStatus {
  ACTIVE = 'ACTIVE',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

@Entity('cargos')
export class CargoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'item_code', length: 255 })
  itemCode!: string;

  @Column({
    name: 'source_point_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  sourcePointName!: string | null;

  @Column({
    name: 'source_pickup_location_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  sourcePickupLocationName!: string | null;

  @Column({
    name: 'destination_location_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  destinationLocationName!: string | null;

  @Column({
    type: 'enum',
    enum: CargoStatus,
    enumName: 'cargo_status_enum',
    default: CargoStatus.ACTIVE,
  })
  status!: CargoStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
