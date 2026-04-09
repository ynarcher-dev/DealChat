-- 20260409150500_update_qna_table_schema.sql
-- qna 테이블에 상담문의(Contact Us)를 위한 컬럼 추가

DO $$ 
BEGIN
    -- inquiry_type 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='inquiry_type') THEN
        ALTER TABLE public.qna ADD COLUMN inquiry_type TEXT;
    END IF;

    -- name 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='name') THEN
        ALTER TABLE public.qna ADD COLUMN name TEXT;
    END IF;

    -- contact 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='contact') THEN
        ALTER TABLE public.qna ADD COLUMN contact TEXT;
    END IF;

    -- email 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='email') THEN
        ALTER TABLE public.qna ADD COLUMN email TEXT;
    END IF;

    -- company_name 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='company_name') THEN
        ALTER TABLE public.qna ADD COLUMN company_name TEXT;
    END IF;

    -- subject 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='subject') THEN
        ALTER TABLE public.qna ADD COLUMN subject TEXT;
    END IF;

    -- content 컬럼 추가
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='qna' AND column_name='content') THEN
        ALTER TABLE public.qna ADD COLUMN content TEXT;
    END IF;

    -- question 컬럼의 NOT NULL 제약 조건 제거 (하위 호환성을 위해 nullable로 변경)
    ALTER TABLE public.qna ALTER COLUMN question DROP NOT NULL;
END $$;

COMMENT ON COLUMN public.qna.inquiry_type IS '문의 유형 (인수자, 에이전트 등)';
COMMENT ON COLUMN public.qna.name IS '문의자 이름';
COMMENT ON COLUMN public.qna.contact IS '연락처';
COMMENT ON COLUMN public.qna.email IS '이메일';
COMMENT ON COLUMN public.qna.company_name IS '업체명/소속';
COMMENT ON COLUMN public.qna.subject IS '문의 제목';
COMMENT ON COLUMN public.qna.content IS '문의 내용';
