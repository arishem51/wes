import { SEED_USERS } from '@/data/mock';
import { NOW } from '@/lib/format';
import type {
  CreateUserInput,
  ListUsersParams,
  Role,
  UpdateUserInput,
  User,
} from '@/types/user';

// In-memory dataset used when VITE_USE_MOCK=true.
let users: User[] = SEED_USERS.map((u) => ({ ...u }));

const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const mockUsersApi = {
  async list(params: ListUsersParams = {}): Promise<User[]> {
    await delay();
    const q = params.search?.trim().toLowerCase();
    return clone(
      users.filter((u) => {
        if (params.role && params.role !== 'all' && u.role !== params.role) return false;
        if (params.status && params.status !== 'all' && u.status !== params.status) return false;
        if (q) {
          const hay = `${u.name} ${u.username} ${u.email}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    );
  },

  async create(input: CreateUserInput): Promise<User> {
    await delay();
    const user: User = {
      id: 'u-' + Math.floor(2000 + Math.random() * 7000),
      name: input.name,
      username: input.username,
      email: input.email,
      phone: input.phone,
      shift: input.shift,
      role: input.role,
      status: input.sendInvite ? 'invited' : 'active',
      mfa: false,
      online: false,
      lastActive: null,
      lastLogin: null,
      created: NOW.toISOString(),
    };
    users = [user, ...users];
    return clone(user);
  },

  async update(id: string, input: UpdateUserInput): Promise<User> {
    await delay();
    users = users.map((u) => (u.id === id ? { ...u, ...input } : u));
    return clone(users.find((u) => u.id === id)!);
  },

  async remove(id: string): Promise<void> {
    await delay();
    users = users.filter((u) => u.id !== id);
  },

  async setRole(id: string, role: Role): Promise<User> {
    await delay();
    users = users.map((u) => (u.id === id ? { ...u, role } : u));
    return clone(users.find((u) => u.id === id)!);
  },

  async setLock(id: string, locking: boolean, reason?: string): Promise<User> {
    await delay();
    users = users.map((u) =>
      u.id === id
        ? { ...u, status: locking ? 'locked' : 'active', lockReason: locking ? reason ?? u.lockReason ?? null : null }
        : u,
    );
    return clone(users.find((u) => u.id === id)!);
  },

  async resetPassword(id: string): Promise<void> {
    await delay();
    if (!users.some((u) => u.id === id)) throw new Error('Không tìm thấy người dùng');
  },
};
