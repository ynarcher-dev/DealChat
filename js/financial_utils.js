/**
 * financial_utils.js
 * 재무 정보 전치 테이블 (가로=년도, 세로=항목) 유틸리티
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
 * 기존 배열 형식 → 새 객체 형식으로 마이그레이션
 * oldData가 이미 새 형식이면 그대로 반환
 */
export function migrateFinancialInfo(data) {
    if (!data) return newEmptyFinancialData();

    // 이미 새 형식 ({ years, items })
    if (data && !Array.isArray(data) && Array.isArray(data.years) && Array.isArray(data.items)) {
        return data;
    }

    // 기존 배열 형식 (구버전 호환)
    if (Array.isArray(data) && data.length > 0) {
        const years = [...new Set(data.map(f => String(f.year || '').trim()).filter(Boolean))]
            .sort((a, b) => parseInt(a) - parseInt(b))
            .slice(0, MAX_YEARS);

        const items = DEFAULT_ITEMS.map(def => {
            const values = {};
            data.forEach(f => {
                const y = String(f.year || '').trim();
                if (y) values[y] = f[def.key] || '';
            });
            return { key: def.key, label: def.label, values };
        });

        return { years, items };
    }

    return newEmptyFinancialData();
}

function newEmptyFinancialData() {
    return {
        years: [''], // 칸은 하나 생성하되 값을 비워둠
        items: DEFAULT_ITEMS.map(d => ({ key: d.key, label: d.label, values: {} }))
    };
}

/**
 * DOM에서 재무 데이터 수집 → JSONB 구조 반환
 */
export function collectFinancialData(containerId = 'financial-table-container') {
    const $container = $(`#${containerId}`);
    if (!$container.length) return { years: [], items: [] };

    const years = [];
    $container.find('.fin-year-header').each(function() {
        const y = $(this).val().trim();
        if (y) years.push(y);
    });

    const items = [];
    $container.find('.fin-item-row').each(function() {
        const key = $(this).data('key') || `custom_${Date.now()}_${Math.random()}`;
        const label = $(this).find('.fin-item-label').val().trim();
        const values = {};
        years.forEach((y, idx) => {
            const val = $(this).find(`.fin-cell[data-year-index="${idx}"]`).val() || '';
            values[y] = val.replace(/,/g, '').trim();
        });
        if (label) items.push({ key: String(key), label, values });
    });

    return { years, items };
}

/**
 * 재무 전치 테이블을 DOM에 렌더링 (편집 모드)
 */
