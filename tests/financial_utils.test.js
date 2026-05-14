/**
 * financial_utils.js 테스트 — 라벨 인식형 재무정보 마이그레이션
 *
 * 검증 대상: migrateFinancialInfo, toFinancialArray (순수 함수 부분)
 *   - 영업이익/영업손익/영업손실 라벨에 따른 부호 처리
 *   - 행 라벨 결정 (단일·통합·최빈)
 *   - 레거시 호환 (_label 필드 없는 기존 데이터)
 *   - wire 포맷 라운드트립
 */
import { migrateFinancialInfo, toFinancialArray } from '../js/financial_utils.js';

// 헬퍼: 결과에서 특정 key의 항목을 찾는다
function findItem(result, key) {
    return result.items.find(it => it.key === key);
}

describe('migrateFinancialInfo — 레거시 배열 + 라벨 인식', () => {
    test('단일 라벨이 "영업손실"이면 행 라벨이 "영업손실"이 되고 값은 양수 그대로 (이중 부정 방지)', () => {
        const aiOutput = [
            { year: '2023', revenue: '1000', profit: '100', profit_label: '영업손실', net_profit: '50', net_profit_label: '당기순손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        const netProfit = findItem(result, 'net_profit');

        // "영업손실"이라는 라벨이 이미 음의 부호 의미를 담고 있으므로 값은 양수 절댓값
        expect(profit.label).toBe('영업손실');
        expect(profit.vals).toEqual(['100']);
        expect(netProfit.label).toBe('당기순손실');
        expect(netProfit.vals).toEqual(['50']);
    });

    test('영업이익 라벨이면 값은 양수 그대로', () => {
        const aiOutput = [
            { year: '2023', profit: '100', profit_label: '영업이익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업이익');
        expect(profit.vals).toEqual(['100']);
    });

    test('연도별 라벨이 섞이면(이익/손실) 통합 라벨 "영업손익" 사용하고 부호는 연도별로 적용', () => {
        const aiOutput = [
            { year: '2022', profit: '100', profit_label: '영업이익' },
            { year: '2023', profit: '50',  profit_label: '영업손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업손익');
        // 연도는 최신순(내림차순) 정렬: [2023, 2022]
        expect(result.years).toEqual(['2023', '2022']);
        expect(profit.vals).toEqual(['-50', '100']);
    });

    test('당기순이익도 동일하게 통합 라벨 "당기순손익" 사용', () => {
        const aiOutput = [
            { year: '2022', net_profit: '30', net_profit_label: '당기순이익' },
            { year: '2023', net_profit: '20', net_profit_label: '당기순손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        expect(np.label).toBe('당기순손익');
        // 연도는 최신순(내림차순) 정렬: [2023, 2022]
        expect(result.years).toEqual(['2023', '2022']);
        expect(np.vals).toEqual(['-20', '30']);
    });

    test('단일 손실 라벨일 때 괄호/△ 표기는 절댓값으로 정규화 (라벨이 부호 의미 담당)', () => {
        const aiOutput = [
            { year: '2023', profit: '(100)',  profit_label: '영업손실' },
            { year: '2022', profit: '△80',    profit_label: '영업손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        // 연도는 최신순(내림차순) 정렬: [2023, 2022]. 행 라벨이 "영업손실"이므로 값은 양수 절댓값
        expect(result.years).toEqual(['2023', '2022']);
        expect(profit.vals).toEqual(['100', '80']);
        expect(profit.label).toBe('영업손실');
    });

    test('레거시 데이터 (_label 필드 없음) — 기본 라벨과 원본 값 그대로', () => {
        const legacy = [
            { year: '2023', revenue: '1000', profit: '100', net_profit: '50' },
        ];
        const result = migrateFinancialInfo(legacy);
        expect(findItem(result, 'profit').label).toBe('영업이익');
        expect(findItem(result, 'profit').vals).toEqual(['100']);
        expect(findItem(result, 'net_profit').label).toBe('당기순이익');
        expect(findItem(result, 'net_profit').vals).toEqual(['50']);
    });

    test('레거시 데이터에 음수가 이미 있으면 그대로 유지 (라벨이 없으면 값 보존)', () => {
        const legacy = [
            { year: '2023', profit: '-100', net_profit: '-50' },
        ];
        const result = migrateFinancialInfo(legacy);
        // _label 필드 없으면 절대 부호 변환 안 함 — 기존 DB 데이터 보존
        expect(findItem(result, 'profit').vals).toEqual(['-100']);
        expect(findItem(result, 'profit').label).toBe('영업이익');
        expect(findItem(result, 'net_profit').vals).toEqual(['-50']);
        expect(findItem(result, 'net_profit').label).toBe('당기순이익');
    });

    test('매출/총자산/총부채/총자본은 라벨 인식 대상이 아니어서 부호 변환 없음', () => {
        const data = [
            { year: '2023', revenue: '-1000', total_assets: '500', total_liabilities: '300', total_equity: '200' },
        ];
        const result = migrateFinancialInfo(data);
        expect(findItem(result, 'revenue').label).toBe('매출액');
        expect(findItem(result, 'revenue').vals).toEqual(['-1000']);
        expect(findItem(result, 'total_assets').vals).toEqual(['500']);
    });

    test('AI가 잘못된 라벨("법인세비용차감전손익")로 net_profit을 채워도 거부 — 값까지 버려짐', () => {
        const aiOutput = [
            { year: '2023',
              revenue: '1000',
              profit: '100', profit_label: '영업이익',
              net_profit: '50509740', net_profit_label: '법인세비용차감전손익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        // 라벨이 "당기순"으로 시작하지 않으므로 거부 → 기본 라벨 + 빈 값
        expect(np.label).toBe('당기순이익');
        expect(np.vals).toEqual(['']);
        // 다른 항목은 영향받지 않음
        expect(findItem(result, 'profit').label).toBe('영업이익');
        expect(findItem(result, 'profit').vals).toEqual(['100']);
        expect(findItem(result, 'revenue').vals).toEqual(['1000']);
    });

    test('profit_label이 "계속영업이익" / "중단영업이익"이면 거부 (별도 라인이므로)', () => {
        const aiOutput = [
            { year: '2023', profit: '200', profit_label: '계속영업이익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const p = findItem(result, 'profit');
        expect(p.label).toBe('영업이익');
        expect(p.vals).toEqual(['']);
    });

    test('정상 라벨 변형은 통과 — "영업이익(손실)"', () => {
        const aiOutput = [
            { year: '2023', profit: '100', profit_label: '영업이익(손실)' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const p = findItem(result, 'profit');
        expect(p.label).toBe('영업이익(손실)');
        expect(p.vals).toEqual(['100']);
    });

    test('정상 라벨 변형은 통과 — "당기순이익(손실)"', () => {
        const aiOutput = [
            { year: '2023', net_profit: '50', net_profit_label: '당기순이익(손실)' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        expect(np.label).toBe('당기순이익(손실)');
        expect(np.vals).toEqual(['50']);
    });

    test('profit/net_profit 라벨이 서로 뒤바뀐 경우도 거부', () => {
        const aiOutput = [
            { year: '2023', profit: '100', profit_label: '당기순이익', net_profit: '50', net_profit_label: '영업이익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        // profit에 "당기순"이 들어오면 거부; net_profit에 "영업"이 들어오면 거부
        expect(findItem(result, 'profit').vals).toEqual(['']);
        expect(findItem(result, 'net_profit').vals).toEqual(['']);
    });

    test('일부 연도만 잘못된 라벨이면 해당 연도만 비우고 나머지는 보존', () => {
        const aiOutput = [
            { year: '2022', net_profit: '30', net_profit_label: '당기순이익' },
            { year: '2023', net_profit: '50', net_profit_label: '법인세비용차감전손익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        // 2022만 유효 → 행 라벨 "당기순이익", 2023은 빈 칸. 연도는 최신순(내림차순): [2023, 2022]
        expect(np.label).toBe('당기순이익');
        expect(result.years).toEqual(['2023', '2022']);
        expect(np.vals).toEqual(['', '30']);
    });

    test('빈/null 입력 → 빈 데이터 반환', () => {
        expect(migrateFinancialInfo(null).years).toEqual(['']);
        expect(migrateFinancialInfo([]).years).toEqual(['']);
        expect(migrateFinancialInfo(undefined).years).toEqual(['']);
    });

    test('연도가 5개 초과면 최신 5개만 남고 내림차순 정렬', () => {
        const data = ['2020','2021','2022','2023','2024','2025'].map(y => ({ year: y, profit: '10', profit_label: '영업이익' }));
        const result = migrateFinancialInfo(data);
        // 최신 5개를 최신순으로 유지
        expect(result.years).toEqual(['2025','2024','2023','2022','2021']);
    });
});

describe('migrateFinancialInfo — wire 포맷', () => {
    test('wire 입력은 라벨을 그대로 유지하고 값도 그대로 (사용자 수정본 보존)', () => {
        const wire = {
            years: ['2023'],
            items: [
                { key: 'profit', label: '영업손실', values: { '2023': '-100' } },
            ],
        };
        const result = migrateFinancialInfo(wire);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업손실');
        expect(profit.vals).toEqual(['-100']);
    });

    test('wire 입력의 연도 순서가 뒤섞여 있어도 최신순(내림차순)으로 정렬되고 값도 함께 재배치', () => {
        const wire = {
            years: ['2021', '2023', '2022'],
            items: [
                { key: 'revenue', label: '매출액', values: { '2021': '100', '2022': '200', '2023': '300' } },
            ],
        };
        const result = migrateFinancialInfo(wire);
        expect(result.years).toEqual(['2023', '2022', '2021']);
        expect(findItem(result, 'revenue').vals).toEqual(['300', '200', '100']);
    });
});

describe('toFinancialArray', () => {
    test('wire 포맷 → 레거시 배열 (라벨은 손실되지만 key→값 매핑 유지)', () => {
        const wire = {
            years: ['2023'],
            items: [
                { key: 'profit', label: '영업손실', values: { '2023': '-100' } },
                { key: 'revenue', label: '매출액', values: { '2023': '1000' } },
            ],
        };
        const arr = toFinancialArray(wire);
        expect(arr).toEqual([{ year: '2023', profit: '-100', revenue: '1000' }]);
    });

    test('이미 배열이면 그대로 반환', () => {
        const arr = [{ year: '2023', profit: '100' }];
        expect(toFinancialArray(arr)).toBe(arr);
    });

    test('null/undefined → 빈 배열', () => {
        expect(toFinancialArray(null)).toEqual([]);
        expect(toFinancialArray(undefined)).toEqual([]);
    });
});
