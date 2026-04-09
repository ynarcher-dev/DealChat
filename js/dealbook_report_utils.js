/**
 * DealChat 리포트 모드 공통 유틸리티 (ES Module)
 * 
 * 주요 기능:
 * 1. applyReportMode(config): 리포트 전용 클래스 적용, 워터마크 추가, 입력 필드 비활성화 및 텍스트 변환
 * 2. removeReportMode(): 리포트 모드 해제 및 원래 상태 복구
 * 3. convertIndustryToText(): 산업 select → 텍스트 변환 (공통)
 * 
 * ※ 리포트 CSS는 css/dealbook-report.css 에서 정적으로 관리됩니다.
 *   JS에서는 body.report-mode 클래스 토글만 담당합니다.
 */


/**
 * 재무 전치 테이블을 리포트 모드용 읽기전용 테이블로 변환
 * containerId: 'financial-table-container'
 */
export function reformatFinancialTableTransposed(containerId = 'financial-table-container') {
    const $container = $(`#${containerId}`);
    if (!$container.length || $container.data('report-applied')) return;
    $container.data('report-applied', true);

    function formatNumber(val) {
        if (!val || val === '-' || val === '—') return '—';
        const cleaned = String(val).replace(/,/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num)) return val;
        return num.toLocaleString('ko-KR');
    }

    // 년도 수집 (빈 값 제외)
    const years = [];
    $container.find('.fin-year-header').each(function() {
        const y = $(this).val().trim();
        if (y) years.push(y);
    });

    // 항목 수집 — 값이 하나라도 있는 항목만
    const items = [];
    $container.find('.fin-item-row').each(function() {
        const $row = $(this);
        const label = $row.find('.fin-item-label').val().trim();
        if (!label) return;
        const values = years.map((_, idx) => formatNumber($row.find(`.fin-cell[data-year-index="${idx}"]`).val()));
        if (values.some(v => v !== '—')) items.push({ label, values });
    });

    // 데이터가 없으면 빈 안내
    if (years.length === 0 || items.length === 0) {
        $container.html(`<div style="padding:12px 0; font-size:13px; color:#94a3b8;">재무 정보가 입력되지 않았습니다.</div>`);
        return;
    }

    // 헤더 행: 구분(고정폭) | 년도1 | 년도2 | ...
    const headerCells = [
        `<div class="report-table-cell" style="flex:0 0 120px; min-width:120px; font-weight:700; justify-content:flex-start; text-align:left;">구분</div>`,
        ...years.map(y => `<div class="report-table-cell" style="flex:1; justify-content:center; text-align:center;">${y}</div>`)
    ].join('');

    // 데이터 행들
    const rowsHtml = items.map(item => {
        const cells = [
            `<div class="report-table-cell" style="flex:0 0 120px; min-width:120px; justify-content:flex-start; text-align:left; font-weight:500;">${item.label}</div>`,
            ...item.values.map(v => `<div class="report-table-cell" style="flex:1; justify-content:flex-end; text-align:right;">${v}</div>`)
        ].join('');
        return `<div class="report-table-row">${cells}</div>`;
    }).join('');

    $container.html(`
        <div class="report-table-wrapper" style="margin-top:4px;">
            <div class="report-table-row report-table-header">${headerCells}</div>
            ${rowsHtml}
        </div>
    `);
}

export function shouldEnterReportMode({ viewMode, fromSource, allowedSources = [], isNew = false, isOwner = true }) {
  return viewMode === 'read' || allowedSources.includes(fromSource) || (!isNew && !isOwner);
}

