CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id              BIGINT UNIQUE NOT NULL,
  phone_hash               VARCHAR(64) NOT NULL,
  pin_hash                 VARCHAR(64) NOT NULL,
  weight_kg                NUMERIC(5,2),
  height_cm                NUMERIC(5,2),
  age                      INT,
  sex                      VARCHAR(8),
  goal                     VARCHAR(16),
  tdee                     INT,
  daily_target_kcal        INT,
  stripe_customer_id       VARCHAR(64),
  subscription_status      VARCHAR(24) DEFAULT 'inactive',
  subscription_period_end  TIMESTAMP,
  paused_until             TIMESTAMP,
  daily_summary_enabled    BOOLEAN DEFAULT TRUE,
  timezone                 VARCHAR(40) DEFAULT 'America/Toronto',
  created_at               TIMESTAMP DEFAULT NOW(),
  updated_at               TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_status);

CREATE TABLE IF NOT EXISTS meals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  captured_at   TIMESTAMP DEFAULT NOW(),
  photo_s3_key  VARCHAR(255),
  source        VARCHAR(16) DEFAULT 'photo',
  kcal          INT NOT NULL,
  protein_g     INT DEFAULT 0,
  carbs_g       INT DEFAULT 0,
  fat_g         INT DEFAULT 0,
  foods_json    JSONB,
  advice_text   TEXT,
  edited        BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meals_user_day ON meals(user_id, captured_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS weights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight_kg    NUMERIC(5,2) NOT NULL,
  recorded_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weights_user_date ON weights(user_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS auth_pending (
  telegram_id  BIGINT PRIMARY KEY,
  step         VARCHAR(24) NOT NULL,
  data_json    JSONB DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMP DEFAULT NOW()
);
