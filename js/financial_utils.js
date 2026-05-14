/**
 * financial_utils.js
 * 재무 정보 전치 테이블 (가로=년도, 세로=항목) 유틸리티
 *
 * 내부 표현(편집 사이클): { years: [str], items: [{ key, label, vals: [str] }] }
 *   - vals 는 years 와 같은 길이의 위치 배열. 빈 년도/빈 라벨이 있어도 어긋나지 않음.
 * 외부 표현(저장/로드, wire): { years: [str], items: [{ key, label, values: { yearStr: val } }] }
 *   - collectFinancialData() 가 저장용으로 wire 포맷(빈 값 필터)을 돌려준다.
 *   - migrateFinancialInfo() 는 wire/레거시를 내부 표현으로 변환한다.
 *
 * mode:
 *   'companies' — 기존 6개 항목, 자유 편집
 *   'sellers'   — 손익/재무/현금흐름 섹션 + 자동 계산 행, 구조 고정
 */

const MAX_YEARS = 5;

// ── companies 모드 기본 항목 ────────────────────────────────────────────
const DEFAULT_ITEMS = [
    { key: 'revenue',           label: '매출액' },
    { key: 'profit',            label: '영업이익' },
    { key: 'net_profit',        label: '당기순이익' },
    { key: 'total_assets',      label: '총 자산' },
    { key: 'total_liabilities', label: '총 부채' },
    { key: 'total_equity',      label: '총 자본' },
];

// ── sellers 모드 항목 정의 ─────────────────────────────────────────────
//   type:'section'   → 섹션 구분선 (저장/수집 제외)
//   calculated:true  → 자동 계산 행 (저장/수집 제외, 읽기 전용)
//   isPercent:true   → 소수점 1자리 % 포맷으로 표시
const SELLER_DEFAULT_ITEMS = [
    // 손익계산서
    { type: 'section', label: '손익계산서' },
    { key: 'revenue',      label: '매출액' },
    { key: 'cogs',         label: '매출원가' },
    { key: 'gross_profit', label: '매출총이익',  calculated: true },
    { key: 'profit',       label: '영업이익' },
    { key: 'net_profit',   label: '당기순이익' },
    { key: 'op_margin',    label: '영업이익률',  calculated: true, isPercent: true },
    { key: 'net_margin',   label: '순이익률',    calculated: true, isPercent: true },
    // 재무상태표
    { type: 'section', label: '재무상태표' },
    { key: 'total_assets',      label: '총 자산' },
    { key: 'total_liabilities', label: '총 부채' },
    { key: 'total_equity',      label: '총 자본' },
    { key: 'cash',              label: '현금및현금성자산' },
    { key: 'short_term_debt',   label: '단기차입금' },
    { key: 'long_term_debt',    label: '장기차입금' },
    { key: 'total_debt',        label: '총 차입금',  calculated: true },
    { key: 'net_debt',          label: '순차입금',   calculated: true },
    { key: 'debt_ratio',        label: '부채비율',   calculated: true, isPercent: true },
    // 현금흐름표
    { type: 'section', label: '현금흐름표' },
    { key: 'ocf',   label: '영업활동현금흐름' },
    { key: 'capex', label: 'CAPEX' },
    { key: 'fcf',   label: 'FCF', calculated: true },
];

// sellers 모드에서 저장/수집 대상인 편집 항목만 (section·calculated 제외)
const SELLER_EDITABLE_ITEMS = SELLER_DEFAULT_ITEMS.filter(it => it.type !== 'section' && !it.calculated);

