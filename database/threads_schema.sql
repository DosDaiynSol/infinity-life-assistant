-- ================================================
-- THREADS KEYWORD SEARCH: Database Schema
-- Выполните этот SQL в Supabase SQL Editor
-- https://supabase.com/dashboard/project/iqaebzlfeefjtbfwmhpe/sql
-- ================================================

-- 1. Таблица обработанных постов
CREATE TABLE threads_processed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT UNIQUE NOT NULL,
  text TEXT,
  username TEXT,
  permalink TEXT,
  post_timestamp TIMESTAMPTZ,
  keyword_matched TEXT,
  
  -- Статусы: new, validated, replied, skipped
  status TEXT DEFAULT 'new',
  validation_result JSONB,
  reply_text TEXT,
  reply_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ
);

-- Индексы
CREATE INDEX idx_threads_post_id ON threads_processed_posts(post_id);
CREATE INDEX idx_threads_status ON threads_processed_posts(status);
CREATE INDEX idx_threads_created_at ON threads_processed_posts(created_at);
CREATE INDEX idx_threads_keyword ON threads_processed_posts(keyword_matched);

-- 2. Таблица логов API запросов
CREATE TABLE threads_api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT,
  results_count INT DEFAULT 0,
  new_posts_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_logs_created_at ON threads_api_logs(created_at);

-- 3. Таблица статистики
CREATE TABLE threads_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  api_requests INT DEFAULT 0,
  posts_found INT DEFAULT 0,
  posts_validated INT DEFAULT 0,
  replies_sent INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_stats_date ON threads_daily_stats(date);

-- 4. Включаем Row Level Security (опционально)
ALTER TABLE threads_processed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads_api_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads_daily_stats ENABLE ROW LEVEL SECURITY;

-- Разрешаем все операции для service_role
CREATE POLICY "Allow all for service role" ON threads_processed_posts
  FOR ALL USING (true);

CREATE POLICY "Allow all for service role" ON threads_api_logs
  FOR ALL USING (true);

CREATE POLICY "Allow all for service role" ON threads_daily_stats
  FOR ALL USING (true);

-- ================================================
-- ГОТОВО! Таблицы созданы:
-- - threads_processed_posts
-- - threads_api_logs  
-- - threads_daily_stats
-- ================================================
