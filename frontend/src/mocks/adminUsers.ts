import type {
  AdminListParams,
  AdminUser,
  CreateAdminUserInput,
  PermGroup,
  PermLevel,
  Role,
  UpdateAdminUserInput,
} from '@/types/adminUser';

const NOW = new Date('2026-06-04T09:12:00');
const mins = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();
const days = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

export const PERMISSIONS: Record<Role, Record<PermGroup, PermLevel>> = {
  admin: {
    pg_fleet: 'full',
    pg_map: 'full',
    pg_requests: 'full',
    pg_dispatch: 'full',
    pg_dashboard: 'full',
    pg_users: 'full',
    pg_audit: 'full',
  },
  operator: {
    pg_fleet: 'view',
    pg_map: 'view',
    pg_requests: 'full',
    pg_dispatch: 'none',
    pg_dashboard: 'view',
    pg_users: 'none',
    pg_audit: 'view',
  },
};

let users: AdminUser[] = [
  { id: 'u-1001', name: 'Trần Minh Quân', username: 'quan.tran', email: 'quan.tran@wes.vn', role: 'admin', status: 'active', phone: '0901 234 567', shift: 'Hành chính', mfa: true, online: true, lastActive: mins(2), created: days(420) },
  { id: 'u-1002', name: 'Nguyễn Thị Hà', username: 'ha.nguyen', email: 'ha.nguyen@wes.vn', role: 'admin', status: 'active', phone: '0902 345 678', shift: 'Hành chính', mfa: true, online: true, lastActive: mins(28), created: days(390) },
  { id: 'u-1003', name: 'Lê Văn Dũng', username: 'dung.le', email: 'dung.le@wes.vn', role: 'operator', status: 'active', phone: '0903 456 789', shift: 'Ca A (06–14h)', mfa: false, online: true, lastActive: mins(6), created: days(210) },
  { id: 'u-1004', name: 'Phạm Thu Trang', username: 'trang.pham', email: 'trang.pham@wes.vn', role: 'operator', status: 'active', phone: '0904 567 890', shift: 'Ca A (06–14h)', mfa: false, online: true, lastActive: mins(41), created: days(205) },
  { id: 'u-1005', name: 'Hoàng Anh Tuấn', username: 'tuan.hoang', email: 'tuan.hoang@wes.vn', role: 'operator', status: 'locked', phone: '0905 678 901', shift: 'Ca B (14–22h)', mfa: false, online: false, lastActive: days(3), created: days(180), lockReason: 'Tạm ngưng theo yêu cầu giám sát ca' },
  { id: 'u-1006', name: 'Vũ Khánh Linh', username: 'linh.vu', email: 'linh.vu@wes.vn', role: 'operator', status: 'active', phone: '0906 789 012', shift: 'Ca B (14–22h)', mfa: false, online: false, lastActive: mins(120), created: days(165) },
  { id: 'u-1007', name: 'Đặng Quốc Bảo', username: 'bao.dang', email: 'bao.dang@wes.vn', role: 'operator', status: 'invited', phone: '0907 890 123', shift: 'Ca C (22–06h)', mfa: false, online: false, lastActive: null, created: days(2) },
  { id: 'u-1008', name: 'Bùi Thị Mai', username: 'mai.bui', email: 'mai.bui@wes.vn', role: 'operator', status: 'active', phone: '0908 901 234', shift: 'Ca C (22–06h)', mfa: false, online: true, lastActive: mins(15), created: days(150) },
  { id: 'u-1009', name: 'Ngô Hải Đăng', username: 'dang.ngo', email: 'dang.ngo@wes.vn', role: 'operator', status: 'inactive', phone: '0909 012 345', shift: 'Ca A (06–14h)', mfa: false, online: false, lastActive: days(46), created: days(300) },
  { id: 'u-1010', name: 'Dương Tố Như', username: 'nhu.duong', email: 'nhu.duong@wes.vn', role: 'admin', status: 'active', phone: '0910 123 456', shift: 'Hành chính', mfa: true, online: false, lastActive: mins(73), created: days(360) },
  { id: 'u-1012', name: 'Cao Thanh Hằng', username: 'hang.cao', email: 'hang.cao@wes.vn', role: 'operator', status: 'locked', phone: '0912 345 678', shift: 'Ca C (22–06h)', mfa: false, online: false, lastActive: days(8), created: days(95), lockReason: 'Quá nhiều lần đăng nhập sai' },
];

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const mockAdminUsersApi = {
  async list(params: AdminListParams = {}): Promise<AdminUser[]> {
    await delay();
    const q = params.search?.trim().toLowerCase();
    return clone(
      users.filter((u) => {
        if (params.role && params.role !== 'all' && u.role !== params.role) return false;
        if (params.status && params.status !== 'all' && u.status !== params.status) return false;
        if (q && !`${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    );
  },
  async create(input: CreateAdminUserInput): Promise<AdminUser> {
    await delay();
    const user: AdminUser = {
      id: 'u-' + Math.floor(2000 + Math.random() * 7000),
      ...input,
      status: input.sendInvite ? 'invited' : 'active',
      mfa: false,
      online: false,
      lastActive: null,
      created: NOW.toISOString(),
    };
    users = [user, ...users];
    return clone(user);
  },
  async update(id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    await delay();
    users = users.map((u) => (u.id === id ? { ...u, ...input } : u));
    return clone(users.find((u) => u.id === id)!);
  },
  async remove(id: string): Promise<void> {
    await delay();
    users = users.filter((u) => u.id !== id);
  },
  async setRole(id: string, role: Role): Promise<AdminUser> {
    await delay();
    users = users.map((u) => (u.id === id ? { ...u, role } : u));
    return clone(users.find((u) => u.id === id)!);
  },
  async setLock(id: string, locking: boolean, reason?: string): Promise<AdminUser> {
    await delay();
    users = users.map((u) =>
      u.id === id ? { ...u, status: locking ? 'locked' : 'active', lockReason: locking ? reason ?? u.lockReason ?? null : null } : u,
    );
    return clone(users.find((u) => u.id === id)!);
  },
  async resetPassword(id: string): Promise<void> {
    await delay();
    if (!users.some((u) => u.id === id)) throw new Error('Không tìm thấy người dùng');
  },
};
