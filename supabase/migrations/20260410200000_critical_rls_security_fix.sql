-- [DealChat] CRITICAL 보안 수정 - RLS 정책 강화
-- 보안 감사 1단계: CRITICAL #1~#5 수정
-- 날짜: 2026-04-10

-- ============================================================
-- FIX #1: sellers/companies RLS USING(true) → is_draft 기반 제한
-- 문제: 20260410173000_fix_sellers_rls.sql에서 authenticated에 USING(true) 설정
--       → draft(비공개) 항목까지 모든 인증 사용자에게 노출
-- 수정: 공개 항목만 조회 허용, 소유자/admin은 전체 조회 가능
-- ============================================================

-- 1-a. sellers: 기존 USING(true) 정책 제거 후 재생성
DROP POLICY IF EXISTS "Anyone can select sellers" ON public.sellers;
CREATE POLICY "Authenticated can select public sellers"
  ON public.sellers FOR SELECT TO authenticated
  USING (
    is_draft = FALSE
    OR auth.uid() = user_id
    OR public.is_admin()
  );

-- 1-b. companies: 동일하게 수정
DROP POLICY IF EXISTS "Anyone can select companies" ON public.companies;
CREATE POLICY "Authenticated can select public companies"
  ON public.companies FOR SELECT TO authenticated
  USING (
    is_draft = FALSE
    OR auth.uid() = user_id
    OR public.is_admin()
  );

-- 1-c. users: authenticated USING(true) → 인증 사용자 간 조회 허용 (내부 도구이므로)
-- users 테이블은 is_draft 개념 없으므로, 인증된 사용자끼리는 조회 허용 유지
-- 단, 기존 schema_v2의 "self or admin" 정책과 충돌하지 않도록 정리
DROP POLICY IF EXISTS "Anyone can select users" ON public.users;
-- 기존 schema_v2 정책("Users can see themselves or admin sees all")이 살아있으므로
-- 인증 사용자 전체 조회를 위해 별도 정책 추가 (담당자 표시에 필요)
CREATE POLICY "Authenticated users can see all users"
  ON public.users FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- FIX #2: external_share_logs UPDATE 완전 개방 → 서버 함수로 대체
-- 문제: FOR UPDATE USING(true) WITH CHECK(true) → 누구나 share_key 탈취/리셋 가능
-- 수정: 기존 UPDATE 정책 제거 + SECURITY DEFINER 함수로 접근 횟수만 안전하게 증가
-- ============================================================

DROP POLICY IF EXISTS "Allow public update access count" ON public.external_share_logs;

-- 안전한 접근 카운터 함수: share_key 기반으로 access_count만 증가
CREATE OR REPLACE FUNCTION public.increment_share_access(p_share_key TEXT)
RETURNS JSONB AS $$
DECLARE
  v_share RECORD;
  v_result JSONB;
BEGIN
  -- share_key로 유효한 공유 레코드 조회
  SELECT id, access_count, expires_at
  INTO v_share
  FROM public.external_share_logs
  WHERE share_key = p_share_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Share not found');
  END IF;

  IF v_share.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Share expired');
  END IF;

  IF v_share.access_count >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access limit exceeded');
  END IF;

  -- access_count 증가 및 last_accessed_at 업데이트
  UPDATE public.external_share_logs
  SET access_count = access_count + 1,
      last_accessed_at = now()
  WHERE id = v_share.id;

  RETURN jsonb_build_object(
    'success', true,
    'access_count', v_share.access_count + 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- admin만 직접 UPDATE 가능 (관리 목적)
CREATE POLICY "Only admin can update share logs"
  ON public.external_share_logs FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- FIX #3: 일반 유저 → admin 권한 상승 차단
-- 문제: users UPDATE 정책이 auth.uid() = id 조건이라 자기 role을 admin으로 변경 가능
-- 수정: role/status 변경 시 admin만 허용하는 트리거 추가
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- role 변경 시도 감지
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can change user roles';
    END IF;
  END IF;

  -- status 변경 시도 감지 (승인 상태도 보호)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can change user status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS check_role_escalation ON public.users;
CREATE TRIGGER check_role_escalation
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- ============================================================
-- FIX #4: files 테이블 RLS 활성화 및 정책 추가
-- 문제: ENABLE ROW LEVEL SECURITY 누락 → 모든 인증 사용자가 모든 파일 접근
-- 수정: RLS 활성화 + 소유자/admin/엔티티 소유자만 접근 가능
-- ============================================================

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- 파일 업로더 본인은 모든 작업 가능
CREATE POLICY "Users can manage their own files"
  ON public.files FOR ALL TO authenticated
  USING (auth.uid() = user_id);

-- admin은 모든 파일 조회 가능
CREATE POLICY "Admin can see all files"
  ON public.files FOR SELECT TO authenticated
  USING (public.is_admin());

-- 공개 seller/company/buyer에 연결된 파일은 인증 사용자가 조회 가능
CREATE POLICY "Authenticated can see files of public entities"
  ON public.files FOR SELECT TO authenticated
  USING (
    (entity_type = 'seller' AND EXISTS (
      SELECT 1 FROM public.sellers WHERE id = files.entity_id AND is_draft = FALSE
    ))
    OR (entity_type = 'company' AND EXISTS (
      SELECT 1 FROM public.sellers s
      JOIN public.companies c ON c.id = s.company_id
      WHERE c.id = files.entity_id AND s.is_draft = FALSE
    ))
    OR (entity_type = 'buyer' AND EXISTS (
      SELECT 1 FROM public.buyers WHERE id = files.entity_id AND is_draft = FALSE
    ))
  );

-- ============================================================
-- FIX #5: anon users 테이블 USING(true) → 외부 공유 관련 사용자만 허용
-- 문제: anon이 users 테이블 전체 조회 가능 → 모든 사용자 정보 노출
-- 수정: 외부 공유된 항목의 담당자(user_id)만 조회 허용
-- ============================================================

DROP POLICY IF EXISTS "Anon can select users for shared context" ON public.users;
CREATE POLICY "Anon can select users for shared context"
  ON public.users FOR SELECT TO anon
  USING (
    -- 외부 공유된 seller의 담당자
    EXISTS (
      SELECT 1 FROM public.sellers s
      JOIN public.external_share_logs esl ON esl.item_id = s.id
      WHERE s.user_id = users.id
        AND esl.item_type = 'seller'
        AND esl.expires_at > now()
        AND esl.access_count < 3
    )
    -- 외부 공유된 company의 담당자
    OR EXISTS (
      SELECT 1 FROM public.companies c
      JOIN public.sellers s ON s.company_id = c.id
      JOIN public.external_share_logs esl ON esl.item_id = s.id
      WHERE c.user_id = users.id
        AND esl.item_type = 'seller'
        AND esl.expires_at > now()
        AND esl.access_count < 3
    )
    -- 외부 공유된 buyer의 담당자
    OR EXISTS (
      SELECT 1 FROM public.external_share_logs esl
      JOIN public.buyers b ON b.id = esl.item_id
      WHERE b.user_id = users.id
        AND esl.item_type = 'buyer'
        AND esl.expires_at > now()
        AND esl.access_count < 3
    )
  );
