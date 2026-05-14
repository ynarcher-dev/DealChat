/**
 * utils.js — 프로젝트 전체에서 공유하는 순수 유틸리티 함수 모음
 *
 * 브라우저/Node 양쪽에서 동작하는 순수 함수만 포함합니다.
 * DOM 접근, Supabase 호출, jQuery 의존 코드는 넣지 않습니다.
 */

/**
 * HTML 특수 문자를 이스케이프합니다.
 * XSS 방지 목적으로 사용자 입력을 DOM에 삽입하기 전에 호출합니다.
 *
 * @param {*} unsafe - 이스케이프할 값 (문자열 외 타입은 String으로 변환)
 * @returns {string}
 */
export function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * escapeHtml과 동일하지만 줄바꿈(\n)을 <br>로 변환합니다.
 * 채팅 메시지처럼 멀티라인 텍스트를 HTML로 표시할 때 사용합니다.
 *
 * @param {*} text
 * @returns {string}
 */
export function escapeForDisplay(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

/**
 * 함수 호출을 delay ms 동안 지연시키는 디바운스 래퍼입니다.
 * 검색 입력처럼 빠른 연속 이벤트에서 마지막 호출만 실행할 때 사용합니다.
 *
 * @param {Function} fn - 래핑할 함수
 * @param {number} delay - 지연 시간 (밀리초)
 * @returns {Function}
 */
export function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 잘린 JSON 문자열을 닫히지 않은 괄호를 추가해 복구를 시도합니다.
 * AI 응답이 최대 토큰 한도로 잘렸을 때 JSON.parse 전에 호출합니다.
 *
 * @param {string} str - 불완전할 수 있는 JSON 문자열
 * @returns {string} 복구 시도된 JSON 문자열
 */
export function tryRepairJson(str) {
    let repaired = str.trim();

    // 마지막이 쉼표로 끝난다면 제거
    if (repaired.endsWith(',')) {
        repaired = repaired.slice(0, -1);
    }

    const stack = [];
    for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '{') stack.push('}');
        else if (repaired[i] === '[') stack.push(']');
        else if (repaired[i] === '}') {
            if (stack[stack.length - 1] === '}') stack.pop();
        } else if (repaired[i] === ']') {
            if (stack[stack.length - 1] === ']') stack.pop();
        }
    }

    // 닫히지 않은 괄호를 스택 역순으로 추가
    while (stack.length > 0) {
        repaired += stack.pop();
    }

    return repaired;
}

/**
 * 텍스트에서 식별 키워드를 글자 수에 맞춰 ○ 문자로 마스킹합니다.
 * 비밀유지 의무가 있는 정보를 표시할 때 사용하며, 공백과 줄바꿈은 유지합니다.
 *
 * @param {string} text - 원본 텍스트
 * @param {string[]} keywords - 마스킹할 키워드 배열
 * @returns {string}
 */
export function applyKeywordsMasking(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return text;
    let result = text;
    keywords.forEach(kw => {
        if (!kw) return;
        const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedKw, 'gi');
        result = result.replace(regex, (match) => maskWithCircles(match));
    });
    return result;
}

/**
 * 텍스트를 원문의 글자 수와 공백을 유지하며 ○ 문자로 치환합니다.
 *
 * @param {string} text - 치환할 텍스트
 * @returns {string}
 */
export function maskWithCircles(text) {
    if (!text) return "";
    return text.split('').map(char => (char === ' ' || char === '\n') ? char : '○').join('');
}


/**
 * 산업군 select 값을 최종 저장 문자열로 변환합니다.
 * '기타' 선택 시 직접 입력값을 검증하고 "기타: {값}" 형태로 반환합니다.
 *
 * @param {string} industryBase - select 요소의 현재 값
 * @param {string} otherVal - '기타' 선택 시 직접 입력된 값
 * @returns {{ value: string } | { error: string }}
 */
export function resolveIndustry(industryBase, otherVal) {
    if (!industryBase) return { error: '산업을 선택해주세요.' };
    if (industryBase === '기타') {
        const trimmed = (otherVal || '').trim();
        if (!trimmed) return { error: '기타 산업명을 직접 입력해주세요.' };
        return { value: `기타: ${trimmed}` };
    }
    return { value: industryBase };
}

/**
 * 관리 현황 칩 값을 최종 저장 문자열로 변환합니다.
 * '기타' 선택 시 직접 입력값을 검증하고 "기타: {값}" 형태로 반환합니다.
 *
 * @param {string} status - 선택된 칩의 data-value
 * @param {string} otherVal - '기타' 선택 시 직접 입력된 값
 * @returns {{ value: string } | { error: string }}
 */
export function resolveMgmtStatus(status, otherVal) {
    if (!status) return { error: '관리 현황을 선택해주세요.' };
    if (status === '기타') {
        const trimmed = (otherVal || '').trim();
        if (!trimmed) return { error: '기타 관리 현황을 직접 입력해주세요.' };
        return { value: `기타: ${trimmed}` };
    }
    return { value: status };
}

