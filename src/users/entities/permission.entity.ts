import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A catalogue row mirroring one entry of `permission.catalogue.ts`. Upserted on boot;
 * never edited by users. Used by the role editor to render the checkbox matrix with labels.
 */
@Entity('permissions')
export class PermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'varchar', length: 32 })
  cluster!: string;

  @Column({ name: 'is_dangerous', default: false })
  isDangerous!: boolean;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @Column({ name: 'label_vi', type: 'varchar', length: 160, nullable: true })
  labelVi!: string | null;

  @Column({ name: 'label_en', type: 'varchar', length: 160, nullable: true })
  labelEn!: string | null;

  @Column({ name: 'label_ja', type: 'varchar', length: 160, nullable: true })
  labelJa!: string | null;
}
