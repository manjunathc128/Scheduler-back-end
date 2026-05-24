import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_sessions')
@Index(['userId', 'device'])
@Index(['refreshTokenHash'])
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar' })
  refreshTokenHash: string;

  @Column({ type: 'varchar', default: 'default' })
  device: string;

  @Column({ type: 'timestamptz' })
  refreshTokenExpiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
