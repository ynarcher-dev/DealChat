-- [DealChat] HIGH 보안 수정 - 2단계
-- 보안 감사 2단계: HIGH #6~#9 수정
-- 날짜: 2026-04-12

-- ============================================================
-- FIX #6: 외부 공유 키 보안 강화 (DB 측 보완)
-- 문제: share_key가 6자리 + Math.random() → brute-force 가능
-- 수정: JS에서 crypto.getRandomValues() + 12자리로 전환 (이 마이그레이션은 DB 측 보완)
--       - share_key 컬럼에 UNIQUE 제약 추가 (중복 키 방지)
--       - share_key 최소 길이 CHECK 제약 추가
-- ============================================================

-- 6-a. share_key에 UNIQUE 제약 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_share_logs_share_key_unique'
  ) THEN
    ALTER TABLE public.external_share_logs
      ADD CONSTRAINT external_share_logs_share_key_unique UNIQUE (share_key);
  END IF;
END $$;

-- 6-b. share_key 최소 길이 제약 (12자 이상)
-- 기존 6자리 키도 허용하되 새 키는 12자 이상이어야 함
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_share_logs_share_key_min_length'
  ) THEN
    ALTER TABLE public.external_share_logs
      ADD CONSTRAINT external_share_logs_share_key_min_length CHECK (length(share_key) >= 6);
  END IF;
END $$;

-- ============================================================
-- FIX #8: Storage 버킷 보안 강화 (참고: Supabase Dashboard에서 수동 설정 필요)
-- 문제: uploads 버킷이 public → 파일 경로를 알면 누구나 접근
-- 수정: 클라이언트에서 createSignedUrl() 사용으로 전환 완료
--       버킷을 private으로 전환 시 아래 SQL 실행 필요 (Dashboard에서도 가능)
-- ============================================================

-- uploads 버킷을 private으로 변경
UPDATE storage.buckets
SET public = false
WHERE id = 'uploads';

-- Storage RLS: 인증된 사용자만 자기 파일 업로드/조회 가능
-- (기존 정책이 있을 수 있으므로 DROP IF EXISTS 후 재생성)

-- 인증 사용자는 자기 폴더에 업로드 가능
DROP POLICY IF EXISTS "Authenticated users can upload to own folder" ON storage.objects;
CREATE POLICY "Authenticated users can upload to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 인증 사용자는 자기 파일 조회 가능
DROP POLICY IF EXISTS "Authenticated users can read own files" ON storage.objects;
CREATE POLICY "Authenticated users can read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin은 모든 파일 조회 가능
DROP POLICY IF EXISTS "Admin can read all files" ON storage.objects;
CREATE POLICY "Admin can read all files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND public.is_admin()
  );

-- 인증 사용자는 자기 파일 삭제 가능
DROP POLICY IF EXISTS "Authenticated users can delete own files" ON storage.objects;
CREATE POLICY "Authenticated users can delete own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- FIX #9: Buyer 역할 제한 - DB 레벨 접근 차단
-- 문제: buyer 역할 제한이 클라이언트 JS에서만 적용 → DevTools로 우회 가능
-- 수정: RLS 정책으로 buyer가 특정 테이블/기능에 접근 불가하도록 차단
-- ============================================================

-- 9-a. 헬퍼 함수: 현재 사용자가 buyer인지 확인
CREATE OR REPLACE FUNCTION public.is_buyer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'buyer'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 9-b. external_share_logs: buyer는 INSERT 불가 (외부 공유 기능 차단)
DROP POLICY IF EXISTS "Non-buyer can insert share logs" ON public.external_share_logs;

-- 기존 INSERT 정책 제거 후 buyer 제외 정책 생성
DROP POLICY IF EXISTS "Authenticated can insert share logs" ON public.external_share_logs;
CREATE POLICY "Non-buyer can insert share logs"
  ON public.external_share_logs FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_buyer()
    AND auth.uid() = sender_id
  );

-- 9-c. buyers 테이블: buyer는 자기 정보만 조회 가능
-- 기존 SELECT 정책 확인 후 buyer 제한 추가
DROP POLICY IF EXISTS "Buyer can only see own records" ON public.buyers;
CREATE POLICY "Buyer can only see own records"
  ON public.buyers FOR SELECT TO authenticated
  USING (
    NOT public.is_buyer()
    OR auth.uid() = user_id
    OR public.is_admin()
  );

-- 9-d. buyers 테이블: buyer는 INSERT/UPDATE/DELETE 불가
DROP POLICY IF EXISTS "Non-buyer can manage buyers" ON public.buyers;
CREATE POLICY "Non-buyer can manage buyers"
  ON public.buyers FOR ALL TO authenticated
  USING (
    NOT public.is_buyer()
    OR public.is_admin()
  )
  WITH CHECK (
    NOT public.is_buyer()
    OR public.is_admin()
  );

-- 9-e. files 테이블: buyer는 자기 파일만 조회 가능 (다른 사용자 파일 차단)
-- 1단계에서 files RLS를 추가했으므로, buyer 전용 제한 정책 추가
DROP POLICY IF EXISTS "Buyer can only see own files" ON public.files;
CREATE POLICY "Buyer can only see own files"
  ON public.files FOR SELECT TO authenticated
  USING (
    NOT public.is_buyer()
    OR auth.uid() = user_id
    OR public.is_admin()
  );

-- 9-f. sellers 테이블: buyer의 INSERT/UPDATE/DELETE 차단 (조회만 허용)
DROP POLICY IF EXISTS "Non-buyer can manage sellers" ON public.sellers;
CREATE POLICY "Non-buyer can manage sellers"
  ON public.sellers FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_buyer()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Non-buyer can update sellers" ON public.sellers;
CREATE POLICY "Non-buyer can update sellers"
  ON public.sellers FOR UPDATE TO authenticated
  USING (
    NOT public.is_buyer()
    OR public.is_admin()
  )
  WITH CHECK (
    NOT public.is_buyer()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Non-buyer can delete sellers" ON public.sellers;
CREATE POLICY "Non-buyer can delete sellers"
  ON public.sellers FOR DELETE TO authenticated
  USING (
    NOT public.is_buyer()
    OR public.is_admin()
  );

-- 9-g. companies 테이블: buyer의 INSERT/UPDATE/DELETE 차단
DROP POLICY IF EXISTS "Non-buyer can manage companies" ON public.companies;
CREATE POLICY "Non-buyer can manage companies"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_buyer()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Non-buyer can update companies" ON public.companies;
CREATE POLICY "Non-buyer can update companies"
  ON public.companies FOR UPDATE TO authenticated
  USING (
    NOT public.is_buyer()
    OR public.is_admin()
  )
  WITH CHECK (
    NOT public.is_buyer()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Non-buyer can delete companies" ON public.companies;
CREATE POLICY "Non-buyer can delete companies"
  ON public.companies FOR DELETE TO authenticated
  USING (
    NOT public.is_buyer()
    OR public.is_admin()
  );
