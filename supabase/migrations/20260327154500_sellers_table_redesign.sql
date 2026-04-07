-- [DealChat DB Redesign] Sellers 테이블 독립성 확보 및 데이터 복제 마이그레이션
-- 매도인(Seller) 등록 시 연동된 기업(Company) 정보를 참조만 하는 것이 아니라, 
-- 직접 테이블로 복사해와서 원본 기업 정보가 변해도 매도 당시 데이터를 유지하도록 개선합니다.

ALTER TABLE IF EXISTS public.sellers
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS ceo_name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS establishment_date TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS financial_info JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS financial_analysis TEXT;

-- 기존 데이터(company_id 기반 참조 중인 건들)를 일괄 복사 (마이그레이션)
UPDATE public.sellers s
SET 
  name = c.name,
  industry = c.industry,
  ceo_name = c.ceo_name,
  email = c.email,
  establishment_date = COALESCE(c.establishment_date::TEXT, ''),
  address = c.address,
  summary = c.summary,
  financial_info = COALESCE(c.financial_info, '[]'::jsonb),
  financial_analysis = c.financial_analysis
FROM public.companies c
WHERE s.company_id = c.id
AND (s.name IS NULL OR s.name = '');

COMMENT ON COLUMN public.sellers.name IS '매도 기업명 (독립 보관용)';
COMMENT ON COLUMN public.sellers.industry IS '산업 분야 (독립 보관용)';
COMMENT ON COLUMN public.sellers.ceo_name IS '대표자명 (독립 보관용)';
COMMENT ON COLUMN public.sellers.email IS '회사 이메일 (독립 보관용)';
COMMENT ON COLUMN public.sellers.establishment_date IS '설립일자 (독립 보관용)';
COMMENT ON COLUMN public.sellers.address IS '회사 주소 (독립 보관용)';
COMMENT ON COLUMN public.sellers.summary IS '회사 소개 (독립 보관용)';
COMMENT ON COLUMN public.sellers.financial_info IS '재무 정보 (JSONB 배열, 독립 보관용)';
COMMENT ON COLUMN public.sellers.financial_analysis IS '재무 분석 의견 (독립 보관용)';
