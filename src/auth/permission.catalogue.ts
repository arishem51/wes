/**
 * The fixed catalogue of permission keys. Each key must correspond to a guarded code path
 * (an endpoint decorated with `@RequirePermissions`). Roles are freely composed from these keys
 * in the database (`role_permissions`), editable from the "Vai trò & Quyền" screen — but the
 * catalogue itself is code, so a new capability is one deploy, never hand-written SQL.
 *
 * On boot, `PermissionCatalogueService` upserts these rows into the `permissions` table.
 */

export type PermissionCluster =
  | 'view'
  | 'vehicle'
  | 'order'
  | 'cargo'
  | 'area'
  | 'fleet'
  | 'map'
  | 'admin';

export interface PermissionDef {
  key: string;
  cluster: PermissionCluster;
  /** Group C — destructive / plant-wide. Flagged red in the role editor. */
  dangerous?: boolean;
  labelVi: string;
  labelEn: string;
  labelJa: string;
}

export const PERMISSION_CATALOGUE: PermissionDef[] = [
  {
    key: 'agvs.manage',
    cluster: 'admin',
    dangerous: true,
    labelVi: 'Quản lý đăng ký AGV',
    labelEn: 'Manage AGV registry',
    labelJa: 'AGV登録管理',
  },
  {
    key: 'dispatch.manage',
    cluster: 'admin',
    dangerous: true,
    labelVi: 'Quản lý chính sách điều phối',
    labelEn: 'Manage dispatch policies',
    labelJa: '配車ポリシー管理',
  },
  // ── Cụm: Xem (read-only — every role gets these) ─────────────────────────────
  {
    key: 'map.view',
    cluster: 'view',
    labelVi: 'Xem bản đồ & chi tiết phần tử',
    labelEn: 'View map & element details',
    labelJa: 'マップと要素の詳細を表示',
  },
  {
    key: 'list.view',
    cluster: 'view',
    labelVi: 'Xem các bảng danh sách',
    labelEn: 'View list panels',
    labelJa: 'リストパネルを表示',
  },

  // ── Cụm: Điều khiển xe ──────────────────────────────────────────────────────
  {
    key: 'vehicle.pause',
    cluster: 'vehicle',
    labelVi: 'Tạm dừng / tiếp tục xe',
    labelEn: 'Pause / resume vehicle',
    labelJa: '車両の一時停止／再開',
  },
  {
    key: 'vehicle.integration_level',
    cluster: 'vehicle',
    labelVi: 'Đổi mức tích hợp xe',
    labelEn: 'Change vehicle integration level',
    labelJa: '車両の統合レベルを変更',
  },
  {
    key: 'vehicle.comm_adapter',
    cluster: 'vehicle',
    labelVi: 'Kết nối / ngắt comm adapter, đưa xe online',
    labelEn: 'Connect / disconnect comm adapter, bring online',
    labelJa: '通信アダプタの接続／切断、オンライン化',
  },
  {
    key: 'vehicle.send_to_point',
    cluster: 'vehicle',
    labelVi: 'Gửi xe tới điểm',
    labelEn: 'Send vehicle to point',
    labelJa: '車両を地点へ送る',
  },
  {
    key: 'vehicle.withdraw',
    cluster: 'vehicle',
    labelVi: 'Rút đơn khỏi xe',
    labelEn: 'Withdraw order from vehicle',
    labelJa: '車両からオーダーを取り消す',
  },

  // ── Cụm: Đơn vận chuyển ─────────────────────────────────────────────────────
  {
    key: 'order.create',
    cluster: 'order',
    labelVi: 'Tạo đơn vận chuyển',
    labelEn: 'Create transport order',
    labelJa: '搬送オーダーを作成',
  },
  {
    key: 'order.withdraw',
    cluster: 'order',
    labelVi: 'Rút / huỷ đơn vận chuyển',
    labelEn: 'Withdraw transport order',
    labelJa: '搬送オーダーを取り消す',
  },

  // ── Cụm: Hàng hoá ──────────────────────────────────────────────────────────
  {
    key: 'cargo.create',
    cluster: 'cargo',
    labelVi: 'Tạo yêu cầu hàng',
    labelEn: 'Create cargo',
    labelJa: '貨物を作成',
  },
  {
    key: 'cargo.cancel',
    cluster: 'cargo',
    labelVi: 'Huỷ / xoá yêu cầu hàng',
    labelEn: 'Cancel / delete cargo',
    labelJa: '貨物をキャンセル／削除',
  },
  {
    key: 'cargo.redirect',
    cluster: 'cargo',
    labelVi: 'Đổi kho đích của hàng',
    labelEn: 'Redirect cargo target store',
    labelJa: '貨物の目的ストアを変更',
  },

  // ── Cụm: Khu vực ───────────────────────────────────────────────────────────
  {
    key: 'area.create',
    cluster: 'area',
    labelVi: 'Tạo khu vực',
    labelEn: 'Create area',
    labelJa: 'エリアを作成',
  },
  {
    key: 'area.edit',
    cluster: 'area',
    labelVi: 'Sửa khu vực & điểm thành viên',
    labelEn: 'Edit area & members',
    labelJa: 'エリアとメンバーを編集',
  },
  {
    key: 'area.delete',
    cluster: 'area',
    dangerous: true,
    labelVi: 'Xoá khu vực',
    labelEn: 'Delete area',
    labelJa: 'エリアを削除',
  },
  {
    key: 'area.sync_kernel',
    cluster: 'area',
    labelVi: 'Đồng bộ khu vực với kernel',
    labelEn: 'Sync areas with kernel',
    labelJa: 'カーネルとエリアを同期',
  },

  // ── Cụm: Đội xe & bản đồ (nguy hiểm) ───────────────────────────────────────
  {
    key: 'fleet.control',
    cluster: 'fleet',
    dangerous: true,
    labelVi: 'Chạy tất cả / Dừng tất cả đội xe',
    labelEn: 'Run all / Stop all fleet',
    labelJa: '全車両の稼働／停止',
  },
  {
    key: 'path.lock',
    cluster: 'fleet',
    dangerous: true,
    labelVi: 'Khoá / mở đường đi',
    labelEn: 'Lock / unlock path',
    labelJa: '経路のロック／解除',
  },
  {
    key: 'map.download',
    cluster: 'map',
    labelVi: 'Tải bản đồ đã lưu (XML)',
    labelEn: 'Download stored maps (XML)',
    labelJa: '保存済みマップをダウンロード',
  },
  {
    key: 'map.upload',
    cluster: 'map',
    dangerous: true,
    labelVi: 'Upload bản đồ vào WES / nạp vào kernel',
    labelEn: 'Upload maps to WES / load into kernel',
    labelJa: 'WESへアップロード／カーネルへ読込',
  },

  // ── Cụm: Quản trị ──────────────────────────────────────────────────────────
  {
    key: 'users.view',
    cluster: 'admin',
    labelVi: 'Xem người dùng & vai trò',
    labelEn: 'View users & roles',
    labelJa: 'ユーザーとロールを表示',
  },
  {
    key: 'users.manage',
    cluster: 'admin',
    dangerous: true,
    labelVi: 'Quản lý người dùng (tạo / sửa / xoá / gán vai trò)',
    labelEn: 'Manage users (create / edit / delete / assign role)',
    labelJa: 'ユーザー管理（作成／編集／削除／ロール割当）',
  },
  {
    key: 'roles.manage',
    cluster: 'admin',
    dangerous: true,
    labelVi: 'Quản lý vai trò & ma trận quyền',
    labelEn: 'Manage roles & permission matrix',
    labelJa: 'ロールと権限マトリクスを管理',
  },
  {
    key: 'tokens.manage',
    cluster: 'admin',
    dangerous: true,
    labelVi: 'Cấp / thu hồi token vĩnh viễn',
    labelEn: 'Issue / revoke permanent tokens',
    labelJa: '永続トークンの発行／取消',
  },
];

/** Permission keys always granted to any authenticated user, regardless of role. */
export const IMPLICIT_VIEW_PERMISSIONS = ['map.view', 'list.view'] as const;

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOGUE.map(
  (p) => p.key,
);

/** Baseline grants seeded for the system roles on first boot (only if the role has none). */
export const SYSTEM_ROLE_GRANTS: Record<string, string[]> = {
  admin: ALL_PERMISSION_KEYS,
  operator: [
    'map.view',
    'list.view',
    'vehicle.pause',
    'vehicle.integration_level',
    'vehicle.comm_adapter',
    'vehicle.send_to_point',
    'vehicle.withdraw',
    'order.create',
    'order.withdraw',
    'cargo.create',
    'cargo.cancel',
    'cargo.redirect',
    'area.create',
    'area.edit',
    'area.sync_kernel',
    'path.lock',
    'map.download',
  ],
  viewer: ['map.view', 'list.view', 'map.download'],
};