export function applyReportMode(config) {
  const {
    hideSelectors = [],
    textareaIds = [],
    inputIds = [],
    reportTitle = null,      // 리포트용 공통 타이틀 (예: '매도자 정보-DealChat')
    titleSelector = null,    // 타이틀을 적용할 요소 (예: '#seller-name-editor')
    afterApply = null
  } = config;

  // 1. 중복 적용 방지
  if (document.body.classList.contains('report-mode')) return;

  // 2. report-mode 클래스 적용 (CSS가 나머지 처리)
  document.body.classList.add('report-mode');

  // [신규] 리포트용 공통 타이틀 적용 (브라우저 탭 전용)
  if (reportTitle) {
    document.title = reportTitle;
    
    // 사이드바 헤더도 공통 명칭으로 변경 (하이픈 앞부분만 사용)
    const sidebarTitle = reportTitle.split('-')[0].trim();
    $('#sidebar-header-title').text(sidebarTitle);
  }

  // 3. 워터마크 삽입
  if ($('#report-watermark').length === 0) {
    $('<div id="report-watermark">DealChat</div>').appendTo('body');
  }

  // 4. textarea 처리: 내용을 div로 교체하고 원본 textarea 숨김
  if (Array.isArray(textareaIds)) {
    textareaIds.forEach(id => {
      const $ta = $(id.startsWith('#') ? id : `#${id}`);
      if ($ta.length > 0) {
        const content = $ta.val();
        $ta.after($('<div class="report-text-content">').text(content));
        $ta.hide();
      }
    });
  }

  // 5. input/span 처리: 내용을 div로 교체하고 원본 숨김
  if (Array.isArray(inputIds)) {
    inputIds.forEach(id => {
      const $el = $(id.startsWith('#') ? id : `#${id}`);
      if ($el.length > 0) {
        const content = $el.is('input, textarea, select') ? $el.val() : $el.text();
        $el.after($('<div class="report-text-field">').text(content || ''));
        $el.hide();
      }
    });
  }

  // 6. 모든 입력 요소 비활성화 및 contenteditable 해제
  $('input, select, textarea').prop('disabled', true);
  $('[contenteditable]')
    .attr('contenteditable', 'false')
    .parent()
    .css({ 'background': 'transparent', 'border': 'none' });

  // 6. 추가 숨김 셀렉터 처리 (페이지별 고유 요소)
  if (Array.isArray(hideSelectors) && hideSelectors.length > 0) {
    hideSelectors.forEach(sel => {
      $(sel.trim()).hide();
    });
  } else if (typeof hideSelectors === 'string' && hideSelectors.trim()) {
    // 하위 호환: 문자열로 전달된 경우
    $(hideSelectors).hide();
  }

  // 7. 산업 select → 텍스트 변환 (공통)
  convertAllIndustrySelects();

  // 8. 적용 후 콜백 실행
  if (typeof afterApply === 'function') {
    afterApply();
  }
}

export function removeReportMode() {
  // 1. report-mode 클래스 제거
  document.body.classList.remove('report-mode');

  // 2. 워터마크 제거
  $('#report-watermark').remove();

  // 3. 변환된 텍스트 컨텐츠 제거 및 원본 textarea 복원
  $('.report-text-content').each(function() {
    $(this).prev('textarea').show();
    $(this).remove();
  });

  // 4. 변환된 텍스트 필드 제거 및 원본 요소 복원 (input/span 등)
  $('.report-text-field').each(function() {
    $(this).prev().show();
    $(this).remove();
  });

  // 5. 산업 텍스트 복원
  $('.report-industry-text').each(function() {
    $(this).prev('select').show();
    $(this).remove();
  });

  // 6. 입력 가능하도록 입력 요소 활성화
  $('input, select, textarea').prop('disabled', false);

  // 7. contenteditable 속성 복원
  $('[contenteditable]').attr('contenteditable', 'true');

  // 8. 숨긴 요소 복원
  $('[style*="display: none"]').each(function() {
    // 리포트 모드에서 숨긴 요소만 복원 (원래 숨겨진 요소는 건드리지 않음)
  });
}

/**
 * 페이지 내 모든 산업 select를 텍스트로 변환
 * (#industry, #seller-industry, #buyer-industry 자동 탐색)
 */
