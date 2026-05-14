-- [DealChat] 좋아요(즐겨찾기) 기능 추가
-- 날짜: 2026-05-14
-- 대상: companies, sellers, buyers 공통 사용
-- 적용: Studio SQL editor에서 직접 실행

-- 1. favorites 테이블 생성
CREATE TABLE IF NOT EXISTS public.favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('company', 'seller', 'buyer')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, item_id, item_type)
);

COMMENT ON TABLE public.favorites IS '유저별 좋아요(즐겨찾기) - companies/sellers/buyers 공통';

-- 2. 조회 성능용 인덱스
CREATE INDEX IF NOT EXISTS idx_favorites_user_type ON public.favorites (user_id, item_type);
CREATE INDEX IF NOT EXISTS idx_favorites_item ON public.favorites (item_id, item_type);

-- 3. Row Level Security
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own favorites" ON public.favorites;
CREATE POLICY "Users can view own favorites" ON public.favorites
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own favorites" ON public.favorites;
CREATE POLICY "Users can insert own favorites" ON public.favorites
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own favorites" ON public.favorites;
CREATE POLICY "Users can delete own favorites" ON public.favorites
    FOR DELETE USING (user_id = auth.uid());
