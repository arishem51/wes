import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ZoneMemberEntity } from './zone-member.entity';

export enum ZoneType {
  PICKUP = 'PICKUP',
  DROPOFF = 'DROPOFF',
}

export enum ZoneStatus {
  ACTIVE = 'ACTIVE',
  STALE = 'STALE',
}

@Entity('zones')
export class ZoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'enum', enum: ZoneType, enumName: 'zone_type_enum' })
  type!: ZoneType;

  /** Unique sequential ID used to name openTCS locations. NULL for PICKUP zones. */
  @Column({ name: 'kernel_id', type: 'integer', nullable: true, unique: true })
  kernelId!: number | null;

  @Column({
    name: 'approach_location_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  approachLocationName!: string | null;

  @Column({
    type: 'enum',
    enum: ZoneStatus,
    enumName: 'zone_status_enum',
    default: ZoneStatus.ACTIVE,
  })
  status!: ZoneStatus;

  @OneToMany(() => ZoneMemberEntity, (m) => m.zone, {
    cascade: true,
    eager: true,
  })
  members!: ZoneMemberEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
