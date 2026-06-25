-- =============================================================================
-- SWES — Smart Warehouse Execution System
-- PostgreSQL 16.x — Initial Schema
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE user_role_enum AS ENUM ('ADMIN', 'OPERATOR');

CREATE TYPE agv_state_enum AS ENUM (
  'IDLE',
  'EXECUTING',
  'CHARGING',
  'ERROR',
  'OFFLINE',
  'UNAVAILABLE'
);

-- Matches openTCS Point.Type: HALT_POSITION and PARK_POSITION.
-- Business roles (pickup/dropoff/charge) are encoded at the Location level, not the Point level.
CREATE TYPE point_type_enum AS ENUM (
  'HALT', -- temporary stop to process an order (openTCS: HALT_POSITION)
  'PARK'  -- long-term idle stop (openTCS: PARK_POSITION)
);


-- PARK is a Point-level concept in openTCS, not a Location type.
CREATE TYPE location_type_enum AS ENUM ('PICKUP', 'DROPOFF', 'CHARGE');

CREATE TYPE block_type_enum AS ENUM (
  'SINGLE_VEHICLE',
  'SAME_DIRECTION_ONLY',
  'LOCKED'
);

CREATE TYPE block_member_type_enum AS ENUM ('POINT', 'PATH');

CREATE TYPE transport_request_status_enum AS ENUM (
  'PENDING',
  'VALIDATING',
  'INVALID',
  'WAITING_DISPATCH',
  'BLOCKED',
  'DISPATCHING',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE event_type_enum AS ENUM ('INFO', 'WARNING', 'ERROR');

CREATE TYPE event_module_enum AS ENUM (
  'AGV',
  'MAP',
  'TRANSPORT',
  'DISPATCH',
  'AUTH',
  'SYSTEM'
);

CREATE TYPE map_status_enum AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TYPE audit_action_enum AS ENUM ('CREATE', 'UPDATE', 'DELETE');

CREATE TYPE cargo_status_enum AS ENUM ('ACTIVE', 'DELIVERED', 'CANCELLED');

CREATE TYPE audit_entity_type_enum AS ENUM (
  'AGV',
  'POINT',
  'PATH',
  'LOCATION',
  'BLOCK',
  'CARGO',
  'TRANSPORT_REQUEST',
  'DISPATCH_POLICY',
  'USER'
);

-- =============================================================================
-- 1. AUTH & USERS
-- =============================================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30),                          -- profile (UC-83/84)
  shift         VARCHAR(100),                         -- ca làm / bộ phận
  avatar_url    TEXT,                                 -- ảnh đại diện
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
  is_invited    BOOLEAN NOT NULL DEFAULT FALSE,       -- chờ kích hoạt (status=INVITED)
  lock_reason   TEXT,                                 -- lý do khóa (hiển thị ở admin)
  last_login_at TIMESTAMPTZ,                          -- mốc đăng nhập gần nhất (denormalized)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Status hiển thị (UI) được suy ra:
--   is_locked              -> LOCKED
--   is_invited             -> INVITED
--   is_active = TRUE        -> ACTIVE
--   else                   -> INACTIVE (soft-deleted/deactivated)
-- "online" và "last active" suy ra từ user_sessions (login_at/logout_at).

CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  name        user_role_enum NOT NULL UNIQUE,
  description TEXT
);

INSERT INTO roles (name, description) VALUES
  ('ADMIN',    'System administrator with full access'),
  ('OPERATOR', 'Warehouse operator with limited operational access');

CREATE TABLE user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_revoked  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address INET,
  user_agent TEXT,
  login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_at  TIMESTAMPTZ
);

