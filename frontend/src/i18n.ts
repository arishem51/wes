// Bilingual strings for Account & Profile (UC-81 → UC-86).
import { useCallback, useState } from 'react';

export type Lang = 'vi' | 'en';
type Entry = Record<Lang, string>;

const LANG_KEY = 'wes-lang';

export const I18N: Record<string, Entry> = {
  brand: { vi: 'WES Console', en: 'WES Console' },
  brand_sub: { vi: 'Điều phối kho · AGV', en: 'Warehouse · AGV' },

  // login (UC-81)
  login_eyebrow: { vi: 'Truy cập hệ thống', en: 'System access' },
  login_title: { vi: 'Chào mừng trở lại', en: 'Welcome back' },
  login_lede: {
    vi: 'Đăng nhập để tiếp tục điều phối đội AGV và theo dõi vận hành kho.',
    en: 'Sign in to keep dispatching the AGV fleet and watching the floor.',
  },
  username: { vi: 'Tên đăng nhập', en: 'Username' },
  username_ph: { vi: 'vd: quan.tran', en: 'e.g. quan.tran' },
  password: { vi: 'Mật khẩu', en: 'Password' },
  password_ph: { vi: 'Nhập mật khẩu của bạn', en: 'Enter your password' },
  remember: { vi: 'Ghi nhớ đăng nhập', en: 'Remember me' },
  forgot_link: { vi: 'Quên mật khẩu?', en: 'Forgot password?' },
  sign_in: { vi: 'Đăng nhập', en: 'Sign in' },
  signing_in: { vi: 'Đang đăng nhập…', en: 'Signing in…' },
  login_help: { vi: 'Cần hỗ trợ? Liên hệ quản trị viên ca.', en: 'Need help? Contact your shift admin.' },
  err_login: { vi: 'Tên đăng nhập hoặc mật khẩu không đúng.', en: 'Incorrect username or password.' },
  hint_demo: { vi: 'Demo: nhập bất kỳ mật khẩu nào để vào.', en: 'Demo: type any password to enter.' },

  // forgot password (UC-86)
  forgot_eyebrow: { vi: 'Khôi phục truy cập', en: 'Recover access' },
  forgot_title: { vi: 'Đặt lại mật khẩu', en: 'Reset your password' },
  forgot_lede: {
    vi: 'Nhập email công việc, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.',
    en: "Enter your work email and we'll send a reset link.",
  },
  email: { vi: 'Email công việc', en: 'Work email' },
  email_ph: { vi: 'vd: ban@wes.vn', en: 'e.g. you@wes.vn' },
  send_link: { vi: 'Gửi liên kết đặt lại', en: 'Send reset link' },
  back_login: { vi: 'Quay lại đăng nhập', en: 'Back to sign in' },
  forgot_done_t: { vi: 'Đã gửi liên kết', en: 'Link sent' },
  forgot_done_b: {
    vi: 'Nếu email tồn tại trong hệ thống, bạn sẽ nhận được liên kết đặt lại trong giây lát.',
    en: "If that email exists, a reset link is on its way.",
  },
  resend: { vi: 'Gửi lại', en: 'Resend' },
  err_email: { vi: 'Email không hợp lệ.', en: 'Invalid email address.' },

  // app shell
  nav_account: { vi: 'Tài khoản', en: 'Account' },
  nav_dashboard: { vi: 'Bảng điều khiển', en: 'Dashboard' },
  nav_fleet: { vi: 'Đội AGV', en: 'Fleet' },
  greeting_m: { vi: 'Chào buổi sáng', en: 'Good morning' },

  // user menu (UC-82)
  menu_profile: { vi: 'Hồ sơ của tôi', en: 'My profile' },
  menu_security: { vi: 'Bảo mật', en: 'Security' },
  menu_signout: { vi: 'Đăng xuất', en: 'Sign out' },

  // account page
  acct_title: { vi: 'Tài khoản của tôi', en: 'My account' },
  acct_lede: {
    vi: 'Quản lý hồ sơ cá nhân, bảo mật và tùy chọn hiển thị.',
    en: 'Manage your profile, security and display preferences.',
  },
  tab_profile: { vi: 'Hồ sơ', en: 'Profile' },
  tab_security: { vi: 'Bảo mật', en: 'Security' },
  tab_prefs: { vi: 'Tùy chọn', en: 'Preferences' },

  // profile view/edit (UC-83 / UC-84)
  sec_profile: { vi: 'Thông tin cá nhân', en: 'Personal information' },
  sec_profile_d: {
    vi: 'Thông tin này hiển thị cho quản trị viên và trong nhật ký thao tác.',
    en: 'This appears to admins and in your activity log.',
  },
  field_fullname: { vi: 'Họ và tên', en: 'Full name' },
  field_email: { vi: 'Email', en: 'Email' },
  field_phone: { vi: 'Điện thoại', en: 'Phone' },
  field_shift: { vi: 'Ca làm / Bộ phận', en: 'Shift / Department' },
  field_role: { vi: 'Vai trò', en: 'Role' },
  field_lang: { vi: 'Ngôn ngữ giao diện', en: 'Interface language' },
  role_locked: { vi: 'Do quản trị viên cấp', en: 'Set by administrator' },
  edit: { vi: 'Chỉnh sửa', en: 'Edit' },
  save_changes: { vi: 'Lưu thay đổi', en: 'Save changes' },
  cancel: { vi: 'Hủy', en: 'Cancel' },
  change_photo: { vi: 'Đổi ảnh', en: 'Change photo' },
  remove_photo: { vi: 'Gỡ ảnh', en: 'Remove' },
  member_since: { vi: 'Thành viên từ', en: 'Member since' },
  role_admin: { vi: 'Quản trị viên', en: 'Administrator' },
  role_operator: { vi: 'Nhân viên vận hành', en: 'Operator' },

  // security / change password (UC-85)
  sec_password: { vi: 'Mật khẩu', en: 'Password' },
  sec_password_d: {
    vi: 'Đổi mật khẩu định kỳ để giữ tài khoản an toàn.',
    en: 'Change it regularly to keep your account safe.',
  },
  cur_password: { vi: 'Mật khẩu hiện tại', en: 'Current password' },
  new_password: { vi: 'Mật khẩu mới', en: 'New password' },
  confirm_password: { vi: 'Xác nhận mật khẩu mới', en: 'Confirm new password' },
  update_password: { vi: 'Cập nhật mật khẩu', en: 'Update password' },
  pw_strength: { vi: 'Độ mạnh', en: 'Strength' },
  pw_weak: { vi: 'Yếu', en: 'Weak' },
  pw_fair: { vi: 'Trung bình', en: 'Fair' },
  pw_good: { vi: 'Tốt', en: 'Good' },
  pw_strong: { vi: 'Mạnh', en: 'Strong' },
  pw_rule_len: { vi: 'Ít nhất 8 ký tự', en: 'At least 8 characters' },
  pw_rule_num: { vi: 'Có chữ số', en: 'Contains a number' },
  pw_rule_case: { vi: 'Có chữ hoa & chữ thường', en: 'Upper & lower case' },
  err_cur_pw: { vi: 'Mật khẩu hiện tại không đúng.', en: 'Current password is incorrect.' },
  err_pw_match: { vi: 'Mật khẩu xác nhận không khớp.', en: 'Passwords do not match.' },
  err_pw_weak: { vi: 'Mật khẩu chưa đạt yêu cầu.', en: 'Password does not meet the rules.' },
  err_required: { vi: 'Bắt buộc.', en: 'Required.' },

  sec_2fa: { vi: 'Xác thực 2 lớp', en: 'Two-factor authentication' },
  sec_2fa_d: {
    vi: 'Thêm một lớp bảo vệ khi đăng nhập bằng mã OTP.',
    en: 'Add an extra layer with a one-time code at sign-in.',
  },
  sec_sessions: { vi: 'Phiên đang hoạt động', en: 'Active sessions' },
  sec_sessions_d: {
    vi: 'Các thiết bị đang đăng nhập vào tài khoản của bạn.',
    en: 'Devices currently signed in to your account.',
  },
  this_device: { vi: 'Thiết bị này', en: 'This device' },
  signout_all: { vi: 'Đăng xuất mọi thiết bị khác', en: 'Sign out all other devices' },

  // preferences
  sec_prefs: { vi: 'Hiển thị & ngôn ngữ', en: 'Display & language' },
  sec_prefs_d: { vi: 'Tùy chỉnh trải nghiệm phù hợp với bạn.', en: 'Tune the experience to suit you.' },
  pref_notif: { vi: 'Thông báo trong ứng dụng', en: 'In-app notifications' },
  pref_notif_d: { vi: 'Cảnh báo khi có sự cố AGV hoặc lệnh mới.', en: 'Alerts for AGV faults or new tasks.' },
  pref_sound: { vi: 'Âm thanh cảnh báo', en: 'Alert sounds' },
  pref_sound_d: { vi: 'Phát âm khi có cảnh báo ưu tiên cao.', en: 'Play a sound for high-priority alerts.' },

  // logout confirm (UC-82)
  logout_title: { vi: 'Đăng xuất?', en: 'Sign out?' },
  logout_body: {
    vi: 'Bạn sẽ cần đăng nhập lại để tiếp tục điều phối.',
    en: "You'll need to sign in again to keep dispatching.",
  },
  logout_confirm: { vi: 'Đăng xuất', en: 'Sign out' },

  // toasts
  toast_saved: { vi: 'Đã lưu hồ sơ', en: 'Profile saved' },
  toast_pw: { vi: 'Đã cập nhật mật khẩu', en: 'Password updated' },
  toast_pref: { vi: 'Đã lưu tùy chọn', en: 'Preferences saved' },
  toast_2fa_on: { vi: 'Đã bật xác thực 2 lớp', en: 'Two-factor enabled' },
  toast_2fa_off: { vi: 'Đã tắt xác thực 2 lớp', en: 'Two-factor disabled' },
  toast_sessions: { vi: 'Đã đăng xuất các thiết bị khác', en: 'Other devices signed out' },
  toast_photo: { vi: 'Đã đổi ảnh đại diện', en: 'Photo updated' },

  show: { vi: 'Hiện', en: 'Show' },
  hide: { vi: 'Ẩn', en: 'Hide' },

  // ── Admin User Management (sidebar "Users & Access") ──
  um_nav: { vi: 'Người dùng & Quyền', en: 'Users & Access' },
  um_eyebrow: { vi: 'Quản trị', en: 'Administration' },
  um_title: { vi: 'Người dùng & Phân quyền', en: 'Users & Access' },
  um_lede: {
    vi: 'Quản lý tài khoản, vai trò và quyền truy cập của toàn hệ thống WES.',
    en: 'Manage accounts, roles and access across the WES system.',
  },
  um_add: { vi: 'Thêm người dùng', en: 'Add user' },
  um_search_ph: { vi: 'Tìm theo tên, username, email…', en: 'Search name, username, email…' },
  um_all: { vi: 'Tất cả', en: 'All' },
  um_count_one: { vi: 'người dùng', en: 'users' },
  um_no_results: { vi: 'Không tìm thấy người dùng phù hợp.', en: 'No matching users found.' },
  um_no_results_hint: { vi: 'Thử đổi từ khóa hoặc bỏ bớt bộ lọc.', en: 'Try a different keyword or clear filters.' },

  col_user: { vi: 'Người dùng', en: 'User' },
  col_role: { vi: 'Vai trò', en: 'Role' },
  col_status: { vi: 'Trạng thái', en: 'Status' },
  col_lastactive: { vi: 'Hoạt động cuối', en: 'Last active' },

  st_active: { vi: 'Đang hoạt động', en: 'Active' },
  st_locked: { vi: 'Đã khóa', en: 'Locked' },
  st_invited: { vi: 'Chờ kích hoạt', en: 'Invited' },
  st_inactive: { vi: 'Ngừng hoạt động', en: 'Inactive' },

  act_view: { vi: 'Xem chi tiết', en: 'View details' },
  act_edit: { vi: 'Chỉnh sửa', en: 'Edit' },
  act_roles: { vi: 'Vai trò & quyền', en: 'Roles & access' },
  act_reset: { vi: 'Đặt lại mật khẩu', en: 'Reset password' },
  act_lock: { vi: 'Khóa tài khoản', en: 'Lock account' },
  act_unlock: { vi: 'Mở khóa', en: 'Unlock' },
  act_delete: { vi: 'Xóa tài khoản', en: 'Delete account' },

  role_admin_desc: {
    vi: 'Cấu hình & quản trị toàn hệ thống: đội AGV, bản đồ, rule điều phối, người dùng.',
    en: 'Full configuration & administration: fleet, map, dispatch rules, users.',
  },
  role_operator_desc: {
    vi: 'Vận hành tại hiện trường: quét mã tạo yêu cầu, theo dõi trạng thái cơ bản.',
    en: 'Field operation: scan to create requests, monitor basic status.',
  },

  d_account: { vi: 'Tài khoản', en: 'Account' },
  d_overview: { vi: 'Tổng quan', en: 'Overview' },
  d_perms: { vi: 'Quyền truy cập', en: 'Permissions' },
  field_username: { vi: 'Tên đăng nhập', en: 'Username' },
  field_mfa: { vi: 'Xác thực 2 lớp', en: 'Two-factor' },
  mfa_on: { vi: 'Đã bật', en: 'Enabled' },
  mfa_off: { vi: 'Chưa bật', en: 'Disabled' },
  field_created: { vi: 'Ngày tạo', en: 'Created' },
  danger_zone: { vi: 'Vùng nguy hiểm', en: 'Danger zone' },
  online: { vi: 'Trực tuyến', en: 'Online' },

  pg_fleet: { vi: 'Quản lý đội AGV', en: 'AGV fleet management' },
  pg_map: { vi: 'Bản đồ & topology', en: 'Map & topology' },
  pg_requests: { vi: 'Yêu cầu vận chuyển', en: 'Transport requests' },
  pg_dispatch: { vi: 'Rule điều phối', en: 'Dispatch rules' },
  pg_dashboard: { vi: 'Dashboard giám sát', en: 'Monitoring dashboard' },
  pg_users: { vi: 'Quản lý người dùng', en: 'User management' },
  pg_audit: { vi: 'Nhật ký & audit', en: 'Event log & audit' },
  lvl_full: { vi: 'Toàn quyền', en: 'Full' },
  lvl_view: { vi: 'Chỉ xem', en: 'View' },
  lvl_none: { vi: 'Không', en: 'None' },

  m_create_title: { vi: 'Thêm người dùng mới', en: 'Add new user' },
  m_edit_title: { vi: 'Chỉnh sửa người dùng', en: 'Edit user' },
  ph_fullname: { vi: 'VD: Nguyễn Văn An', en: 'e.g. Nguyen Van An' },
  ph_username: { vi: 'VD: an.nguyen', en: 'e.g. an.nguyen' },
  ph_email_um: { vi: 'VD: an.nguyen@wes.vn', en: 'e.g. an.nguyen@wes.vn' },
  ph_phone: { vi: 'VD: 09xx xxx xxx', en: 'e.g. 09xx xxx xxx' },
  send_invite_um: { vi: 'Gửi email mời kích hoạt tài khoản', en: 'Send activation invite email' },
  create_btn: { vi: 'Tạo người dùng', en: 'Create user' },
  err_username: {
    vi: 'Chỉ gồm chữ thường, số, dấu chấm và gạch dưới.',
    en: 'Lowercase letters, numbers, dot and underscore only.',
  },
  err_username_taken: { vi: 'Tên đăng nhập đã tồn tại.', en: 'Username already taken.' },
  err_email_taken: { vi: 'Email đã được sử dụng.', en: 'Email already in use.' },

  roles_title: { vi: 'Vai trò & quyền truy cập', en: 'Roles & access' },
  roles_pick: { vi: 'Chọn vai trò', en: 'Assign role' },
  roles_note: {
    vi: 'Quyền được xác định theo vai trò. Operator và Admin là hai vai trò khả dụng hiện tại.',
    en: 'Permissions are derived from the role. Operator and Admin are the available roles.',
  },

  ar_title: { vi: 'Đặt lại mật khẩu', en: 'Reset password' },
  ar_link: { vi: 'Gửi link đặt lại qua email', en: 'Send reset link by email' },
  ar_link_d: { vi: 'Người dùng nhận email và tự đặt mật khẩu mới.', en: 'User receives an email and sets a new password.' },
  ar_temp: { vi: 'Tạo mật khẩu tạm thời', en: 'Generate temporary password' },
  ar_temp_d: { vi: 'Hệ thống tạo mật khẩu tạm, buộc đổi ở lần đăng nhập đầu.', en: 'System creates a temp password, forced change on first login.' },
  ar_temp_pwd: { vi: 'Mật khẩu tạm', en: 'Temporary password' },
  ar_confirm: { vi: 'Xác nhận đặt lại', en: 'Confirm reset' },
  ar_copy: { vi: 'Sao chép', en: 'Copy' },
  ar_copied: { vi: 'Đã chép', en: 'Copied' },
  ar_regen: { vi: 'Tạo lại', en: 'Regenerate' },

  lk_title: { vi: 'Khóa tài khoản', en: 'Lock account' },
  ulk_title: { vi: 'Mở khóa tài khoản', en: 'Unlock account' },
  lk_warn: {
    vi: 'Người dùng sẽ bị đăng xuất và không thể đăng nhập cho đến khi được mở khóa.',
    en: 'The user will be signed out and cannot log in until unlocked.',
  },
  ulk_warn: { vi: 'Người dùng có thể đăng nhập lại bình thường.', en: 'The user will be able to sign in again.' },
  lk_reason: { vi: 'Lý do khóa (tùy chọn)', en: 'Reason (optional)' },
  lk_reason_ph: { vi: 'VD: Tạm ngưng theo yêu cầu giám sát ca', en: 'e.g. Suspended per shift supervisor' },

  del_title: { vi: 'Xóa tài khoản người dùng', en: 'Delete user account' },
  del_warn: {
    vi: 'Hành động này không thể hoàn tác. Tài khoản và quyền truy cập sẽ bị xóa vĩnh viễn.',
    en: 'This action cannot be undone. The account and its access will be permanently removed.',
  },
  del_type: { vi: 'Nhập username để xác nhận:', en: 'Type the username to confirm:' },
  del_confirm: { vi: 'Xóa vĩnh viễn', en: 'Delete permanently' },
  del_mismatch: { vi: 'Username không khớp.', en: 'Username does not match.' },

  t_created: { vi: 'Đã tạo người dùng', en: 'User created' },
  t_updated: { vi: 'Đã cập nhật người dùng', en: 'User updated' },
  t_deleted: { vi: 'Đã xóa người dùng', en: 'User deleted' },
  t_locked: { vi: 'Đã khóa tài khoản', en: 'Account locked' },
  t_unlocked: { vi: 'Đã mở khóa tài khoản', en: 'Account unlocked' },
  t_reset: { vi: 'Đã đặt lại mật khẩu', en: 'Password reset' },
  t_role: { vi: 'Đã cập nhật vai trò', en: 'Role updated' },

  just_now: { vi: 'vừa xong', en: 'just now' },
  min_ago: { vi: 'phút trước', en: 'min ago' },
  hr_ago: { vi: 'giờ trước', en: 'h ago' },
  day_ago: { vi: 'ngày trước', en: 'd ago' },
  never: { vi: 'chưa đăng nhập', en: 'never' },
};

export type TFunc = (key: string) => string;

export function useI18n() {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
    return saved === 'vi' || saved === 'en' ? saved : 'vi';
  });
  const setLang = useCallback((v: Lang) => {
    setLangState(v);
    try {
      localStorage.setItem(LANG_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback<TFunc>((k) => (I18N[k] ? I18N[k][lang] : k), [lang]);
  return { lang, setLang, t };
}
