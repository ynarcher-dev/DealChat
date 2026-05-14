/**
 * financial_utils.js
 * 재무 정보 전치 테이블 (가로=년도, 세로=항목) 유틸리티
 *
 * 내부 표현(편집 사이클): { years: [str], items: [{ key, label, vals: [str] }] }
 *   - vals 는 years 와 같은 길이의 위치 배열. 빈 년도/빈 라벨이 있어도 어긋나지 않음.
 * 외부 표현(저장/로드, wire): { years: [str], items: [{ key, label, values: { yearStr: val } }] }
 *   - collectFinancialData() 가 저장용으로 wire 포맷(빈 값 필터)을 돌려준다.
 *   - migrateFinancialInfo() 는 wire/레거시를 내부 표현으로 변환한다.
 */

const MAX_YEARS = 5;

const DEFAULT_ITEMS = [
    { key: 'revenue',           label: '매출액' },
    { key: 'profit',            label: '영업이익' },
    { key: 'net_profit',        label: '당기순이익' },
    { key: 'total_assets',      label: '총 자산' },
    { key: 'total_liabilities', label: '총 부채' },
    { key: 'total_equity',      label: '총 자본' },
];

// 라벨에 따라 부호가 결정되는 항목 — AI 추출 시 라벨(_label) 값을 보고
// 손실 라벨이면 셀 값을 음수로 변환한다. 그 외 항목은 라벨 변형이 없으므로 제외.
//   invalidPatterns: 이 패턴 중 하나라도 매치되면 명백히 잘못된 라벨로 간주하고 거부
//     (예: net_profit에 "법인세비용차감전손익"이 들어온 경우)
//   화이트리스트 대신 블랙리스트 — AI가 살짝 변형된 정상 라벨을 써도 통과시켜
//   AI가 위축되어 빈 값을 반환하는 것을 막는다.
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

/**
 * 라벨에 "손실" 키워드가 포함되어 있는지 (예: "영업손실", "당기순손실")
 */
function isLossLabel(label) {
    return /손실/.test(String(label || ''));
}

/**
 * 해당 key에 명백히 부적합한 라벨인지 검사 — 블랙리스트 방식
 *   - 빈 라벨은 false(= 부적합 아님). 라벨 없음은 별도 처리(레거시 경로)
 *   - 명백한 잘못된 라벨(예: net_profit에 "법인세비용차감전손익")만 true
 */
function isInvalidLabelFor(key, label) {
    const meta = LABEL_AWARE_KEYS[key];
    if (!meta) return false;
    const l = String(label || '').trim();
    if (!l) return false;
    return meta.invalidPatterns.some(p => p.test(l));
}

/**
 * 연도별 라벨 배열을 받아 행(row) 라벨을 결정한다.
 *   - 비어있지 않은 라벨이 없으면 기본 라벨
 *   - 모두 같은 라벨이면 그 라벨
 *   - 손실/이익이 섞여 있으면 통합 라벨 (예: "영업손익")
 *   - 그 외(부분적으로만 비어있음)는 최빈 라벨
 */
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
    // 모두 손실이지만 표기만 다른 경우(예: "영업손실" vs "영업손실(누적)") → 최빈값
    const freq = {};
    labels.forEach(l => { freq[l] = (freq[l] || 0) + 1; });
    return Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
}

/**
 * 셀 값을 양수 절댓값으로 정규화 — 괄호·△·마이너스 표기를 모두 흡수.
 * 행 라벨이 손실·이익을 이미 명시하는 경우(예: "영업손실" / "영업이익") 사용.
 */