// ── 자동 계산 공식 ─────────────────────────────────────────────────────
//   v: { [key]: string } — 해당 연도의 편집 항목 raw 값 맵 (빈 문자열 = 미입력)
//   null 반환 시 '—' 로 표시
const SELLER_FORMULAS = {
    gross_profit: v => _n(v.revenue) - _n(v.cogs),
    op_margin:    v => _n(v.revenue) ? _n(v.profit)     / _n(v.revenue) * 100 : null,
    net_margin:   v => _n(v.revenue) ? _n(v.net_profit) / _n(v.revenue) * 100 : null,
    total_debt:   v => _n(v.short_term_debt) + _n(v.long_term_debt),
    net_debt:     v => _n(v.short_term_debt) + _n(v.long_term_debt) - _n(v.cash),
    debt_ratio:   v => _n(v.total_equity) ? _n(v.total_liabilities) / _n(v.total_equity) * 100 : null,
    fcf:          v => _n(v.ocf) - _n(v.capex),
};

// 각 계산 항목이 의존하는 편집 항목 키 목록
// — 이 키들이 모두 비어있으면 입력 자체가 없는 것으로 간주 → '—' 표시
const SELLER_FORMULA_DEPS = {
    gross_profit: ['revenue', 'cogs'],
    op_margin:    ['profit', 'revenue'],
    net_margin:   ['net_profit', 'revenue'],
    total_debt:   ['short_term_debt', 'long_term_debt'],
    net_debt:     ['short_term_debt', 'long_term_debt', 'cash'],
    debt_ratio:   ['total_liabilities', 'total_equity'],
    fcf:          ['ocf', 'capex'],
};

/** 문자열/빈 값을 안전하게 숫자로 변환 */
function _n(val) {
    if (val === '' || val === '—' || val === '-' || val == null) return 0;
    const n = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
}

/** 값이 실제로 입력되지 않은 빈 칸인지 확인 */
function _isEmpty(val) {
    return val === '' || val === '—' || val === '-' || val == null;
}

// ── LABEL_AWARE_KEYS: AI 추출 시 라벨·부호 처리 ────────────────────────
const LABEL_AWARE_KEYS = {
    profit: {
        unified: '영업손익',
        defaultLabel: '영업이익',
        invalidPatterns: [/법인세/, /차감전/, /계속영업/, /중단영업/, /당기순/, /순이익/, /순손실/, /순손익/],
    },
    net_profit: {
        unified: '당기순손익',
        defaultLabel: '당기순이익',
        invalidPatterns: [/법인세/, /차감전/, /계속영업/, /중단영업/, /^영업/],
    },
};

function isLossLabel(label) {
    return /손실/.test(String(label || ''));
}

function isInvalidLabelFor(key, label) {
    const meta = LABEL_AWARE_KEYS[key];
    if (!meta) return false;
    const l = String(label || '').trim();
    if (!l) return false;
    return meta.invalidPatterns.some(p => p.test(l));
}

function decideRowLabel(key, perYearLabels) {
    const meta = LABEL_AWARE_KEYS[key];
    if (!meta) return null;
    const labels = perYearLabels.filter(l => l && String(l).trim());
    if (labels.length === 0) return meta.defaultLabel;
    const unique = [...new Set(labels)];
    if (unique.length === 1) return unique[0];
    const hasLoss = labels.some(isLossLabel);
    const hasProfit = labels.some(l => !isLossLabel(l));
    if (hasLoss && hasProfit) return meta.unified;
    const freq = {};
    labels.forEach(l => { freq[l] = (freq[l] || 0) + 1; });
    return Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
}

