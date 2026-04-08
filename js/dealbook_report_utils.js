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


export function shouldEnterReportMode({ viewMode, fromSource, allowedSources = [], isNew = false, isOwner = true }) {
  return viewMode === 'read' || allowedSources.includes(fromSource) || (!isNew && !isOwner);
}

export function applyReportMode(config) {
  const {
    hideSelectors = [],
    textareaIds = [],
    afterApply = null
  } = config;

  // 1. 중복 적용 방지
  if (document.body.classList.contains('report-mode')) return;

  // 2. report-mode 클래스 적용 (CSS가 나머지 처리)
  document.body.classList.add('report-mode');

  // 3. 워터마크 삽입
  if ($('#report-watermark').length === 0) {
    $('<div id="report-watermark">DealChat</div>').appendTo('body');
  }

  // 4. textarea 처리: 내용을 div로 교체하고 원본 textarea 숨김
  if (Array.isArray(textareaIds)) {
    textareaIds.forEach(id => {
      const $ta = $(`#${id}`);
      if ($ta.length > 0) {
        const content = $ta.val();
        $ta.after($('<div class="report-text-content">').text(content));
        $ta.hide();
      }
    });
  }

  // 5. 모든 입력 요소 비활성화 및 contenteditable 해제
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

  // 4. 산업 텍스트 복원
  $('.report-industry-text').each(function() {
    $(this).prev('select').show();
    $(this).remove();
  });

  // 5. 입력 가능하도록 입력 요소 활성화
  $('input, select, textarea').prop('disabled', false);

  // 6. contenteditable 속성 복원
  $('[contenteditable]').attr('contenteditable', 'true');

  // 7. 숨긴 요소 복원
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
