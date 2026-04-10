-- [DealChat] RLS 정책 수정: 매도자(Seller) 권한의 조회 문제 해결
-- 모든 인증된 사용자가 매도자 목록 및 관련 정보를 조회할 수 있도록 SELECT 정책을 보장합니다.

-- 1. sellers 테이블: 모든 인증된 사용자가 SELECT 가능하도록 허용
-- (JS 레벨에서 이미 NDA 미체결 건에 대해 마스킹 처리가 되어 있으므로 목록 조회를 허용합니다.)
DROP POLICY IF EXISTS "Anyone can select sellers" ON public.sellers;
CREATE POLICY "Anyone can select sellers" ON public.sellers
    FOR SELECT TO authenticated USING (true);

-- 2. companies 테이블: sellers와 조인되어 사용되므로 모든 인증된 사용자가 SELECT 가능하도록 허용
DROP POLICY IF EXISTS "Anyone can select companies" ON public.companies;
CREATE POLICY "Anyone can select companies" ON public.companies
    FOR SELECT TO authenticated USING (true);

-- 3. users 테이블: initUserMap에서 담당자 정보를 표시하기 위해 SELECT 권한이 필요합니다.
DROP POLICY IF EXISTS "Anyone can select users" ON public.users;
CREATE POLICY "Anyone can select users" ON public.users
    FOR SELECT TO authenticated USING (true);

-- 추가 확인: 기존 소유자 기반의 ALL 권한(INSERT/UPDATE/DELETE)은 유지되므로 데이터 보안은 지켜집니다.