function toAbsoluteValue(rawVal) {
    const s = String(rawVal == null ? '' : rawVal).replace(/,/g, '').trim();
    if (s === '' || s === '-') return '';
    const cleaned = s.replace(/[()△]/g, '').replace(/^-/, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return s;
    return String(Math.abs(num));
}

function applySignByLabel(rawVal, label) {
    const abs = toAbsoluteValue(rawVal);
    if (abs === '') return '';
    return isLossLabel(label) ? String(-Math.abs(parseFloat(abs))) : abs;
}

// ─────────────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────────────

/**
 * 외부에서 들어온 데이터(wire/레거시/null)를 내부 표현으로 변환
 * @param {*}      data  저장된 financial_info (wire/레거시/null)
 * @param {string} mode  'companies' | 'sellers'
 */
export function migrateFinancialInfo(data, mode = 'companies') {
    const baseItems = mode === 'sellers' ? SELLER_EDITABLE_ITEMS : DEFAULT_ITEMS;

    if (!data) return newEmptyFinancialData(mode);

    // wire 포맷 { years, items }
    if (!Array.isArray(data) && Array.isArray(data.years) && Array.isArray(data.items)) {
        return wireToInternal(data, baseItems);
    }

    // 레거시 배열 포맷 [{year, revenue, ...}]
    if (Array.isArray(data) && data.length > 0) {
        const years = [...new Set(data.map(f => String(f.year || '').trim()).filter(Boolean))]
            .sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0))
            .slice(0, MAX_YEARS);

        const items = baseItems.map(def => {
            const isLabelAware = !!LABEL_AWARE_KEYS[def.key];
            const labelKey = `${def.key}_label`;

            const perYearLabels = [];
            const rawVals = years.map(y => {
                const found = data.find(f => String(f.year || '').trim() === y);
                if (!found) { perYearLabels.push(''); return ''; }

                const rawLabel = found[labelKey] || '';
                const rawVal   = found[def.key];

                if (isLabelAware && isInvalidLabelFor(def.key, rawLabel)) {
                    perYearLabels.push('');
                    return '';
                }

                perYearLabels.push(rawLabel);
                return rawVal == null ? '' : String(rawVal);
            });

            const rowLabel = isLabelAware
                ? (decideRowLabel(def.key, perYearLabels) || def.label)
                : def.label;

            const meta = LABEL_AWARE_KEYS[def.key];
            const hasAnyLabel = perYearLabels.some(l => l && l.trim());
            const isUnifiedRow = !!(meta && rowLabel === meta.unified);

            const vals = rawVals.map((rawVal, idx) => {
                if (!rawVal) return '';
                if (!isLabelAware || !hasAnyLabel) return rawVal;
                if (isUnifiedRow) {
                    const yLabel = perYearLabels[idx] || rowLabel;
                    return applySignByLabel(rawVal, yLabel);
                }
                return toAbsoluteValue(rawVal);
            });

            return { key: def.key, label: rowLabel, vals };
        });

        return { years, items };
    }

    return newEmptyFinancialData(mode);
}

/**
 * 재무 전치 테이블 렌더
 * @param {object} data        migrateFinancialInfo() 결과
 * @param {string} containerId DOM 컨테이너 id
 * @param {string} mode        'companies' | 'sellers'
 */