function toAbsoluteValue(rawVal) {
    const s = String(rawVal == null ? '' : rawVal).replace(/,/g, '').trim();
    if (s === '' || s === '-') return '';
    const cleaned = s.replace(/[()△]/g, '').replace(/^-/, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return s;
    return String(Math.abs(num));
}

/**
 * 통합 라벨(예: "영업손익") 행에서 사용 — 연도별 라벨로 부호를 결정.
 * 손실 라벨이면 음수, 이익 라벨이면 양수. 입력의 표기 부호는 무시하고 라벨로 재부여.
 */
function applySignByLabel(rawVal, label) {
    const abs = toAbsoluteValue(rawVal);
    if (abs === '') return '';
    return isLossLabel(label) ? String(-Math.abs(parseFloat(abs))) : abs;
}

/**
 * 외부에서 들어온 데이터(wire/레거시/null)를 내부 표현으로 변환
 */
export function migrateFinancialInfo(data) {
    if (!data) return newEmptyFinancialData();

    // wire 포맷
    if (!Array.isArray(data) && Array.isArray(data.years) && Array.isArray(data.items)) {
        return wireToInternal(data);
    }

    // 레거시 배열 포맷
    if (Array.isArray(data) && data.length > 0) {
        // 최신 연도가 가장 왼쪽에 오도록 내림차순 정렬
        const years = [...new Set(data.map(f => String(f.year || '').trim()).filter(Boolean))]
            .sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0))
            .slice(0, MAX_YEARS);

        const items = DEFAULT_ITEMS.map(def => {
            const isLabelAware = !!LABEL_AWARE_KEYS[def.key];
            const labelKey = `${def.key}_label`;

            // Pass 1: 연도별 원본 (값, 라벨) 수집
            //   - 라벨 인식 항목인데 _label이 허용 패턴과 안 맞으면
            //     (예: AI가 "법인세비용차감전손익"을 net_profit 라벨로 잘못 잡은 경우)
            //     해당 연도의 값과 라벨을 통째로 버린다 — 잘못된 값 표시보다 빈 칸이 안전
            const perYearLabels = [];
            const rawVals = years.map(y => {
                const found = data.find(f => String(f.year || '').trim() === y);
                if (!found) { perYearLabels.push(''); return ''; }

                const rawLabel = found[labelKey] || '';
                const rawVal = found[def.key];

                if (isLabelAware && isInvalidLabelFor(def.key, rawLabel)) {
                    // 명백히 잘못된 라벨 — 값도 신뢰할 수 없음 (다른 줄의 값일 가능성)
                    perYearLabels.push('');
                    return '';
                }

                perYearLabels.push(rawLabel);
                return rawVal == null ? '' : String(rawVal);
            });

            // 행 라벨 결정
            const rowLabel = isLabelAware
                ? (decideRowLabel(def.key, perYearLabels) || def.label)
                : def.label;

            // Pass 2: 부호 처리
            //   - 라벨 인식 대상이 아닌 항목(매출/자산/부채/자본): 값 그대로
            //   - _label 정보가 전혀 없는 레거시 데이터: 값 그대로 (기존 DB 보존)
            //   - 행 라벨이 통합 라벨(영업손익/당기순손익)인 경우: 연도별 라벨로 부호 부여
            //   - 행 라벨이 단일 라벨(영업이익 또는 영업손실 등)인 경우: 값은 항상 양수 절댓값
            //     (라벨이 이미 손실/이익을 의미하므로 음수로 만들면 이중 부정)
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
                // 단일 라벨 행 — 라벨이 부호 의미를 이미 담고 있음
                return toAbsoluteValue(rawVal);
            });

            return { key: def.key, label: rowLabel, vals };
        });

        return { years, items };
    }

    return newEmptyFinancialData();
}

function newEmptyFinancialData() {
    // 칸은 하나 생성하되 값을 비워둠
    const years = [''];
    return {
        years,
        items: DEFAULT_ITEMS.map(d => ({ key: d.key, label: d.label, vals: [''] }))
    };
}

function wireToInternal(wire) {
    // 최신 연도가 가장 왼쪽에 오도록 내림차순 정렬 (빈 연도는 끝으로)
    const years = (Array.isArray(wire.years) ? [...wire.years] : [])
        .slice()
        .sort((a, b) => {
            const na = parseInt(a), nb = parseInt(b);
            if (isNaN(na) && isNaN(nb)) return 0;
            if (isNaN(na)) return 1;
            if (isNaN(nb)) return -1;
            return nb - na;
        });
    const items = (wire.items || []).map(it => {
        const values = it.values || {};
        const vals = years.map(y => values[y] != null ? values[y] : '');
        return { key: it.key, label: it.label, vals };
    });
    return { years, items };
}

/**
 * DOM에서 내부 표현으로 무손실 수집 (편집 사이클 내부에서만 사용)
 *   - 빈 년도 / 빈 라벨도 위치 그대로 유지
 *   - 셀 값은 data-year-index 로 위치 매칭
 */