/**
 * 재무 데이터를 AI 컨텍스트용 텍스트로 변환합니다.
 *
 * 입력은 두 가지를 모두 받을 수 있음:
 *   - wire 포맷 { years: [str], items: [{ key, label, values: { yearStr: val } }] }
 *     → 항목 라벨이 영업손실/당기순손익 등으로 바뀌어도 그대로 반영됨 (권장)
 *   - 레거시 배열 [{year, revenue, profit, net_profit, ...}] (하위호환)
 *
 * @param {Object|Array} data
 * @returns {string}
 */
export function buildFinancialString(data) {
    if (!data) return '';

    // wire 포맷 — 라벨을 동적으로 사용
    if (!Array.isArray(data) && data.years && data.items) {
        return data.years
            .map(year => {
                const parts = [];
                data.items.forEach(item => {
                    const val = item.values && item.values[year];
                    if (val === '' || val == null) return;
                    parts.push(`${item.label} ${val}원`);
                });
                return parts.length ? `- ${year}년: ${parts.join(', ')}` : null;
            })
            .filter(Boolean)
            .join('\n');
    }

    // 레거시 배열 — 하위 호환
    if (Array.isArray(data) && data.length > 0) {
        return data
            .filter(r => r.year || r.revenue || r.profit || r.net_profit || r.net)
            .map(r => {
                const net = r.net_profit != null && r.net_profit !== '' ? r.net_profit : r.net;
                return `- ${r.year}년: 매출 ${r.revenue}원, 영업이익 ${r.profit}원, 순이익 ${net}원`;
            })
            .join('\n');
    }

    return '';
}

/**
 * 투자 데이터 배열을 AI 컨텍스트용 텍스트로 변환합니다.
 *
 * @param {Array<{year: string, stage: string, valuation: string, amount: string, investor: string}>} rows
 * @returns {string}
 */
export function buildInvestmentString(rows) {
    if (!rows || rows.length === 0) return '';
    return rows
        .filter(r => r.year || r.stage || r.valuation || r.amount || r.investor)
        .map(r => `- ${r.year}년: ${r.stage || '단계미상'}, 밸류 ${r.valuation}원, 투자금 ${r.amount}원, 투자사 ${r.investor}`)
        .join('\n');
}

/**
 * AI 채팅에 전달할 기업 컨텍스트 문자열을 조립합니다.
 *
 * @param {{ name: string, industry: string, summary: string, financialStr: string, investmentStr: string, financialAnalysis: string, managerMemo: string, ragContext: string }} info
 * @returns {string}
 */
export function buildChatContext({ name, industry, summary, financialStr, investmentStr, financialAnalysis, managerMemo, ragContext }) {
    return `
[기업 기본 정보]
기업명: ${name || ''}
분야: ${industry || ''}
요약: ${summary || ''}

[재무 데이터]
${financialStr || '(등록된 데이터 없음)'}

[투자 데이터]
${investmentStr || '(등록된 데이터 없음)'}

[재무 분석 및 코멘트]
${financialAnalysis || ''}

[매니저 메모]
${managerMemo || ''}

[관련 문서/파일 참고 자료]
${ragContext || ''}
`.trim();
}

/**
 * 주어진 타임스탬프가 현재 시각 기준 지정한 시간(시간 단위) 이내인지 판단합니다.
 * 리스트의 "NEW" 뱃지 표시 여부 판단 등에 사용합니다.
 *
 * @param {string|number|Date} timestamp - ISO 문자열, epoch ms, Date 객체 모두 허용
 * @param {number} [hours=72] - 윈도우 길이(시간). 기본 72시간
 * @returns {boolean}
 */
export function isWithinHours(timestamp, hours = 72) {
    if (!timestamp) return false;
    const t = new Date(timestamp).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < hours * 3600 * 1000;
}

/**
 * 재무 데이터에서 가장 최근 연도의 매출액을 찾아 억 단위 범위(Range) 텍스트로 변환합니다.
 * @param {Object} data - financial_info 객체 ({ years: [...], items: [...] })
 * @returns {string} - 예: "50~100" 또는 "-"
 */
export function getRevenueRange(data) {
    if (!data || !data.years || !data.items || data.years.length === 0) return '-';

    let latestYear = null;
    const numericYears = data.years.map(y => parseInt(y, 10)).filter(n => !isNaN(n));
    if (numericYears.length > 0) {
        latestYear = String(Math.max(...numericYears));
    } else {
        latestYear = data.years[data.years.length - 1];
    }

    if (!latestYear) return '-';

    const matched = data.items.find(item => item.label && item.label.includes('매출'));
    if (!matched || !matched.values) return '-';

    const rawVal = matched.values[latestYear];
    if (rawVal === null || rawVal === undefined || rawVal === '' || rawVal === '-' || rawVal === '—') return '-';

    const cleaned = String(rawVal).replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    if (isNaN(num)) return '-';

    const eok = num / 100000000;
    
    if (eok < 5) return '5 미만';
    if (eok < 10) return '5~10';
    if (eok < 30) return '10~30';
    if (eok < 50) return '30~50';
    if (eok < 100) return '50~100';
    if (eok < 300) return '100~300';
    if (eok < 500) return '300~500';
    if (eok < 1000) return '500~1,000';
    return '1,000 이상';
}