export function renderFinancialTable(data, containerId = 'financial-table-container', mode = 'companies') {
    const $container = $(`#${containerId}`);
    if (!$container.length) return;

    const isSellers = mode === 'sellers';

    // 안전망: wire/레거시가 들어오면 변환
    const internal = (data && data.items && data.items[0] && Array.isArray(data.items[0].vals))
        ? data
        : migrateFinancialInfo(data, mode);

    const { years, items } = internal;

    $container.empty().removeData('report-applied');
    $container.data('render-mode', mode); // 재렌더 시 모드 유지용

    const $table = $(`<div class="fin-table" style="display:flex; flex-direction:column; gap:0;"></div>`);

    // ── 헤더 행 ──────────────────────────────────────────────────────────
    const $headerRow = $(`<div class="fin-header-row" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;"></div>`);

    $headerRow.append(`<div class="fin-label-cell fin-header-cell" style="
        flex:0 0 ${isSellers ? 140 : 120}px; min-width:${isSellers ? 140 : 120}px;
        font-size:11px; color:#64748b; font-weight:700;
        text-transform:uppercase; letter-spacing:0.02em; padding:8px 4px 8px 12px;">구분</div>`);

    years.forEach((y, idx) => {
        const $yearWrap = $(`<div style="flex:1; min-width:0; position:relative; display:flex; align-items:center; gap:2px;"></div>`);
        $yearWrap.append(`<input type="text" class="fin-year-header" data-index="${idx}" value="${escapeHtml(y)}" maxlength="4"
            style="flex:1; min-width:0; padding:6px 4px; border:1px solid #e2e8f0; border-radius:6px;
            font-size:12px; font-weight:700; text-align:center; background:#f8fafc; outline:none;"
            placeholder="연도">`);
        if (years.length > 1) {
            $yearWrap.append(`<button type="button" class="btn-remove-year" data-index="${idx}" title="년도 삭제"
                style="position:absolute; top:-6px; right:-4px; background:#fff; border:1px solid #e2e8f0; border-radius:50%;
                cursor:pointer; color:#94a3b8; width:16px; height:16px; padding:0; display:flex; align-items:center;
                justify-content:center; font-size:10px; line-height:1; z-index:1; transition:color 0.2s;">
                <span class="material-symbols-outlined" style="font-size:12px;">close</span>
            </button>`);
        }
        $headerRow.append($yearWrap);
    });

    if (years.length < MAX_YEARS) {
        $headerRow.append(`<button type="button" id="add-year-btn"
            style="flex-shrink:0; width:28px; height:28px; border:1.5px dashed #cbd5e1; border-radius:6px;
            background:none; cursor:pointer; display:flex; align-items:center; justify-content:center;
            color:#94a3b8; transition:all 0.2s;" title="년도 추가">
            <span class="material-symbols-outlined" style="font-size:16px;">add</span>
        </button>`);
    } else {
        $headerRow.append(`<div style="width:28px; flex-shrink:0;"></div>`);
    }

    $table.append($headerRow);

    // ── 항목 행 렌더 ─────────────────────────────────────────────────────
    if (isSellers) {
        // sellers: SELLER_DEFAULT_ITEMS 순서 고정, 섹션·계산 행 삽입
        SELLER_DEFAULT_ITEMS.forEach(def => {
            if (def.type === 'section') {
                $table.append(buildSectionRow(def.label));
                return;
            }
            if (def.calculated) {
                $table.append(buildCalculatedRow(def, years));
                return;
            }
            // 편집 항목 — 저장된 값 매칭, 없으면 빈 행
            const item = items.find(it => it.key === def.key)
                || { key: def.key, label: def.label, vals: years.map(() => '') };
            $table.append(buildItemRow(item, years, true));
        });
        // sellers는 "항목 추가" 버튼 없음 (구조 고정)
    } else {
        items.forEach(item => {
            $table.append(buildItemRow(item, years, false));
        });
        $table.append(`
            <button type="button" id="add-item-btn" class="db-add-row-btn" style="margin-top:6px; align-self:flex-start;">
                <span class="material-symbols-outlined" style="font-size:18px;">add_circle</span>
                항목 추가
            </button>
        `);
    }

    $container.append($table);
    bindFinancialTableEvents($container);

    // sellers 초기 계산값 표시
    if (isSellers) recalculate($container);
}

/**
 * 저장용: DOM → wire 포맷. 자동 계산 행은 수집하지 않음.
 */
export function collectFinancialData(containerId = 'financial-table-container') {
    const internal = collectInternalState(containerId);

    const entries = [];
    internal.years.forEach((y, idx) => {
        if (y) entries.push({ year: y, idx });
    });
    entries.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

    const years = entries.map(e => e.year);

    // sellers 모드: 빈 칸은 '0'이 아닌 ''으로 저장 (미입력과 0을 구분)
    const isSellers = $(`#${containerId}`).data('render-mode') === 'sellers';

    const items = internal.items
        .filter(it => it.label && it.label.trim())
        .map(it => {
            const values = {};
            entries.forEach(({ year, idx }) => {
                const raw = it.vals[idx];
                values[year] = (raw !== '' && raw != null) ? raw.toString() : (isSellers ? '' : '0');
            });
            return { key: it.key, label: it.label.trim(), values };
        });

    return { years, items };
}

// ─────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────