function collectInternalState(containerId) {
    const $container = $(`#${containerId}`);
    if (!$container.length) return { years: [], items: [] };

    const years = [];
    $container.find('.fin-year-header').each(function() {
        years.push($(this).val().trim());
    });

    const items = [];
    $container.find('.fin-item-row').each(function() {
        const $row = $(this);
        const key = $row.data('key') || `custom_${Date.now()}_${Math.random()}`;
        const label = $row.find('.fin-item-label').val() || '';
        const vals = years.map((_, idx) => {
            const val = $row.find(`.fin-cell[data-year-index="${idx}"]`).val() || '';
            return val.replace(/,/g, '').trim();
        });
        items.push({ key: String(key), label, vals });
    });

    return { years, items };
}

/**
 * 저장용: 내부 표현 → wire 포맷, 빈 년도/빈 라벨 제거
 */
export function collectFinancialData(containerId = 'financial-table-container') {
    const internal = collectInternalState(containerId);

    // 살릴 년도와 그 위치를 함께 추리고, 최신순(내림차순)으로 정렬
    const entries = [];
    internal.years.forEach((y, idx) => {
        if (y) entries.push({ year: y, idx });
    });
    entries.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

    const years = entries.map(e => e.year);

    const items = internal.items
        .filter(it => it.label && it.label.trim())
        .map(it => {
            const values = {};
            entries.forEach(({ year, idx }) => {
                values[year] = (it.vals[idx] || '').toString();
            });
            return { key: it.key, label: it.label.trim(), values };
        });

    return { years, items };
}

/**
 * 재무 전치 테이블 렌더 (내부 표현 입력)
 *   - 외부에서 호출 시에는 반드시 migrateFinancialInfo() 결과를 넘겨라
 */
export function renderFinancialTable(data, containerId = 'financial-table-container') {
    const $container = $(`#${containerId}`);
    if (!$container.length) return;

    // 안전망: wire/레거시가 들어오면 내부 표현으로 변환
    const internal = (data && data.items && data.items[0] && Array.isArray(data.items[0].vals))
        ? data
        : migrateFinancialInfo(data);

    const { years, items } = internal;
    $container.empty().removeData('report-applied');

    const $table = $(`<div class="fin-table" style="display:flex; flex-direction:column; gap:0;"></div>`);

    // ── 헤더 행 (구분 | 년도들) ─────────────────────────────────
    const $headerRow = $(`<div class="fin-header-row" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;"></div>`);

    $headerRow.append(`<div class="fin-label-cell fin-header-cell" style="
        flex:0 0 120px; min-width:120px; font-size:11px; color:#64748b; font-weight:700;
        text-transform:uppercase; letter-spacing:0.02em; padding:8px 4px 8px 28px;">구분</div>`);

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

    items.forEach((item) => {
        $table.append(buildItemRow(item, years));
    });

    $table.append(`
        <button type="button" id="add-item-btn" class="db-add-row-btn" style="margin-top:6px; align-self:flex-start;">
            <span class="material-symbols-outlined" style="font-size:18px;">add_circle</span>
            항목 추가
        </button>
    `);

    $container.append($table);

    bindFinancialTableEvents($container);
}

