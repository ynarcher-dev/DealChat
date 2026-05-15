/**
 * financial_utils.js 테스트 — 라벨 인식형 재무정보 마이그레이션
 *
 * 검증 대상: migrateFinancialInfo, toFinancialArray (순수 함수 부분)
 *   - profit / net_profit 행 라벨은 항상 통합 라벨("영업손익" / "당기순손익")
 *   - 부호는 표준 컨벤션: 양수 = 이익, 음수 = 손실 (AI 라벨이 손실이면 음수로 변환)
 *   - 레거시 호환 (_label 필드 없는 기존 데이터: 값 보존)
 *   - 레거시 wire 손실 라벨 정규화 (예: "영업손실" 라벨 + 양수 → 통합 라벨 + 음수)
 */
import { migrateFinancialInfo, toFinancialArray, mergeFinancialData } from '../js/financial_utils.js';

// 헬퍼: 결과에서 특정 key의 항목을 찾는다
function findItem(result, key) {
    return result.items.find(it => it.key === key);
}

describe('migrateFinancialInfo — 레거시 배열 + 라벨 인식', () => {
    test('단일 손실 라벨이어도 행 라벨은 통합 라벨 + 값은 음수로 표준 부호 변환', () => {
        const aiOutput = [
            { year: '2023', revenue: '1000', profit: '100', profit_label: '영업손실', net_profit: '50', net_profit_label: '당기순손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        const netProfit = findItem(result, 'net_profit');

        expect(profit.label).toBe('영업손익');
        expect(profit.vals).toEqual(['-100']);
        expect(netProfit.label).toBe('당기순손익');
        expect(netProfit.vals).toEqual(['-50']);
    });

    test('영업이익 라벨이면 행 라벨은 통합 라벨 + 값은 양수 그대로', () => {
        const aiOutput = [
            { year: '2023', profit: '100', profit_label: '영업이익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업손익');
        expect(profit.vals).toEqual(['100']);
    });

    test('연도별 라벨이 섞이면 통합 라벨 + 부호는 연도별로 적용', () => {
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

    test('당기순이익도 동일하게 통합 라벨 + 연도별 부호', () => {
        const aiOutput = [
            { year: '2022', net_profit: '30', net_profit_label: '당기순이익' },
            { year: '2023', net_profit: '20', net_profit_label: '당기순손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        expect(np.label).toBe('당기순손익');
        expect(result.years).toEqual(['2023', '2022']);
        expect(np.vals).toEqual(['-20', '30']);
    });

    test('손실 라벨의 괄호/△ 표기는 절댓값을 음수로 변환 (표준 부호로 정규화)', () => {
        const aiOutput = [
            { year: '2023', profit: '(100)',  profit_label: '영업손실' },
            { year: '2022', profit: '△80',    profit_label: '영업손실' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const profit = findItem(result, 'profit');
        expect(result.years).toEqual(['2023', '2022']);
        expect(profit.label).toBe('영업손익');
        expect(profit.vals).toEqual(['-100', '-80']);
    });

    test('레거시 데이터 (_label 필드 없음) — 통합 라벨 + 원본 값 그대로 보존', () => {
        const legacy = [
            { year: '2023', revenue: '1000', profit: '100', net_profit: '50' },
        ];
        const result = migrateFinancialInfo(legacy);
        expect(findItem(result, 'profit').label).toBe('영업손익');
        expect(findItem(result, 'profit').vals).toEqual(['100']);
        expect(findItem(result, 'net_profit').label).toBe('당기순손익');
        expect(findItem(result, 'net_profit').vals).toEqual(['50']);
    });

    test('레거시 데이터에 음수가 이미 있으면 그대로 유지 (라벨이 없으면 값 보존)', () => {
        const legacy = [
            { year: '2023', profit: '-100', net_profit: '-50' },
        ];
        const result = migrateFinancialInfo(legacy);
        // _label 필드 없으면 부호 변환 안 함 — 기존 DB 데이터 보존
        expect(findItem(result, 'profit').vals).toEqual(['-100']);
        expect(findItem(result, 'profit').label).toBe('영업손익');
        expect(findItem(result, 'net_profit').vals).toEqual(['-50']);
        expect(findItem(result, 'net_profit').label).toBe('당기순손익');
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
        // 잘못된 라벨 → 거부 → 통합 라벨 + 빈 값
        expect(np.label).toBe('당기순손익');
        expect(np.vals).toEqual(['']);
        // 다른 항목은 영향받지 않음
        expect(findItem(result, 'profit').label).toBe('영업손익');
        expect(findItem(result, 'profit').vals).toEqual(['100']);
        expect(findItem(result, 'revenue').vals).toEqual(['1000']);
    });

    test('profit_label이 "계속영업이익" / "중단영업이익"이면 거부 (별도 라인이므로)', () => {
        const aiOutput = [
            { year: '2023', profit: '200', profit_label: '계속영업이익' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const p = findItem(result, 'profit');
        expect(p.label).toBe('영업손익');
        expect(p.vals).toEqual(['']);
    });

    test('정상 라벨 변형은 통과 — "영업이익(손실)" → 통합 라벨 + 양수', () => {
        const aiOutput = [
            { year: '2023', profit: '100', profit_label: '영업이익(손실)' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const p = findItem(result, 'profit');
        expect(p.label).toBe('영업손익');
        expect(p.vals).toEqual(['100']);
    });

    test('정상 라벨 변형은 통과 — "당기순이익(손실)" → 통합 라벨 + 양수', () => {
        const aiOutput = [
            { year: '2023', net_profit: '50', net_profit_label: '당기순이익(손실)' },
        ];
        const result = migrateFinancialInfo(aiOutput);
        const np = findItem(result, 'net_profit');
        expect(np.label).toBe('당기순손익');
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
        // 2022만 유효 → 통합 라벨, 2023은 빈 칸. 연도는 최신순(내림차순): [2023, 2022]
        expect(np.label).toBe('당기순손익');
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
    test('레거시 wire에 단일 손실 라벨 + 양수 저장이면 통합 라벨 + 음수로 마이그레이션', () => {
        const wire = {
            years: ['2023'],
            items: [
                { key: 'profit', label: '영업손실', values: { '2023': '100' } },
            ],
        };
        const result = migrateFinancialInfo(wire);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업손익');
        expect(profit.vals).toEqual(['-100']);
    });

    test('이미 표준 부호로 저장된 wire (통합 라벨 + 음수)는 그대로 유지', () => {
        const wire = {
            years: ['2023'],
            items: [
                { key: 'profit', label: '영업손익', values: { '2023': '-100' } },
            ],
        };
        const result = migrateFinancialInfo(wire);
        const profit = findItem(result, 'profit');
        expect(profit.label).toBe('영업손익');
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

describe('mergeFinancialData', () => {
    const existingWire = {
        years: ['2023', '2022'],
        items: [
            { key: 'revenue', label: '매출액', values: { '2023': '1000', '2022': '800' } },
            { key: 'profit', label: '영업손익', values: { '2023': '100', '2022': '80' } }
        ]
    };

    test('AI 값 있고 기존 비어있음 → AI 값 사용', () => {
        const aiLegacy = [{ year: '2023', revenue: '1200' }];
        const existing = {
            years: ['2023'],
            items: [{ key: 'revenue', label: '매출액', values: { '2023': '' } }]
        };
        const result = mergeFinancialData(existing, aiLegacy, 'sellers');
        expect(result.items.find(it => it.key === 'revenue').values['2023']).toBe('1200');
    });

    test('AI 값 비어있고 기존 값 있음 → 기존 값 유지', () => {
        const aiLegacy = [{ year: '2023', revenue: '' }]; // AI가 해당 항목을 못 찾음
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.items.find(it => it.key === 'revenue').values['2023']).toBe('1000');
    });

    test('AI/기존 둘 다 값 있음 → AI 값으로 덮어쓰기', () => {
        const aiLegacy = [{ year: '2023', revenue: '1500' }];
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.items.find(it => it.key === 'revenue').values['2023']).toBe('1500');
    });

    test('AI에 새 연도 추가 → 머지 결과에 포함', () => {
        const aiLegacy = [{ year: '2024', revenue: '2000' }];
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.years).toContain('2024');
        expect(result.items.find(it => it.key === 'revenue').values['2024']).toBe('2000');
        expect(result.items.find(it => it.key === 'revenue').values['2023']).toBe('1000'); // 기존 유지
    });

    test('기존에만 있는 연도 → 유지', () => {
        const aiLegacy = [{ year: '2024', revenue: '2000' }];
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.years).toContain('2022');
        expect(result.items.find(it => it.key === 'revenue').values['2022']).toBe('800');
    });

    test('profit_label="영업손실" + AI값 양수 → 머지 후 음수 부호 적용 (라벨 기반 부호 처리 보존)', () => {
        const aiLegacy = [{ year: '2023', profit: '50', profit_label: '영업손실' }];
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.items.find(it => it.key === 'profit').values['2023']).toBe('-50');
    });

    test('MAX_YEARS=5 초과 방지 및 내림차순 정렬', () => {
        const aiLegacy = [
            { year: '2026', revenue: '1' },
            { year: '2025', revenue: '2' },
            { year: '2024', revenue: '3' }
        ];
        // existingWire has 2023, 2022
        const result = mergeFinancialData(existingWire, aiLegacy, 'sellers');
        expect(result.years).toEqual(['2026', '2025', '2024', '2023', '2022']);
        
        const aiLegacy2 = [{ year: '2021', revenue: '6' }];
        const result2 = mergeFinancialData(result, aiLegacy2, 'sellers');
        expect(result2.years).toEqual(['2026', '2025', '2024', '2023', '2022']); // 2021 버려짐
    });
});