function newEmptyFinancialData(mode = 'companies') {
    const years = [''];
    const baseItems = mode === 'sellers' ? SELLER_EDITABLE_ITEMS : DEFAULT_ITEMS;
    return {
        years,
        items: baseItems.map(d => ({ key: d.key, label: d.label, vals: [''] }))
    };
}

function wireToInternal(wire, baseItems) {
    const years = (Array.isArray(wire.years) ? [...wire.years] : [])
        .slice()
        .sort((a, b) => {
            const na = parseInt(a), nb = parseInt(b);
            if (isNaN(na) && isNaN(nb)) return 0;
            if (isNaN(na)) return 1;
            if (isNaN(nb)) return -1;
            return nb - na;
        });

    // wire에 있는 항목 우선, 없으면 baseItems의 빈 항목으로 보완
    const wireItemMap = {};
    (wire.items || []).forEach(it => { wireItemMap[it.key] = it; });

    const items = baseItems.map(def => {
        const it = wireItemMap[def.key];
        if (it) {
            const values = it.values || {};
            const vals = years.map(y => values[y] != null ? values[y] : '');
            return { key: it.key, label: it.label || def.label, vals };
        }
        return { key: def.key, label: def.label, vals: years.map(() => '') };
    });

    // companies 모드: wire에 baseItems에 없는 커스텀 항목도 포함
    const baseKeys = new Set(baseItems.map(d => d.key));
    (wire.items || []).forEach(it => {
        if (!baseKeys.has(it.key)) {
            const values = it.values || {};
            const vals = years.map(y => values[y] != null ? values[y] : '');
            items.push({ key: it.key, label: it.label, vals });
        }
    });

    return { years, items };
}

/** DOM에서 편집 항목만 수집 (fin-item-row, 자동 계산 행 fin-calc-row 제외) */
function collectInternalState(containerId) {
    const $container = $(`#${containerId}`);
    if (!$container.length) return { years: [], items: [] };

    const years = [];
    $container.find('.fin-year-header').each(function() {
        years.push($(this).val().trim());
    });

    const items = [];
    // fin-calc-row는 제외 — 자동 계산 행 (div 셀이므로 val이 없음)
    $container.find('.fin-item-row').each(function() {
        const $row = $(this);
        const key   = $row.data('key') || `custom_${Date.now()}_${Math.random()}`;
        const label = $row.find('.fin-item-label').val() || '';
        const vals  = years.map((_, idx) => {
            const val = $row.find(`.fin-cell[data-year-index="${idx}"]`).val() || '';
            return val.replace(/,/g, '').trim();
        });
        items.push({ key: String(key), label, vals });
    });

    return { years, items };
}

/** 섹션 구분선 행 */
function buildSectionRow(label) {
    return $(`<div class="fin-section-row" style="
        display:flex; align-items:center; gap:6px;
        padding: 14px 4px 5px 4px;
        font-size:11px; font-weight:700; color:#64748b;
        text-transform:uppercase; letter-spacing:0.06em;
        border-bottom:1.5px solid #e2e8f0;
        margin-bottom:6px;">
        <span>${escapeHtml(label)}</span>
    </div>`);
}

/** 자동 계산 결과 행 (읽기 전용) */
function buildCalculatedRow(itemDef, years) {
    const $row = $(`<div class="fin-calc-row" data-key="${escapeHtml(itemDef.key)}"
        style="display:flex; align-items:center; gap:6px; padding:2px 0; margin:1px 0;
               background:#f8fafc; border-radius:6px;"></div>`);

    $row.append(`<div class="fin-label-cell" style="
        flex:0 0 140px; min-width:140px;
        padding:7px 4px 7px 12px;
        font-size:12px; color:#475569; font-weight:600; font-style:italic;">
        ${escapeHtml(itemDef.label)}
    </div>`);

    years.forEach((_, idx) => {
        $row.append(`<div class="fin-calc-cell" data-year-index="${idx}"
            style="flex:1; min-width:0; padding:7px 8px;
                   font-size:12px; text-align:right;
                   color:#475569; font-weight:600;">—</div>`);
    });

    // 삭제 버튼 자리 (공간 유지)
    $row.append(`<div style="width:28px; flex-shrink:0;"></div>`);

    return $row;
}

