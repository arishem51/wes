import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('map_records')
export class MapRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ name: 'original_filename' })
  originalFilename!: string;

  @Column({ name: 'point_count', type: 'int', default: 0 })
  pointCount!: number;

  @Column({ name: 'path_count', type: 'int', default: 0 })
  pathCount!: number;

  @Column({ name: 'vehicle_count', type: 'int', default: 0 })
  vehicleCount!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;

  @Column({ name: 'uploaded_by_id', type: 'uuid', nullable: true })
  uploadedById!: string | null;
}
