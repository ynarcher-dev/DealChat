-- companies.establishment_date 컬럼을 DATE에서 TEXT로 변경
-- 사용자가 설립일자를 자유 텍스트로 입력할 수 있도록 하고,
-- 입력하지 않은 경우 '-'로 저장하도록 한다.

ALTER TABLE public.companies
ALTER COLUMN establishment_date TYPE TEXT
USING COALESCE(establishment_date::TEXT, '-');

-- 기존에 NULL이었던 행들을 '-'로 채운다.
UPDATE public.companies
SET establishment_date = '-'
WHERE establishment_date IS NULL OR establishment_date = '';

COMMENT ON COLUMN public.companies.establishment_date IS '설립일자 (자유 텍스트, 미입력 시 ''-'')';