/**
 * 편집 항목 행
 * @param {boolean} isSellers  sellers 모드 여부 (드래그·삭제 버튼 숨김, 0 자동 입력 없음)
 */
function buildItemRow(item, years, isSellers = false) {
    const labelWidth = isSellers ? 140 : 120;

    const $row = $(`<div class="fin-item-row" data-key="${escapeHtml(item.key)}"
        style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:default;"></div>`);

    const $labelCell = $(`<div class="fin-label-cell"
        style="flex:0 0 ${labelWidth}px; min-width:${labelWidth}px; display:flex; align-items:center; gap:2px;"></div>`);

    if (!isSellers) {
        $labelCell.append(`<span class="drag-handle" title="드래그하여 순서 변경"
            style="color:#cbd5e1; cursor:grab; flex-shrink:0; display:flex; align-items:center; user-select:none; padding:2px;">
            <span class="material-symbols-outlined" style="font-size:16px;">drag_indicator</span>
        </span>`);
    } else {
        // sellers: 드래그 핸들 대신 왼쪽 여백 맞춤용 패딩
        $labelCell.css('padding-left', '12px');
    }

    $labelCell.append(`<input type="text" class="fin-item-label" value="${escapeHtml(item.label)}" placeholder="항목명"
        style="flex:1; min-width:0; padding:4px 6px; border:1px solid transparent; border-radius:4px;
        font-size:13px; color:#334155; font-weight:500; background:transparent; outline:none;
        transition:border-color 0.2s, background 0.2s;">`);

    $row.append($labelCell);

    years.forEach((_, idx) => {
        const val = (item.vals && item.vals[idx] != null) ? item.vals[idx] : '';
        $row.append(`<input type="text" class="fin-cell format-number" data-year-index="${idx}" value="${formatDisplay(val)}"
            style="flex:1; min-width:0; padding:7px 6px; border:1px solid #e2e8f0; border-radius:6px;
            font-size:13px; text-align:right; background:#ffffff; outline:none; box-sizing:border-box;
            transition:border-color 0.2s;"
            placeholder="${isSellers ? '—' : '0'}">`);
    });

    if (!isSellers) {
        $row.append(`<button type="button" class="btn-remove-item" title="항목 삭제"
            style="background:none; border:none; cursor:pointer; color:#cbd5e1; width:28px; padding:0;
            display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:color 0.2s;">
            <span class="material-symbols-outlined" style="font-size:18px;">do_not_disturb_on</span>
        </button>`);
    } else {
        $row.append(`<div style="width:28px; flex-shrink:0;"></div>`);
    }

    return $row;
}

/** sellers 모드 자동 계산 — 모든 fin-calc-row의 값을 갱신 */
function recalculate($container) {
    const years = [];
    $container.find('.fin-year-header').each(function() {
        years.push($(this).val().trim());
    });

    years.forEach((_, yearIdx) => {
        // 해당 연도의 편집 항목 값 수집
        const vals = {};
        $container.find('.fin-item-row').each(function() {
            const key    = $(this).data('key');
            const rawVal = $(this).find(`.fin-cell[data-year-index="${yearIdx}"]`).val() || '';
            vals[key]    = rawVal.replace(/,/g, '').trim();
        });

        // 각 계산 행 갱신
        $container.find('.fin-calc-row').each(function() {
            const key     = $(this).data('key');
            const formula = SELLER_FORMULAS[key];
            const $cell   = $(this).find(`.fin-calc-cell[data-year-index="${yearIdx}"]`);
            const def     = SELLER_DEFAULT_ITEMS.find(it => it.key === key);
            if (!formula || !$cell.length) return;

            // 의존 항목이 모두 비어있으면 계산 자체가 의미 없음 → '—'
            const deps = SELLER_FORMULA_DEPS[key];
            if (deps && deps.every(dep => _isEmpty(vals[dep]))) {
                $cell.text('—');
                return;
            }

            let result;
            try { result = formula(vals); } catch (_) { result = null; }

            if (result === null || isNaN(result)) {
                $cell.text('—');
            } else if (def && def.isPercent) {
                $cell.text(result.toFixed(1) + '%');
            } else {
                $cell.text(formatDisplay(result) || '0');
            }
        });
    });
}

