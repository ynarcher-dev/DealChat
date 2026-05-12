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
        const years = [...new Set(data.map(f => String(f.year || '').trim()).filter(Boolean))]
            .sort((a, b) => parseInt(a) - parseInt(b))
            .slice(0, MAX_YEARS);

        const items = DEFAULT_ITEMS.map(def => {
            const vals = years.map(y => {
                const found = data.find(f => String(f.year || '').trim() === y);
                return found ? (found[def.key] || '') : '';
            });
            return { key: def.key, label: def.label, vals };
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
    const years = Array.isArray(wire.years) ? [...wire.years] : [];
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

    // 살릴 년도 index 만 추림
    const keptIdx = [];
    const years = [];
    internal.years.forEach((y, idx) => {
        if (y) { keptIdx.push(idx); years.push(y); }
    });

    const items = internal.items
        .filter(it => it.label && it.label.trim())
        .map(it => {
            const values = {};
            keptIdx.forEach((origIdx, newIdx) => {
                const y = years[newIdx];
                values[y] = (it.vals[origIdx] || '').toString();
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
        style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:default;" draggable="true"></div>`);

    const $labelCell = $(`<div class="fin-label-cell"
        style="flex:0 0 120px; min-width:120px; display:flex; align-items:center; gap:2px;"></div>`);

    $labelCell.append(`<span class="drag-handle" title="순서 변경"
        style="color:#cbd5e1; cursor:grab; flex-shrink:0; display:flex; align-items:center; user-select:none;">
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

    // 년도 추가 — 빈 칸 하나만 추가 (사용자가 직접 입력)
    $container.on('click', '#add-year-btn', function() {
        const data = collectInternalState(containerId);
        if (data.years.length >= MAX_YEARS) return;
        data.years.push('');
        data.items.forEach(it => it.vals.push(''));
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
    let dragSrc = null;

    $container.on('dragstart', '.fin-item-row', function(e) {
        dragSrc = this;
        e.originalEvent.dataTransfer.effectAllowed = 'move';
        $(this).css('opacity', '0.4');
    });

    $container.on('dragend', '.fin-item-row', function() {
        $(this).css('opacity', '1');
        $container.find('.fin-item-row').css('border-top', '');
    });

    $container.on('dragover', '.fin-item-row', function(e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';
        $container.find('.fin-item-row').css('border-top', '');
        $(this).css('border-top', '2px solid var(--page-theme-color)');
        return false;
    });

    $container.on('dragleave', '.fin-item-row', function() {
        $(this).css('border-top', '');
    });

    $container.on('drop', '.fin-item-row', function(e) {
        e.stopPropagation();
        if (dragSrc !== this) {
            $(dragSrc).insertBefore($(this));
        }
        $container.find('.fin-item-row').css('border-top', '');
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
