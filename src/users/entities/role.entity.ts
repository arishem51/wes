import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RoleName = 'ADMIN' | 'OPERATOR';

@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // DB column is `user_role_enum`; read/written as text (values: ADMIN | OPERATOR).
  @Column({ type: 'varchar' })
  name: RoleName;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