export function renderFinancialTable(data, containerId = 'financial-table-container') {
    const $container = $(`#${containerId}`);
    if (!$container.length) return;

    const { years, items } = data;
    $container.empty().removeData('report-applied');

    // ── 테이블 래퍼 (가로 스크롤 방지용) ────────────────────────
    const $table = $(`<div class="fin-table" style="display:flex; flex-direction:column; gap:0;"></div>`);

    // ── 헤더 행 (구분 | 년도들) ─────────────────────────────────
    const $headerRow = $(`<div class="fin-header-row" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;"></div>`);

    // "구분" 라벨 (고정 폭)
    $headerRow.append(`<div class="fin-label-cell fin-header-cell" style="
        flex:0 0 120px; min-width:120px; font-size:11px; color:#64748b; font-weight:700;
        text-transform:uppercase; letter-spacing:0.02em; padding:8px 4px 8px 28px;">구분</div>`);

    // 년도 헤더 입력들
    years.forEach((y, idx) => {
        const $yearWrap = $(`<div style="flex:1; min-width:0; position:relative; display:flex; align-items:center; gap:2px;"></div>`);
        $yearWrap.append(`<input type="text" class="fin-year-header" data-index="${idx}" value="${y}" maxlength="4"
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

    // 년도 추가 버튼
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

    // ── 항목 행들 ──────────────────────────────────────────────────
    items.forEach((item) => {
        $table.append(buildItemRow(item, years));
    });

    // ── 항목 추가 버튼 ────────────────────────────────────────────
    $table.append(`
        <button type="button" id="add-item-btn" class="db-add-row-btn" style="margin-top:6px; align-self:flex-start;">
            <span class="material-symbols-outlined" style="font-size:18px;">add_circle</span>
            항목 추가
        </button>
    `);

    $container.append($table);

    // ── 이벤트 바인딩 ─────────────────────────────────────────────
    bindFinancialTableEvents($container);
}

function buildItemRow(item, years) {
    const $row = $(`<div class="fin-item-row" data-key="${item.key}"
        style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:default;" draggable="true"></div>`);

    // 드래그 핸들 + 라벨 입력 (고정 폭)
    const $labelCell = $(`<div class="fin-label-cell"
        style="flex:0 0 120px; min-width:120px; display:flex; align-items:center; gap:2px;"></div>`);

    $labelCell.append(`<span class="drag-handle" title="순서 변경"
        style="color:#cbd5e1; cursor:grab; flex-shrink:0; display:flex; align-items:center; user-select:none;">
        <span class="material-symbols-outlined" style="font-size:16px;">drag_indicator</span>
    </span>`);

    // 모든 항목 편집 가능
    $labelCell.append(`<input type="text" class="fin-item-label" value="${escapeHtml(item.label)}" placeholder="항목명"
        style="flex:1; min-width:0; padding:4px 6px; border:1px solid transparent; border-radius:4px;
        font-size:13px; color:#334155; font-weight:500; background:transparent; outline:none;
        transition:border-color 0.2s, background 0.2s;">`);

    $row.append($labelCell);

    // 년도별 값 셀
    years.forEach((y, idx) => {
        const val = item.values[y] || '';
        $row.append(`<input type="text" class="fin-cell format-number" data-year-index="${idx}" value="${formatDisplay(val)}"
            style="flex:1; min-width:0; padding:7px 6px; border:1px solid #e2e8f0; border-radius:6px;
            font-size:13px; text-align:right; background:#ffffff; outline:none; box-sizing:border-box;
            transition:border-color 0.2s;"
            placeholder="—">`);
    });

    // 삭제 버튼 (모든 항목)
    $row.append(`<button type="button" class="btn-remove-item" title="항목 삭제"
        style="background:none; border:none; cursor:pointer; color:#cbd5e1; width:28px; padding:0;
        display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:color 0.2s;">
        <span class="material-symbols-outlined" style="font-size:18px;">do_not_disturb_on</span>
    </button>`);

    return $row;
}

function bindFinancialTableEvents($container) {
    const containerId = $container.attr('id');

    // 년도 삭제 — 수집 후 재렌더
    $container.on('click', '.btn-remove-year', function() {
        const data = collectFinancialData(containerId);
        const idx = parseInt($(this).data('index'));
        const removedYear = data.years[idx];
        data.years.splice(idx, 1);
        data.items.forEach(item => { delete item.values[removedYear]; });
        renderFinancialTable(data, containerId);
    });

    // 년도 추가
    $container.on('click', '#add-year-btn', function() {
        const data = collectFinancialData(containerId);
        if (data.years.length >= MAX_YEARS) return;
        const lastYear = data.years.length > 0 ? parseInt(data.years[data.years.length - 1]) || new Date().getFullYear() : new Date().getFullYear();
        data.years.push(String(lastYear + 1));
        renderFinancialTable(data, containerId);
    });

    // 항목 삭제
    $container.on('click', '.btn-remove-item', function() {
        $(this).closest('.fin-item-row').remove();
    });

    // 항목 추가
    $container.on('click', '#add-item-btn', function() {
        const data = collectFinancialData(containerId);
        data.items.push({ key: `custom_${Date.now()}`, label: '', values: {} });
        renderFinancialTable(data, containerId);
        $container.find('.fin-item-row').last().find('.fin-item-label').focus();
    });

    // 숫자 포맷 (콤마) — 음수 허용
    $container.on('input', '.fin-cell', function() {
        let raw = $(this).val().replace(/[^0-9.-]/g, '');
        // 음수 기호는 맨 앞만
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

    // 셀 포커스 스타일
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