function buildItemRow(item, years) {
    const $row = $(`<div class="fin-item-row" data-key="${item.key}"
        style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:default;"></div>`);

    const $labelCell = $(`<div class="fin-label-cell"
        style="flex:0 0 120px; min-width:120px; display:flex; align-items:center; gap:2px;"></div>`);

    $labelCell.append(`<span class="drag-handle" title="드래그하여 순서 변경"
        style="color:#cbd5e1; cursor:grab; flex-shrink:0; display:flex; align-items:center; user-select:none; padding:2px;">
        <span class="material-symbols-outlined" style="font-size:16px;">drag_indicator</span>
    </span>`);

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
            placeholder="—">`);
    });

    $row.append(`<button type="button" class="btn-remove-item" title="항목 삭제"
        style="background:none; border:none; cursor:pointer; color:#cbd5e1; width:28px; padding:0;
        display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:color 0.2s;">
        <span class="material-symbols-outlined" style="font-size:18px;">do_not_disturb_on</span>
    </button>`);

    return $row;
}

function bindFinancialTableEvents($container) {
    // 컨테이너당 한 번만 바인딩 — 매 렌더 시 재바인딩되면 delegated 핸들러가
    // 누적되어 클릭 한 번에 N번 발화하는 문제 방지
    if ($container.data('fin-events-bound')) return;
    $container.data('fin-events-bound', true);

    const containerId = $container.attr('id');

    // 년도 삭제 — 내부 표현 기반 splice (위치 정확)
    $container.on('click', '.btn-remove-year', function() {
        const data = collectInternalState(containerId);
        const idx = parseInt($(this).data('index'));
        if (isNaN(idx) || idx < 0 || idx >= data.years.length) return;
        data.years.splice(idx, 1);
        data.items.forEach(it => it.vals.splice(idx, 1));
        renderFinancialTable(data, containerId);
    });

    // 년도 추가 — 최신 연도는 가장 왼쪽에 위치하므로 맨 앞에 빈 칸 추가
    $container.on('click', '#add-year-btn', function() {
        const data = collectInternalState(containerId);
        if (data.years.length >= MAX_YEARS) return;
        data.years.unshift('');
        data.items.forEach(it => it.vals.unshift(''));
        renderFinancialTable(data, containerId);
    });

    // 항목 삭제 — 내부 표현으로 위치 기반 제거 후 재렌더
    $container.on('click', '.btn-remove-item', function() {
        const data = collectInternalState(containerId);
        const $row = $(this).closest('.fin-item-row');
        const rowIdx = $row.parent().find('.fin-item-row').index($row);
        if (rowIdx < 0 || rowIdx >= data.items.length) return;
        data.items.splice(rowIdx, 1);
        renderFinancialTable(data, containerId);
    });

    // 항목 추가 — 빈 년도 보존, vals 도 동일 길이로 추가
    $container.on('click', '#add-item-btn', function() {
        const data = collectInternalState(containerId);
        data.items.push({
            key: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            label: '',
            vals: data.years.map(() => '')
        });
        renderFinancialTable(data, containerId);
        $container.find('.fin-item-row').last().find('.fin-item-label').focus();
    });

    // 숫자 포맷 (콤마) — 음수 허용
    $container.on('input', '.fin-cell', function() {
        let raw = $(this).val().replace(/[^0-9.-]/g, '');
        if (raw.startsWith('-')) raw = '-' + raw.slice(1).replace(/-/g, '');
        else raw = raw.replace(/-/g, '');
        if (raw === '' || raw === '-') { $(this).val(raw); return; }
        const num = parseFloat(raw);
        if (!isNaN(num)) $(this).val(num.toLocaleString('ko-KR'));
    });

    // 년도 헤더 숫자만 허용
    $container.on('input', '.fin-year-header', function() {
        $(this).val($(this).val().replace(/[^0-9]/g, '').slice(0, 4));
    });

    // 라벨 hover/focus 시 테두리 표시
    $container.on('focus', '.fin-item-label', function() {
        $(this).css({ 'border-color': 'var(--page-theme-color)', 'background': '#fff' });
    }).on('blur', '.fin-item-label', function() {
        $(this).css({ 'border-color': 'transparent', 'background': 'transparent' });
    });

    // ── 드래그 앤 드롭 순서 변경 ──────────────────────────────────
    // 행 전체에 draggable=true 를 두면 라벨/값 input 클릭 시 텍스트 선택이
    // 드래그를 가로채므로, 드래그 핸들 mousedown 시점에만 draggable 을 켠다.
    let dragSrc = null;

    $container.on('mousedown', '.drag-handle', function() {
        $(this).closest('.fin-item-row').attr('draggable', 'true');
    });

    const clearDraggable = () => {
        $container.find('.fin-item-row').removeAttr('draggable');
    };

    $container.on('dragstart', '.fin-item-row', function(e) {
        dragSrc = this;
        const dt = e.originalEvent.dataTransfer;
        dt.effectAllowed = 'move';
        // Firefox 는 setData 가 없으면 dragstart 가 무시된다
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
        // 커서가 행의 위쪽 절반이면 위에, 아래쪽 절반이면 아래에 표시
        const rect = this.getBoundingClientRect();
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
            const rect = this.getBoundingClientRect();
            const before = (e.originalEvent.clientY - rect.top) < rect.height / 2;
            if (before) $(dragSrc).insertBefore(this);
            else $(dragSrc).insertAfter(this);
        }
        $container.find('.fin-item-row').css({ 'border-top': '', 'border-bottom': '' });
        return false;
    });

    $container.on('focus', '.fin-cell, .fin-year-header', function() {
        $(this).css('border-color', 'var(--page-theme-color)');
    }).on('blur', '.fin-cell, .fin-year-header', function() {
        $(this).css('border-color', '#e2e8f0');
    });
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

function formatDisplay(val) {
    if (!val && val !== 0) return '';
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(num)) return val;
    return num.toLocaleString('ko-KR');
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
                // wire 포맷(values) / 내부 표현(vals) 양쪽 지원
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