-- Đặt lại mật khẩu (UC-86 Quên mật khẩu / yêu cầu đặt lại)
CREATE TABLE password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tùy chọn hiển thị của người dùng (tab Preferences)
CREATE TABLE user_preferences (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language             VARCHAR(5)  NOT NULL DEFAULT 'vi',   -- 'vi' | 'en'
  notifications_enabled BOOLEAN    NOT NULL DEFAULT TRUE,   -- thông báo trong ứng dụng
  sound_enabled        BOOLEAN     NOT NULL DEFAULT FALSE,  -- âm thanh cảnh báo
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. AGV FLEET MANAGEMENT
-- =============================================================================

CREATE TABLE agvs (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                          VARCHAR(100) NOT NULL UNIQUE, -- openTCS vehicle name
  name                          VARCHAR(100) NOT NULL,
  mac_address                   VARCHAR(17),
  is_dispatch_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  is_ignored                    BOOLEAN NOT NULL DEFAULT FALSE,
  operational_battery_threshold SMALLINT NOT NULL DEFAULT 20
    CHECK (operational_battery_threshold BETWEEN 0 AND 100),
  charging_battery_threshold    SMALLINT NOT NULL DEFAULT 10
    CHECK (charging_battery_threshold BETWEEN 0 AND 100),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Live status synced from openTCS (1-to-1 with agvs)
CREATE TABLE agv_live_status (
  agv_id        UUID PRIMARY KEY REFERENCES agvs(id) ON DELETE CASCADE,
  state         agv_state_enum NOT NULL DEFAULT 'OFFLINE',
  current_point VARCHAR(100), -- openTCS point name
  battery_level SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agv_status_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agv_id        UUID NOT NULL REFERENCES agvs(id) ON DELETE CASCADE,
  state         agv_state_enum NOT NULL,
  current_point VARCHAR(100),
  battery_level SMALLINT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agv_error_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agv_id        UUID NOT NULL REFERENCES agvs(id) ON DELETE CASCADE,
  error_code    VARCHAR(50) NOT NULL, -- e.g. E_STOP
  error_message TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

-- =============================================================================
-- 3. WAREHOUSE MAP & TOPOLOGY
-- =============================================================================

CREATE TABLE operation_maps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  version     VARCHAR(20)  NOT NULL,
  status      map_status_enum NOT NULL DEFAULT 'DRAFT',
  file_path   TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE points (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id       UUID NOT NULL REFERENCES operation_maps(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL, -- QR code identifier
  x_coord      DOUBLE PRECISION NOT NULL,
  y_coord      DOUBLE PRECISION NOT NULL,
  type         point_type_enum NOT NULL DEFAULT 'HALT',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, name)
);

-- Paths are always directed (src → dest), matching openTCS model.
-- max_velocity       : forward speed in mm/s (src → dest)
-- max_reverse_velocity: reverse speed in mm/s (dest → src, AGV reverses); 0 = not allowed
-- To model two-way travel: either set max_reverse_velocity > 0 (AGV reverses on same path)
-- or create two separate paths A→B and B→A (AGV always goes forward).
CREATE TABLE paths (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id               UUID NOT NULL REFERENCES operation_maps(id) ON DELETE CASCADE,
  name                 VARCHAR(100) NOT NULL,
  source_point_id      UUID NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  dest_point_id        UUID NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  max_velocity         INTEGER NOT NULL DEFAULT 0, -- mm/s, 0 = use vehicle default
  max_reverse_velocity INTEGER NOT NULL DEFAULT 0, -- mm/s, 0 = reverse not allowed
  length               DOUBLE PRECISION,           -- mm
  is_available         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, name),
  CHECK (source_point_id <> dest_point_id),
  CHECK (max_velocity >= 0),
  CHECK (max_reverse_velocity >= 0)
);

CREATE TABLE locations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id             UUID NOT NULL REFERENCES operation_maps(id) ON DELETE CASCADE,
  name               VARCHAR(100) NOT NULL,
  type               location_type_enum NOT NULL,
  approach_direction VARCHAR(20), -- NORTH | SOUTH | EAST | WEST
  is_available       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, name)
);

-- position_index: 0 = outermost (lấy trước), tăng dần vào trong
CREATE TABLE location_points (
  location_id    UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  point_id       UUID NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  position_index SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, point_id)
);

CREATE TABLE blocks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id            UUID NOT NULL REFERENCES operation_maps(id) ON DELETE CASCADE,
  name              VARCHAR(100) NOT NULL,
  type              block_type_enum NOT NULL DEFAULT 'SINGLE_VEHICLE',
  max_vehicle_count SMALLINT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, name)
);

CREATE TABLE block_members (
  block_id    UUID NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL,
  member_type block_member_type_enum NOT NULL,
  PRIMARY KEY (block_id, member_id)
);

-- =============================================================================
-- 4. TRANSPORT REQUEST MANAGEMENT
-- =============================================================================

