// Bilingual string table (vi default, en) — ported from the WES UI format.
import { useCallback, useState } from 'react';

export type Lang = 'vi' | 'en';

type Entry = Record<Lang, string>;

export const I18N: Record<string, Entry> = {
  // shell / nav
  app_name: { vi: 'WES Console', en: 'WES Console' },
  app_sub: { vi: 'Warehouse Execution', en: 'Warehouse Execution' },
  nav_fleet: { vi: 'Đội AGV', en: 'AGV Fleet' },
  nav_map: { vi: 'Bản đồ & Topology', en: 'Map & Topology' },
  nav_requests: { vi: 'Yêu cầu vận chuyển', en: 'Transport Requests' },
  nav_dispatch: { vi: 'Điều phối', en: 'Dispatch' },
  nav_dashboard: { vi: 'Dashboard', en: 'Dashboard' },
  nav_users: { vi: 'Người dùng & Quyền', en: 'Users & Access' },
  nav_audit: { vi: 'Nhật ký', en: 'Event Log' },
  nav_section_ops: { vi: 'Vận hành', en: 'Operations' },
  nav_section_admin: { vi: 'Quản trị', en: 'Administration' },
  nav_org: { vi: 'WES · KHO HÀNG', en: 'WES · WAREHOUSE' },
  nav_settings: { vi: 'Cài đặt', en: 'Settings' },
  nav_docs: { vi: 'Tài liệu', en: 'Documentation' },

  // access tags + table extras
  all_users: { vi: 'Tất cả người dùng', en: 'All users' },
  filters: { vi: 'Bộ lọc', en: 'Filters' },
  filters_clear: { vi: 'Xóa lọc', en: 'Clear' },
  acc_admin: { vi: 'Admin', en: 'Admin' },
  acc_config: { vi: 'Cấu hình', en: 'Config' },
  acc_dispatch: { vi: 'Điều phối', en: 'Dispatch' },
  acc_requests: { vi: 'Tạo lệnh', en: 'Requests' },
  acc_monitor: { vi: 'Giám sát', en: 'Monitor' },
  col_access: { vi: 'Quyền truy cập', en: 'Access' },
  col_dateadded: { vi: 'Ngày tạo', en: 'Date added' },
  view_profile: { vi: 'Xem hồ sơ', en: 'View profile' },
  page_prev: { vi: 'Trước', en: 'Previous' },
  page_next: { vi: 'Sau', en: 'Next' },

  // users screen
  users_title: { vi: 'Người dùng & Phân quyền', en: 'Users & Access' },
  users_desc: {
    vi: 'Quản lý tài khoản, vai trò và quyền truy cập của hệ thống WES.',
    en: 'Manage accounts, roles and access for the WES system.',
  },
  add_user: { vi: 'Thêm người dùng', en: 'Add user' },
  search_ph: { vi: 'Tìm theo tên, username, email…', en: 'Search name, username, email…' },
  filter_role: { vi: 'Vai trò', en: 'Role' },
  filter_status: { vi: 'Trạng thái', en: 'Status' },
  all: { vi: 'Tất cả', en: 'All' },
  view_table: { vi: 'Bảng', en: 'Table' },
  view_cards: { vi: 'Thẻ', en: 'Cards' },
  view_compact: { vi: 'Gọn', en: 'Compact' },

  // table headers
  col_user: { vi: 'Người dùng', en: 'User' },
  col_role: { vi: 'Vai trò', en: 'Role' },
  col_status: { vi: 'Trạng thái', en: 'Status' },
  col_lastactive: { vi: 'Hoạt động cuối', en: 'Last active' },
  col_created: { vi: 'Ngày tạo', en: 'Created' },
  col_actions: { vi: '', en: '' },

  // roles
  role_admin: { vi: 'Admin', en: 'Admin' },
  role_operator: { vi: 'Operator', en: 'Operator' },
  role_admin_desc: {
    vi: 'Cấu hình & quản trị toàn hệ thống: đội AGV, bản đồ, rule điều phối, người dùng.',
    en: 'Full configuration & administration: fleet, map, dispatch rules, users.',
  },
  role_operator_desc: {
    vi: 'Vận hành tại hiện trường: quét mã tạo yêu cầu, theo dõi trạng thái cơ bản.',
    en: 'Field operation: scan to create requests, monitor basic status.',
  },

  // status
  st_active: { vi: 'Đang hoạt động', en: 'Active' },
  st_locked: { vi: 'Đã khóa', en: 'Locked' },
  st_invited: { vi: 'Chờ kích hoạt', en: 'Invited' },
  st_inactive: { vi: 'Ngừng hoạt động', en: 'Inactive' },

  // row / detail actions
  act_view: { vi: 'Xem chi tiết', en: 'View details' },
  act_edit: { vi: 'Chỉnh sửa', en: 'Edit' },
  act_roles: { vi: 'Vai trò & quyền', en: 'Roles & access' },
  act_reset: { vi: 'Đặt lại mật khẩu', en: 'Reset password' },
  act_lock: { vi: 'Khóa tài khoản', en: 'Lock account' },
  act_unlock: { vi: 'Mở khóa', en: 'Unlock' },
  act_delete: { vi: 'Xóa tài khoản', en: 'Delete account' },

  // bulk
  bulk_selected: { vi: 'đã chọn', en: 'selected' },
  bulk_lock: { vi: 'Khóa', en: 'Lock' },
  bulk_unlock: { vi: 'Mở khóa', en: 'Unlock' },
  bulk_delete: { vi: 'Xóa', en: 'Delete' },
  bulk_clear: { vi: 'Bỏ chọn', en: 'Clear' },
  showing: { vi: 'Hiển thị', en: 'Showing' },
  of: { vi: 'trên', en: 'of' },
  users_lc: { vi: 'người dùng', en: 'users' },
  no_results: { vi: 'Không tìm thấy người dùng phù hợp.', en: 'No matching users found.' },
  no_results_hint: { vi: 'Thử đổi từ khóa hoặc bỏ bớt bộ lọc.', en: 'Try a different keyword or clear filters.' },

  // detail drawer
  detail_account: { vi: 'Tài khoản', en: 'Account' },
  detail_overview: { vi: 'Tổng quan', en: 'Overview' },
  detail_perms: { vi: 'Quyền truy cập', en: 'Permissions' },
  detail_activity: { vi: 'Lịch sử thao tác', en: 'Activity' },
  field_username: { vi: 'Tên đăng nhập', en: 'Username' },
  field_email: { vi: 'Email', en: 'Email' },
  field_phone: { vi: 'Điện thoại', en: 'Phone' },
  field_shift: { vi: 'Ca làm', en: 'Shift' },
  field_created: { vi: 'Ngày tạo', en: 'Created' },
  field_lastlogin: { vi: 'Đăng nhập cuối', en: 'Last login' },
  field_mfa: { vi: 'Xác thực 2 lớp', en: 'Two-factor' },
  mfa_on: { vi: 'Đã bật', en: 'Enabled' },
  mfa_off: { vi: 'Chưa bật', en: 'Disabled' },
  danger_zone: { vi: 'Vùng nguy hiểm', en: 'Danger zone' },
  perm_allowed: { vi: 'Được phép', en: 'Allowed' },
  perm_denied: { vi: 'Không có quyền', en: 'No access' },

  // permission groups
  pg_fleet: { vi: 'Quản lý đội AGV', en: 'AGV fleet management' },
  pg_map: { vi: 'Bản đồ & topology', en: 'Map & topology' },
  pg_requests: { vi: 'Yêu cầu vận chuyển', en: 'Transport requests' },
  pg_dispatch: { vi: 'Rule điều phối', en: 'Dispatch rules' },
  pg_dashboard: { vi: 'Dashboard giám sát', en: 'Monitoring dashboard' },
  pg_users: { vi: 'Quản lý người dùng', en: 'User management' },
  pg_audit: { vi: 'Nhật ký & audit', en: 'Event log & audit' },

  // create / edit modal
  create_title: { vi: 'Thêm người dùng mới', en: 'Add new user' },
  edit_title: { vi: 'Chỉnh sửa người dùng', en: 'Edit user' },
  field_fullname: { vi: 'Họ và tên', en: 'Full name' },
  field_role: { vi: 'Vai trò', en: 'Role' },
  field_status: { vi: 'Trạng thái', en: 'Status' },
  ph_fullname: { vi: 'VD: Nguyễn Văn An', en: 'e.g. Nguyen Van An' },
  ph_username: { vi: 'VD: an.nguyen', en: 'e.g. an.nguyen' },
  ph_email: { vi: 'VD: an.nguyen@wes.vn', en: 'e.g. an.nguyen@wes.vn' },
  ph_phone: { vi: 'VD: 09xx xxx xxx', en: 'e.g. 09xx xxx xxx' },
  send_invite: { vi: 'Gửi email mời kích hoạt tài khoản', en: 'Send activation invite email' },
  cancel: { vi: 'Hủy', en: 'Cancel' },
  save: { vi: 'Lưu thay đổi', en: 'Save changes' },
  create_btn: { vi: 'Tạo người dùng', en: 'Create user' },

  // validation
  err_required: { vi: 'Trường này là bắt buộc.', en: 'This field is required.' },
  err_email: { vi: 'Email không hợp lệ.', en: 'Invalid email address.' },
  err_username: {
    vi: 'Chỉ gồm chữ thường, số, dấu chấm và gạch dưới.',
    en: 'Lowercase letters, numbers, dot and underscore only.',
  },
  err_username_taken: { vi: 'Tên đăng nhập đã tồn tại.', en: 'Username already taken.' },
  err_email_taken: { vi: 'Email đã được sử dụng.', en: 'Email already in use.' },

  // reset password
  reset_title: { vi: 'Đặt lại mật khẩu', en: 'Reset password' },
  reset_for: { vi: 'cho', en: 'for' },
  reset_method: { vi: 'Phương thức', en: 'Method' },
  reset_link: { vi: 'Gửi link đặt lại qua email', en: 'Send reset link by email' },
  reset_link_desc: {
    vi: 'Người dùng nhận email và tự đặt mật khẩu mới.',
    en: 'User receives an email and sets their own new password.',
  },
  reset_temp: { vi: 'Tạo mật khẩu tạm thời', en: 'Generate temporary password' },
  reset_temp_desc: {
    vi: 'Hệ thống tạo mật khẩu tạm, yêu cầu đổi ở lần đăng nhập đầu.',
    en: 'System creates a temp password, forced change on first login.',
  },
  reset_temp_pwd: { vi: 'Mật khẩu tạm', en: 'Temporary password' },
  reset_copy: { vi: 'Sao chép', en: 'Copy' },
  reset_copied: { vi: 'Đã sao chép', en: 'Copied' },
  reset_regenerate: { vi: 'Tạo lại', en: 'Regenerate' },
  reset_confirm: { vi: 'Xác nhận đặt lại', en: 'Confirm reset' },
  force_change: {
    vi: 'Buộc đổi mật khẩu ở lần đăng nhập tiếp theo',
    en: 'Force change on next login',
  },

  // lock / unlock
  lock_title: { vi: 'Khóa tài khoản', en: 'Lock account' },
  unlock_title: { vi: 'Mở khóa tài khoản', en: 'Unlock account' },
  lock_warn: {
    vi: 'Người dùng sẽ bị đăng xuất và không thể đăng nhập cho đến khi được mở khóa.',
    en: 'The user will be signed out and cannot log in until unlocked.',
  },
  unlock_warn: {
    vi: 'Người dùng có thể đăng nhập lại bình thường.',
    en: 'The user will be able to sign in again.',
  },
  lock_reason: { vi: 'Lý do khóa (tùy chọn)', en: 'Reason (optional)' },
  lock_reason_ph: {
    vi: 'VD: Tạm ngưng theo yêu cầu giám sát ca',
    en: 'e.g. Suspended per shift supervisor',
  },
  lock_confirm: { vi: 'Khóa tài khoản', en: 'Lock account' },
  unlock_confirm: { vi: 'Mở khóa', en: 'Unlock' },

  // delete
  delete_title: { vi: 'Xóa tài khoản người dùng', en: 'Delete user account' },
  delete_warn: {
    vi: 'Hành động này không thể hoàn tác. Tài khoản và quyền truy cập sẽ bị xóa vĩnh viễn. Nhật ký thao tác vẫn được giữ lại để truy vết.',
    en: 'This action cannot be undone. The account and its access will be permanently removed. Audit logs are retained for traceability.',
  },
  delete_type: { vi: 'Nhập username để xác nhận:', en: 'Type the username to confirm:' },
  delete_confirm: { vi: 'Xóa vĩnh viễn', en: 'Delete permanently' },
  delete_mismatch: { vi: 'Username không khớp.', en: 'Username does not match.' },

  // roles modal
  roles_title: { vi: 'Vai trò & quyền truy cập', en: 'Roles & access' },
  roles_pick: { vi: 'Chọn vai trò', en: 'Assign role' },
  roles_note: {
    vi: 'Quyền được xác định theo vai trò. Operator và Admin là hai vai trò khả dụng trong giai đoạn hiện tại.',
    en: 'Permissions are derived from the role. Operator and Admin are the available roles in the current phase.',
  },

  // toasts
  toast_created: { vi: 'Đã tạo người dùng', en: 'User created' },
  toast_updated: { vi: 'Đã cập nhật người dùng', en: 'User updated' },
  toast_deleted: { vi: 'Đã xóa người dùng', en: 'User deleted' },
  toast_locked: { vi: 'Đã khóa tài khoản', en: 'Account locked' },
  toast_unlocked: { vi: 'Đã mở khóa tài khoản', en: 'Account unlocked' },
  toast_reset: { vi: 'Đã đặt lại mật khẩu', en: 'Password reset' },
  toast_role: { vi: 'Đã cập nhật vai trò', en: 'Role updated' },
  toast_undo: { vi: 'Hoàn tác', en: 'Undo' },

  // misc
  just_now: { vi: 'vừa xong', en: 'just now' },
  min_ago: { vi: 'phút trước', en: 'min ago' },
  hr_ago: { vi: 'giờ trước', en: 'h ago' },
  day_ago: { vi: 'ngày trước', en: 'd ago' },
  online: { vi: 'Trực tuyến', en: 'Online' },
};

export type TFunc = (key: string) => string;

/** Language state + translator. */
export function useI18n(initial: Lang = 'vi') {
  const [lang, setLang] = useState<Lang>(initial);
  const t = useCallback<TFunc>((key) => (I18N[key] ? I18N[key][lang] : key), [lang]);
  return { lang, setLang, t };
}