function convertAllIndustrySelects() {
  const selectors = ['#industry', '#seller-industry', '#buyer-industry'];
  
  selectors.forEach(sel => {
    const $select = $(sel);
    if (!$select.length || $select.next('.report-industry-text').length) return;

    const selectedVal = $select.val();
    let industryText = '-';

    // 기타 처리 (각 페이지별 기타 입력 필드 탐색)
    const $otherInput = $select.parent().find('input[id$="-other"], input[id$="-etc"]');
    
    if (selectedVal === '기타') {
      industryText = ($otherInput.val() || '').trim() || '기타';
    } else if (selectedVal && selectedVal !== '선택해주세요' && selectedVal !== '') {
      industryText = $select.find('option:selected').text();
    }

    const $div = $('<div class="report-industry-text">').text(industryText);
    $select.after($div);
    $select.hide();
    if ($otherInput.length) $otherInput.hide();
  });
}

export function injectReportSectionIcons(iconMap) {
  Object.entries(iconMap).forEach(([id, icon]) => {
    const $el = $(`#${id}`);
    if (!$el.length) return;
    let $p = $el.prev('p');
    if (!$p.length) $p = $el.parent().prev('p');
    if (!$p.length) $p = $el.closest('div').find('p').first();
    if (!$p.length) $p = $el.closest('div').parent().find('p').first();
    if ($p.length) {
      $p.find('span.material-symbols-outlined').remove();
      $p.prepend(`<span class="material-symbols-outlined report-section-icon">${icon}</span>`);
    }
  });
}

/**
 * $rows: 행들을 담은 컨테이너 jQuery 객체 (예: $('#financial-rows'))
 * rowSelector: 개별 행 클래스 (예: '.financial-row')
 * columns: [{ header: '년도', selector: '.fin-year', flex: 1, align: 'center', format: 'number' }, ...]
 *   - align: 'center' | 'right' | 'left' (기본: 'center')
 *   - format: 'number' 지정 시 쉼표 구분 포맷 적용
 */
export function reformatReportTable($rows, rowSelector, columns) {
    if (!$rows.length || $rows.parent('.report-table-wrapper').length) return;

    // 숫자 포맷 헬퍼 (쉼표 구분)
    function formatNumber(val) {
        if (!val || val === '-') return '-';
        // 숫자만 추출 (기존 쉼표 제거 후 재포맷)
        const cleaned = val.replace(/,/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num)) return val; // 숫자가 아닌 경우 원본 반환
        return num.toLocaleString('ko-KR');
    }

    // 1. 데이터 수집
    const data = [];
    $rows.find(rowSelector).each(function() {
        const row = {};
        columns.forEach(col => {
            let val = $(this).find(col.selector).val() || '-';
            if (col.format === 'number') {
                val = formatNumber(val);
            }
            row[col.selector] = val;
        });
        data.push(row);
    });

    // 2. 헤더 생성 (항상 가운데 정렬)
    const headerCells = columns.map(col =>
        `<div class="report-table-cell" style="flex: ${col.flex}; justify-content: center; text-align: center;">${col.header}</div>`
    ).join('');
    const $header = $(`<div class="report-table-row report-table-header">${headerCells}</div>`);

    // 3. 래퍼 구성
    const $wrapper = $('<div class="report-table-wrapper">');
    $rows.before($wrapper);
    $wrapper.append($header).append($rows);

    // 4. 행 교체 (컬럼별 정렬 적용)
    let rowsHtml = '';
    data.forEach(d => {
        const cells = columns.map(col => {
            const align = col.align || 'center';
            const justify = align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';
            return `<div class="report-table-cell" style="flex: ${col.flex}; justify-content: ${justify}; text-align: ${align};">${d[col.selector]}</div>`;
        }).join('');
        rowsHtml += `<div class="report-table-row">${cells}</div>`;
    });
    $rows.html(rowsHtml);
}
