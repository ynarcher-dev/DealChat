-- [DealChat] MEDIUM 보안 수정 - 3단계
-- 보안 감사 3단계: MEDIUM #13 NDA 서버사이드 검증
-- 날짜: 2026-04-12

-- ============================================================
-- FIX #13: NDA 동의 서버사이드 검증
-- 문제: NDA 동의 체크가 localStorage에서 먼저 확인 → DevTools로 우회 가능
-- 수정: nda_logs 테이블 RLS 활성화 + NDA 확인 헬퍼 함수 추가
-- ============================================================

-- 13-a. nda_logs 테이블 RLS 활성화 (아직 활성화되지 않은 경우)
ALTER TABLE public.nda_logs ENABLE ROW LEVEL SECURITY;

-- 13-b. nda_logs RLS 정책: 사용자는 자기 NDA 기록만 조회 가능
DROP POLICY IF EXISTS "Users can read own nda_logs" ON public.nda_logs;
CREATE POLICY "Users can read own nda_logs"
  ON public.nda_logs FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin()
  );

-- 13-c. nda_logs RLS 정책: 인증 사용자는 자기 NDA만 INSERT 가능
DROP POLICY IF EXISTS "Users can insert own nda_logs" ON public.nda_logs;
CREATE POLICY "Users can insert own nda_logs"
  ON public.nda_logs FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
  );

-- 13-d. nda_logs: UPDATE/DELETE는 admin만 가능
DROP POLICY IF EXISTS "Only admin can update nda_logs" ON public.nda_logs;
CREATE POLICY "Only admin can update nda_logs"
  ON public.nda_logs FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Only admin can delete nda_logs" ON public.nda_logs;
CREATE POLICY "Only admin can delete nda_logs"
  ON public.nda_logs FOR DELETE TO authenticated
  USING (public.is_admin());

-- 13-e. NDA 체결 여부 확인 헬퍼 함수 (SECURITY DEFINER)
-- 다른 정책에서 NDA 체결 여부를 확인할 때 사용
CREATE OR REPLACE FUNCTION public.has_signed_nda(p_item_id UUID, p_item_type TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.nda_logs
    WHERE user_id = auth.uid()
      AND item_id = p_item_id
      AND item_type = p_item_type
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 13-f. nda_logs 중복 방지 (같은 사용자가 같은 항목에 중복 NDA 체결 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nda_logs_unique_user_item'
  ) THEN
    ALTER TABLE public.nda_logs
      ADD CONSTRAINT nda_logs_unique_user_item UNIQUE (user_id, item_id, item_type);
  END IF;
END $$;