function bindFinancialTableEvents($container) {
    if ($container.data('fin-events-bound')) return;
    $container.data('fin-events-bound', true);

    const containerId = $container.attr('id');

    // ── 년도 삭제 ───────────────────────────────────────────────────────
    $container.on('click', '.btn-remove-year', function() {
        const mode = $container.data('render-mode') || 'companies';
        const data = collectInternalState(containerId);
        const idx  = parseInt($(this).data('index'));
        if (isNaN(idx) || idx < 0 || idx >= data.years.length) return;
        data.years.splice(idx, 1);
        data.items.forEach(it => it.vals.splice(idx, 1));
        renderFinancialTable(data, containerId, mode);
    });

    // ── 년도 추가 ───────────────────────────────────────────────────────
    $container.on('click', '#add-year-btn', function() {
        const mode = $container.data('render-mode') || 'companies';
        const data = collectInternalState(containerId);
        if (data.years.length >= MAX_YEARS) return;
        data.years.unshift('');
        data.items.forEach(it => it.vals.unshift(''));
        renderFinancialTable(data, containerId, mode);
    });

    // ── 항목 삭제 (companies 모드 전용) ────────────────────────────────
    $container.on('click', '.btn-remove-item', function() {
        const mode = $container.data('render-mode') || 'companies';
        if (mode === 'sellers') return;
        const data    = collectInternalState(containerId);
        const $row    = $(this).closest('.fin-item-row');
        const rowIdx  = $row.parent().find('.fin-item-row').index($row);
        if (rowIdx < 0 || rowIdx >= data.items.length) return;
        data.items.splice(rowIdx, 1);
        renderFinancialTable(data, containerId, mode);
    });

    // ── 항목 추가 (companies 모드 전용) ────────────────────────────────
    $container.on('click', '#add-item-btn', function() {
        const mode = $container.data('render-mode') || 'companies';
        if (mode === 'sellers') return;
        const data = collectInternalState(containerId);
        data.items.push({
            key:  `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            label: '',
            vals:  data.years.map(() => '')
        });
        renderFinancialTable(data, containerId, mode);
        $container.find('.fin-item-row').last().find('.fin-item-label').focus();
    });

    // ── 숫자 포맷 (콤마) — 음수 허용 ──────────────────────────────────
    $container.on('input', '.fin-cell', function() {
        let raw = $(this).val().replace(/[^0-9.-]/g, '');
        if (raw.startsWith('-')) raw = '-' + raw.slice(1).replace(/-/g, '');
        else raw = raw.replace(/-/g, '');
        if (raw === '' || raw === '-') { $(this).val(raw); return; }
        const num = parseFloat(raw);
        if (!isNaN(num)) $(this).val(num.toLocaleString('ko-KR'));

        // sellers: 입력 시 실시간 자동 계산
        const mode = $container.data('render-mode') || 'companies';
        if (mode === 'sellers') recalculate($container);
    });

    // ── 년도 헤더 숫자만 허용 ──────────────────────────────────────────
    $container.on('input', '.fin-year-header', function() {
        $(this).val($(this).val().replace(/[^0-9]/g, '').slice(0, 4));
    });

    // ── 라벨 focus/blur ────────────────────────────────────────────────
    $container.on('focus', '.fin-item-label', function() {
        $(this).css({ 'border-color': 'var(--page-theme-color)', 'background': '#fff' });
    }).on('blur', '.fin-item-label', function() {
        $(this).css({ 'border-color': 'transparent', 'background': 'transparent' });
    });

    // ── 셀 focus/blur ──────────────────────────────────────────────────
    $container.on('focus', '.fin-cell, .fin-year-header', function() {
        $(this).css('border-color', 'var(--page-theme-color)');
    }).on('blur', '.fin-cell, .fin-year-header', function() {
        $(this).css('border-color', '#e2e8f0');
        const mode = $container.data('render-mode') || 'companies';
        // companies: 빈 칸 → 0 자동 입력 / sellers: 빈 칸 그대로 유지 (— 표시)
        if ($(this).hasClass('fin-cell') && $(this).val().trim() === '' && mode !== 'sellers') {
            $(this).val('0');
        }
        // sellers: blur 시 최종 계산값 갱신
        if (mode === 'sellers') recalculate($container);
    });

    // ── 드래그 앤 드롭 (companies 모드 전용) ───────────────────────────
    let dragSrc = null;

    $container.on('mousedown', '.drag-handle', function() {
        $(this).closest('.fin-item-row').attr('draggable', 'true');
    });

    const clearDraggable = () => {
        $container.find('.fin-item-row').removeAttr('draggable');
    };

    $container.on('dragstart', '.fin-item-row', function(e) {
        const mode = $container.data('render-mode') || 'companies';
        if (mode === 'sellers') return;
        dragSrc = this;
        const dt = e.originalEvent.dataTransfer;
        dt.effectAllowed = 'move';
        try { dt.setData('text/plain', $(this).data('key') || ''); } catch (_) {}
        $(this).css('opacity', '0.4');
    });

    $container.on('dragend', '.fin-item-row', function() {
        $(this).css('opacity', '1');
        $container.find('.fin-item-row').css({ 'border-top': '', 'border-bottom': '' });
        clearDraggable();
        dragSrc = null;
    });

    $container.on('dragover', '.fin-item-row', function(e) {
        if (!dragSrc || dragSrc === this) return;
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';
        const rect   = this.getBoundingClientRect();
        const before = (e.originalEvent.clientY - rect.top) < rect.height / 2;
        $container.find('.fin-item-row').css({ 'border-top': '', 'border-bottom': '' });
        $(this).css(before ? 'border-top' : 'border-bottom', '2px solid var(--page-theme-color)');
        return false;
    });

    $container.on('dragleave', '.fin-item-row', function() {
        $(this).css({ 'border-top': '', 'border-bottom': '' });
    });

    $container.on('drop', '.fin-item-row', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (dragSrc && dragSrc !== this) {
            const rect   = this.getBoundingClientRect();
            const before = (e.originalEvent.clientY - rect.top) < rect.height / 2;
            if (before) $(dragSrc).insertBefore(this);
            else         $(dragSrc).insertAfter(this);
        }
        $container.find('.fin-item-row').css({ 'border-top': '', 'border-bottom': '' });
        return false;
    });
}

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────

function formatDisplay(val) {
    if (!val && val !== 0) return '';
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(num)) return val;
    return num.toLocaleString('ko-KR');
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────
// 외부(목록 페이지)용 변환 유틸
// ─────────────────────────────────────────────────────────────────────────

/**
 * wire 포맷 → 레거시 배열 ([{year, revenue, ...}])
 * 외부(my_companies.js, total_companies.js)에서 DB 데이터를 그대로 받음
 */
export function toFinancialArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.years && data.items) {
        return data.years.map(year => {
            const row = { year };
            data.items.forEach(item => {
                if (item.values) {
                    row[item.key] = item.values[year] || '';
                } else if (Array.isArray(item.vals)) {
                    const idx = data.years.indexOf(year);
                    row[item.key] = idx >= 0 ? (item.vals[idx] || '') : '';
                }
            });
            return row;
        });
    }
    return [];
}
