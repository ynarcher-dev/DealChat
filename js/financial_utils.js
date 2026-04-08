/**
 * 기업 상세 페이지용 재무 정보 행 생성 (dealbook_companies.js 전용)
 */
export function createFinancialRow(year = '', revenue = '', profit = '', net = '') {
    const rowId = `fin-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const rowHtml = `
        <div class="financial-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; padding: 0 36px 0 12px; box-sizing: border-box; width: 100%;">
            <input type="text" class="fin-year" value="${year}" placeholder="연도"
                style="flex: 1; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: center; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
            <input type="text" class="fin-revenue format-number" value="${revenue}" placeholder="매출액"
                style="flex: 2; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
            <input type="text" class="fin-profit format-number" value="${profit}" placeholder="영업이익"
                style="flex: 2; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
            <input type="text" class="fin-net format-number" value="${net}" placeholder="순이익"
                style="flex: 2; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
            <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #cbd5e1; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -30px; transition: color 0.2s;">
                <span class="material-symbols-outlined" style="font-size: 18px;">do_not_disturb_on</span>
            </button>
        </div>
    `;
    $('#financial-rows').append(rowHtml);
}

/**
 * 매도인 상세 페이지용 재무 정보 행 생성 (dealbook_sellers.js 전용)
 * 주의: 이 함수는 외부 스코프의 isNew, currentSellerData 변수에 의존할 수 있으므로 
 * 호출 시 환경에 맞게 조정이 필요할 수 있습니다.
 */
export function createSellerFinancialRow(y='', r='', p='', n='', e='') {
    // Note: isNew and currentSellerData are normally in the closure of dealbook_sellers.js
    // If they are not globally available or passed in, this may require refactoring.
    // For now, we follow the instruction to "move" the function.
    const isEnabled = $('#seller-name-editor').attr('contenteditable') !== 'false' && (window.isNew || !!window.currentSellerData);
    const statusClass = isEnabled ? 'field-active' : 'field-disabled';

    const row = $(`<div class="financial-row" style="margin-bottom: 8px;">
        <input type="text" class="fin-year ${statusClass}" placeholder="년도" value="${y}" style="flex:1;" ${isEnabled ? '' : 'readonly'}>
        <input type="text" class="fin-revenue ${statusClass}" placeholder="매출" value="${r}" style="flex:2;" ${isEnabled ? '' : 'readonly'}>
        <input type="text" class="fin-profit ${statusClass}" placeholder="영업익" value="${p}" style="flex:2;" ${isEnabled ? '' : 'readonly'}>
        <input type="text" class="fin-net-profit ${statusClass}" placeholder="순익" value="${n}" style="flex:2;" ${isEnabled ? '' : 'readonly'}>
        <input type="text" class="fin-ev-ebitda ${statusClass}" placeholder="EV/EB" value="${e}" style="flex:1;" ${isEnabled ? '' : 'readonly'}>
        <button type="button" class="btn-remove-row" title="삭제" style="${isEnabled ? '' : 'display:none;'}">
            <span class="material-symbols-outlined" style="font-size:18px;">close</span>
        </button>
    </div>`);
    $('#financial-rows').append(row);
}
