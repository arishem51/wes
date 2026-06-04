// Mock data + access helpers for FE-07 — ported from the WES UI format.
import { NOW } from '@/lib/format';
import type { ActivityEntry, PermGroup, PermLevel, Role, User } from '@/types/user';

// Permission matrix per role.
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

export type AccessTag = 'admin' | 'config' | 'dispatch' | 'requests' | 'monitor';
export const ACCESS_TONE: Record<AccessTag, 'green' | 'blue' | 'violet'> = {
  admin: 'green',
  config: 'blue',
  dispatch: 'violet',
  requests: 'blue',
  monitor: 'violet',
};
export const accessFor = (role: Role): AccessTag[] =>
  role === 'admin' ? ['admin', 'config', 'dispatch'] : ['requests', 'monitor'];

const mins = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();
const days = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

export const SEED_USERS: User[] = [
  { id: 'u-1001', name: 'Trần Minh Quân', username: 'quan.tran', email: 'quan.tran@wes.vn', role: 'admin', status: 'active', phone: '0901 234 567', shift: 'Hành chính', mfa: true, lastActive: mins(2), lastLogin: mins(2), created: days(420), online: true },
  { id: 'u-1002', name: 'Nguyễn Thị Hà', username: 'ha.nguyen', email: 'ha.nguyen@wes.vn', role: 'admin', status: 'active', phone: '0902 345 678', shift: 'Hành chính', mfa: true, lastActive: mins(28), lastLogin: mins(28), created: days(390), online: true },
  { id: 'u-1003', name: 'Lê Văn Dũng', username: 'dung.le', email: 'dung.le@wes.vn', role: 'operator', status: 'active', phone: '0903 456 789', shift: 'Ca A (06–14h)', mfa: false, lastActive: mins(6), lastLogin: mins(6), created: days(210), online: true },
  { id: 'u-1004', name: 'Phạm Thu Trang', username: 'trang.pham', email: 'trang.pham@wes.vn', role: 'operator', status: 'active', phone: '0904 567 890', shift: 'Ca A (06–14h)', mfa: false, lastActive: mins(41), lastLogin: mins(41), created: days(205), online: true },
  { id: 'u-1005', name: 'Hoàng Anh Tuấn', username: 'tuan.hoang', email: 'tuan.hoang@wes.vn', role: 'operator', status: 'locked', phone: '0905 678 901', shift: 'Ca B (14–22h)', mfa: false, lastActive: days(3), lastLogin: days(3), created: days(180), online: false, lockReason: 'Tạm ngưng theo yêu cầu giám sát ca' },
  { id: 'u-1006', name: 'Vũ Khánh Linh', username: 'linh.vu', email: 'linh.vu@wes.vn', role: 'operator', status: 'active', phone: '0906 789 012', shift: 'Ca B (14–22h)', mfa: false, lastActive: mins(120), lastLogin: mins(120), created: days(165), online: false },
  { id: 'u-1007', name: 'Đặng Quốc Bảo', username: 'bao.dang', email: 'bao.dang@wes.vn', role: 'operator', status: 'invited', phone: '0907 890 123', shift: 'Ca C (22–06h)', mfa: false, lastActive: null, lastLogin: null, created: days(2), online: false },
  { id: 'u-1008', name: 'Bùi Thị Mai', username: 'mai.bui', email: 'mai.bui@wes.vn', role: 'operator', status: 'active', phone: '0908 901 234', shift: 'Ca C (22–06h)', mfa: false, lastActive: mins(15), lastLogin: mins(15), created: days(150), online: true },
  { id: 'u-1009', name: 'Ngô Hải Đăng', username: 'dang.ngo', email: 'dang.ngo@wes.vn', role: 'operator', status: 'inactive', phone: '0909 012 345', shift: 'Ca A (06–14h)', mfa: false, lastActive: days(46), lastLogin: days(46), created: days(300), online: false },
  { id: 'u-1010', name: 'Dương Tố Như', username: 'nhu.duong', email: 'nhu.duong@wes.vn', role: 'admin', status: 'active', phone: '0910 123 456', shift: 'Hành chính', mfa: true, lastActive: mins(73), lastLogin: mins(73), created: days(360), online: false },
  { id: 'u-1011', name: 'Lý Gia Huy', username: 'huy.ly', email: 'huy.ly@wes.vn', role: 'operator', status: 'active', phone: '0911 234 567', shift: 'Ca B (14–22h)', mfa: false, lastActive: mins(9), lastLogin: mins(9), created: days(120), online: true },
  { id: 'u-1012', name: 'Cao Thanh Hằng', username: 'hang.cao', email: 'hang.cao@wes.vn', role: 'operator', status: 'locked', phone: '0912 345 678', shift: 'Ca C (22–06h)', mfa: false, lastActive: days(8), lastLogin: days(8), created: days(95), online: false, lockReason: 'Quá nhiều lần đăng nhập sai' },
  { id: 'u-1013', name: 'Đỗ Nhật Nam', username: 'nam.do', email: 'nam.do@wes.vn', role: 'operator', status: 'active', phone: '0913 456 789', shift: 'Ca A (06–14h)', mfa: false, lastActive: mins(52), lastLogin: mins(52), created: days(60), online: false },
  { id: 'u-1014', name: 'Trịnh Bảo Châu', username: 'chau.trinh', email: 'chau.trinh@wes.vn', role: 'operator', status: 'invited', phone: '0914 567 890', shift: 'Ca B (14–22h)', mfa: false, lastActive: null, lastLogin: null, created: days(1), online: false },
];

export const ACTIVITY: Record<'generic' | 'admin', ActivityEntry[]> = {
  generic: [
    { at: mins(6), action: 'login', text: { vi: 'Đăng nhập từ trạm vận hành OPS-03', en: 'Signed in from station OPS-03' } },
    { at: mins(48), action: 'request', text: { vi: 'Tạo yêu cầu vận chuyển TR-20451 (quét mã)', en: 'Created transport request TR-20451 (scan)' } },
    { at: mins(95), action: 'request', text: { vi: 'Tạo yêu cầu vận chuyển TR-20448', en: 'Created transport request TR-20448' } },
    { at: days(1), action: 'logout', text: { vi: 'Đăng xuất cuối ca', en: 'Signed out at end of shift' } },
    { at: days(2), action: 'login', text: { vi: 'Đăng nhập từ trạm vận hành OPS-01', en: 'Signed in from station OPS-01' } },
  ],
  admin: [
    { at: mins(12), action: 'config', text: { vi: 'Cập nhật rule điều phối: giới hạn AGV / block khu A', en: 'Updated dispatch rule: AGV cap per block, zone A' } },
    { at: mins(64), action: 'user', text: { vi: 'Gán vai trò Operator cho bao.dang', en: 'Assigned Operator role to bao.dang' } },
    { at: mins(140), action: 'fleet', text: { vi: 'Cấu hình ngưỡng pin sạc: 25%', en: 'Set charge threshold: 25%' } },
    { at: days(1), action: 'config', text: { vi: 'Thay thế bản đồ vận hành map-v7 → map-v8', en: 'Replaced operational map map-v7 → map-v8' } },
    { at: days(3), action: 'user', text: { vi: 'Khóa tài khoản tuan.hoang', en: 'Locked account tuan.hoang' } },
  ],
};

export const activityFor = (role: Role): ActivityEntry[] =>
  role === 'admin' ? ACTIVITY.admin : ACTIVITY.generic;
