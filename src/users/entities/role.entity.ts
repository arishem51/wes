import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RoleName = 'ADMIN' | 'OPERATOR';

@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  name!: RoleName;

  @Column({ type: 'text', nullable: true })
  description!: string | null;
}