-- Cargo is created first by scanner API, then triggers transport_request creation.
-- source_point_id / destination_location_id are denormalized from cargo at task-creation
-- time so transport_request history is preserved even after cargo is deleted.
CREATE TABLE cargos (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_code               VARCHAR(255) NOT NULL,
  source_point_id         UUID REFERENCES points(id) ON DELETE SET NULL,
  destination_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  status                  cargo_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transport_requests (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_code            VARCHAR(50) NOT NULL UNIQUE,
  cargo_id                UUID REFERENCES cargos(id) ON DELETE SET NULL,
  source_point_id         UUID REFERENCES points(id) ON DELETE SET NULL,
  destination_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  pickup_point_id         UUID REFERENCES points(id) ON DELETE SET NULL,   -- calculated
  dropoff_point_id        UUID REFERENCES points(id) ON DELETE SET NULL,   -- calculated
  assigned_agv_id         UUID REFERENCES agvs(id) ON DELETE SET NULL,
  status                  transport_request_status_enum NOT NULL DEFAULT 'PENDING',
  invalid_reason          TEXT,
  no_pickup_reason        TEXT,
  no_dropoff_reason       TEXT,
  no_assign_reason        TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at             TIMESTAMPTZ,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 5. DISPATCH POLICY
-- =============================================================================

CREATE TABLE dispatch_policies (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      VARCHAR(100) NOT NULL,
  weight_urgency            DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  weight_proximity          DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  weight_inventory_position DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  max_agv_per_block         SMALLINT NOT NULL DEFAULT 1,
  is_active                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 6. MONITORING & LOGS
-- =============================================================================

CREATE TABLE kpi_snapshots (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_requests              INTEGER NOT NULL DEFAULT 0,
  completed_requests          INTEGER NOT NULL DEFAULT 0,
  failed_requests             INTEGER NOT NULL DEFAULT 0,
  cancelled_requests          INTEGER NOT NULL DEFAULT 0,
  avg_assign_time_seconds     DOUBLE PRECISION,
  avg_completion_time_seconds DOUBLE PRECISION,
  active_agv_count            SMALLINT NOT NULL DEFAULT 0,
  throughput_per_hour         DOUBLE PRECISION
);

CREATE TABLE event_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type  event_type_enum NOT NULL DEFAULT 'INFO',
  module      event_module_enum NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  correlation_id  UUID,
  message         TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type  audit_entity_type_enum NOT NULL,
  entity_id    UUID NOT NULL,
  action       audit_action_enum NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Auth
CREATE INDEX idx_refresh_tokens_user_id   ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX idx_user_sessions_user_id     ON user_sessions(user_id);
CREATE INDEX idx_password_reset_user_id    ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_expires_at ON password_reset_tokens(expires_at);

-- AGV
CREATE INDEX idx_agv_status_history_agv_id      ON agv_status_history(agv_id);
CREATE INDEX idx_agv_status_history_recorded_at  ON agv_status_history(recorded_at DESC);
CREATE INDEX idx_agv_error_history_agv_id        ON agv_error_history(agv_id);
CREATE INDEX idx_agv_error_history_occurred_at   ON agv_error_history(occurred_at DESC);

-- Topology
CREATE INDEX idx_points_map_id        ON points(map_id);
CREATE INDEX idx_paths_map_id         ON paths(map_id);
CREATE INDEX idx_paths_source_point   ON paths(source_point_id);
CREATE INDEX idx_paths_dest_point     ON paths(dest_point_id);
CREATE INDEX idx_locations_map_id     ON locations(map_id);
CREATE INDEX idx_blocks_map_id        ON blocks(map_id);

-- Cargo
CREATE INDEX idx_cargos_status      ON cargos(status);
CREATE INDEX idx_cargos_created_at  ON cargos(created_at DESC);
CREATE INDEX idx_cargos_source      ON cargos(source_point_id);
CREATE INDEX idx_cargos_destination ON cargos(destination_location_id);

-- Transport Request
CREATE INDEX idx_transport_requests_cargo_id     ON transport_requests(cargo_id);
CREATE INDEX idx_transport_requests_status       ON transport_requests(status);
CREATE INDEX idx_transport_requests_created_at   ON transport_requests(created_at DESC);
CREATE INDEX idx_transport_requests_assigned_agv ON transport_requests(assigned_agv_id);

-- Logs
CREATE INDEX idx_event_logs_module         ON event_logs(module);
CREATE INDEX idx_event_logs_created_at     ON event_logs(created_at DESC);
CREATE INDEX idx_event_logs_entity         ON event_logs(entity_type, entity_id);
CREATE INDEX idx_event_logs_correlation_id ON event_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_performed_at ON audit_logs(performed_at DESC);
CREATE INDEX idx_audit_logs_performed_by ON audit_logs(performed_by);

-- KPI
CREATE INDEX idx_kpi_snapshots_at ON kpi_snapshots(snapshot_at DESC);

-- =============================================================================
-- 7. ZONES
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS zone_kernel_id_seq START 1;

CREATE TYPE zone_type_enum AS ENUM ('PICKUP', 'DROPOFF');
CREATE TYPE zone_status_enum AS ENUM ('ACTIVE', 'STALE');

-- kernel_id: unique sequential ID used to name locations in openTCS.
-- NULL for PICKUP zones. For DROPOFF zones: parent location = zone_{kernel_id},
-- child locations = location_{kernel_id}_{point_name}.
CREATE TABLE zones (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   VARCHAR(255) NOT NULL,
  type                   zone_type_enum NOT NULL,
  kernel_id              INTEGER UNIQUE,
  approach_location_name VARCHAR(255),
  status                 zone_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zone_members (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id        UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  location_name  VARCHAR(255) NOT NULL,
  position_index INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_zone_members_zone_id ON zone_members(zone_id);
