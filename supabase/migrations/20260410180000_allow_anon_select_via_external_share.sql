-- [DealChat] 외부 공유 링크를 통한 비로그인(anon) 사용자 데이터 조회 허용
-- 문제: 외부 공유 URL 생성 후 다른 브라우저(비로그인)에서 접속 시
--       sellers/buyers/companies 테이블의 RLS가 anon 접근을 차단하여
--       "정보를 찾을 수 없거나 접근 권한이 없습니다" 오류 발생
-- 해결: external_share_logs에 유효한(미만료, 접근횟수 3회 미만) 공유 기록이 있는 경우
--       해당 item에 대해 anon SELECT를 허용하는 RLS 정책 추가

-- 1. sellers 테이블: 유효한 외부 공유 링크가 있는 경우 anon SELECT 허용
DROP POLICY IF EXISTS "Anon can select externally shared sellers" ON public.sellers;
CREATE POLICY "Anon can select externally shared sellers" ON public.sellers
    FOR SELECT TO anon USING (
        EXISTS (
            SELECT 1 FROM public.external_share_logs esl
            WHERE esl.item_id = sellers.id
              AND esl.item_type = 'seller'
              AND esl.expires_at > now()
              AND esl.access_count < 3
        )
    );

-- 2. buyers 테이블: 유효한 외부 공유 링크가 있는 경우 anon SELECT 허용
DROP POLICY IF EXISTS "Anon can select externally shared buyers" ON public.buyers;
CREATE POLICY "Anon can select externally shared buyers" ON public.buyers
    FOR SELECT TO anon USING (
        EXISTS (
            SELECT 1 FROM public.external_share_logs esl
            WHERE esl.item_id = buyers.id
              AND esl.item_type = 'buyer'
              AND esl.expires_at > now()
              AND esl.access_count < 3
        )
    );

-- 3. companies 테이블: 유효한 외부 공유 링크가 있는 경우 anon SELECT 허용
--    (sellers 조인 시 companies 데이터도 필요하므로 seller/company 모두 체크)
DROP POLICY IF EXISTS "Anon can select externally shared companies" ON public.companies;
CREATE POLICY "Anon can select externally shared companies" ON public.companies
    FOR SELECT TO anon USING (
        EXISTS (
            SELECT 1 FROM public.external_share_logs esl
            WHERE esl.item_id = companies.id
              AND esl.item_type = 'company'
              AND esl.expires_at > now()
              AND esl.access_count < 3
        )
        OR EXISTS (
            SELECT 1 FROM public.external_share_logs esl
            JOIN public.sellers s ON s.id = esl.item_id
            WHERE s.company_id = companies.id
              AND esl.item_type = 'seller'
              AND esl.expires_at > now()
              AND esl.access_count < 3
        )
    );

-- 4. users 테이블: 외부 공유 시 작성자 정보 표시를 위해 anon SELECT 허용
--    (dealbook_companies.js에서 users 테이블을 조인하여 작성자 정보를 표시)
DROP POLICY IF EXISTS "Anon can select users for shared context" ON public.users;
CREATE POLICY "Anon can select users for shared context" ON public.users
    FOR SELECT TO anon USING (true);
