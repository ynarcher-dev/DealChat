import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, downloadTextFile, isAiPendingRetry } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER, showLoader } from './auth_utils.js';
import * as sharingUtils from './sharing_utils.js';
import { escapeForDisplay, tryRepairJson, applyKeywordsMasking, maskWithCircles } from './utils.js';
import { initModelSelector } from './model_selector.js';
import { applyReportMode, removeReportMode, shouldEnterReportMode, injectReportSectionIcons, reformatFinancialTableTransposed } from './dealbook_report_utils.js';
import { autoResizeTextarea } from './textarea_utils.js';
import { migrateFinancialInfo, renderFinancialTable, collectFinancialData, mergeFinancialData } from './financial_utils.js';
import { getSignedFileUrl } from './file_render_utils.js';
import { assignBlindLabels } from './my_list_utils.js';
import { showToast, showPanelOverlay } from './toast_utils.js';
import { beginAiAutofillUx } from './ai_skeleton_utils.js';


// 프로필 모달 스크립트 로드
const script = document.createElement('script');
script.src = '../js/profile_modal.js';
document.head.appendChild(script);

// 수파베이스 클라이언트 초기화 통합
const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

$(document).ready(function () {
    // ==========================================
    // 인증 및 초기화
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    let sellerId = urlParams.get('id');   // 'new' 또는 실제 ID
    const fromSource = urlParams.get('from'); // 'totalseller' 등 유입 경로
    const viewMode = urlParams.get('mode');
    let isNew = sellerId === 'new';
    window.isNew = isNew; // Expose to window for financial_utils.js

    // [New] 이전 페이지(목록)로 돌아갈 URL 설정
    let returnUrl = resolveUrl('/my_sellers');
    if (fromSource === 'totalseller' || fromSource === 'total_sellers') {
        returnUrl = resolveUrl('/total_sellers');
    }

    // [New] 헤더의 뒤로가기 버튼 URL 업데이트
    $('.btn-icon-only[title="이전으로"]').off('click').on('click', function() {
        location.href = returnUrl;
    });

    let userData = null;
    try {
        userData = JSON.parse(localStorage.getItem('dealchat_users'));
    } catch (e) {}

    // 비회원 & 외부 공유 링크인 경우 예외 허용
    if (!userData || !userData.isLoggedIn) {
        if (fromSource === 'shared' && sellerId) {

            // loadSellerData handles NDA and redirect
        } else {
            checkAuth(); // 로그인 페이지로 리다이렉트
            return;
        }
    } else {
        updateHeaderProfile(userData);
        initUserMenu();
    }

    // [RBAC] 매수자 등급 및 공유 링크 접근 시 보안 설정: 드래그 및 우클릭 금지
    const isBuyer = userData && userData.role === 'buyer';
    const isSharedLink = fromSource === 'shared';
    if (isBuyer || isSharedLink) {
        $('body').css({
            '-webkit-user-select': 'none',
            '-moz-user-select': 'none',
            '-ms-user-select': 'none',
            'user-select': 'none'
        });
        $(document).on('dragstart contextmenu', function(e) {
            e.preventDefault();
            return false;
        });
    }

    const user_id = userData ? userData.id : null;

    // 블라인드 설정 전역 변수
    let isBlindActive = true;
    let blindKeywords = [];
    let blindPersonal = { name: true, ceo: true, email: true, establishment: true, address: true, fin_summary: true, fin_analysis: true };
    let blindNameStructured = null; // total_sellers와 동일 포맷의 매물번호 (예: "IT A-007")
    
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    let currentSellerData = null;
    window.currentSellerData = currentSellerData; // Expose to window for financial_utils.js
    let availableFiles = [];
    let pendingFiles = []; // [추가] 신규 생성 시 업로드된 파일 임시 보관용
    let conversationHistory = [];
    let currentSourceType = 'training';
    let myCompanies = [];
    let selectedCompanyId = null; // 선택된 기업의 UUID 추적
    let isDirectInputMode = false; // 직접 입력 모드 추적

    // ==========================================
    // AI 모델 선택기
    // ==========================================
    const { markModelAsExceeded, getCurrentModelId } = initModelSelector(addAiResponse);
    

    // 기업 정보 파싱 함수
    function parseCompanyData(company) {
        const parsed = { ...company };
        parsed.companyName = company.name || company.company_name || company.companyName || "";
        parsed.ceoName = company.ceo_name || company.ceoName || "";
        parsed.companyEmail = company.email || company.companyEmail || "";
        parsed.establishmentDate = company.establishment_date || company.establishmentDate || "";
        parsed.companyAddress = company.address || company.companyAddress || "";
        parsed.financialAnalysis = company.financial_analysis || company.financialAnalysis || "";
        parsed.managerMemo = company.manager_memo || company.managerMemo || "";

        if (Array.isArray(company.financial_info) && company.financial_info.length > 0) parsed.financialDataArr = company.financial_info;
        else if (Array.isArray(company.financial_data) && company.financial_data.length > 0) parsed.financialDataArr = company.financial_data;

        if (!company.summary) return parsed;
        const summaryText = company.summary;
        try {
            let mainSummary = "";
            let metaText = "";
            if (summaryText.includes('[상세 정보]')) {
                const parts = summaryText.split('[상세 정보]');
                mainSummary = parts[0].trim();
                metaText = parts[1] || "";
            } else {
                const metaKeywords = ["관리 현황:", "투자 유무:", "대표자명:", "이메일:", "설립일자:", "주소:", "재무 현황:", "재무 분석:", "해당자 의견:"];
                let firstIndex = -1;
                metaKeywords.forEach(kw => {
                    const idx = summaryText.indexOf(kw);
                    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
                });
                if (firstIndex !== -1) {
                    mainSummary = summaryText.substring(0, firstIndex).trim();
                    metaText = summaryText.substring(firstIndex);
                } else {
                    mainSummary = summaryText;
                }
            }
            parsed.parsedSummary = mainSummary.replace(/^(\[.*?\]|#\S+)\s*/, '').trim();

            if (metaText) {
                const ceoMatch = metaText.match(/대표자명\s*:\s*(.*)/);
                if (ceoMatch && !parsed.ceoName) parsed.ceoName = ceoMatch[1].split('\n')[0].trim();
                const emailMatch = metaText.match(/이메일\s*:\s*(.*)/);
                if (emailMatch && !parsed.companyEmail) parsed.companyEmail = emailMatch[1].split('\n')[0].trim();
                const dateMatch = metaText.match(/설립일자\s*:\s*(.*)/);
                if (dateMatch && !parsed.establishmentDate) parsed.establishmentDate = dateMatch[1].split('\n')[0].trim();
                const addressMatch = metaText.match(/주소\s*:\s*(.*)/);
                if (addressMatch && !parsed.companyAddress) parsed.companyAddress = addressMatch[1].split('\n')[0].trim();
                const finAnalysisMatch = metaText.match(/재무\s*분석\s*:\s*((?:.|\n)*?)(?=(?=대표자명|이메일|설립일자:|주소:|재무 현황:|해당자 의견:|$))/);
                if (finAnalysisMatch && !parsed.financialAnalysis) parsed.financialAnalysis = finAnalysisMatch[1].trim();
                const memoMatch = metaText.match(/해당자\s*의견\s*:\s*((?:.|\n)*?)(?=(?=대표자명|이메일|설립일자:|주소:|재무 현황:|재무 분석:|$))/);
                if (memoMatch && !parsed.managerMemo) parsed.managerMemo = memoMatch[1].trim();
            }
        } catch (e) { console.error('Error parsing company summary:', e); }
        return parsed;
    }

    // 내 기업 목록 로드
    async function loadMyCompanies() {
        try {
            const { data, error } = await _supabase
                .from('companies')
                .select('*')
                .eq('user_id', user_id)
                .is('deleted_at', null);

            if (data && !error) {
                myCompanies = data.map(parseCompanyData);
                if (myCompanies.length > 0) {
                    const $toast = $(`<div id="data-load-toast" style="position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); 
                                    background: rgba(15, 23, 42, 0.9); color: white; padding: 10px 24px; border-radius: 30px; 
                                    font-size: 13px; z-index: 99999; box-shadow: 0 10px 25px rgba(0,0,0,0.2); 
                                    display: flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,0.1);">
                                    <span class="material-symbols-outlined" style="font-size: 18px; color: #4ade80;">check_circle</span>
                                    기존 기업 데이터가 연동되었습니다. (${myCompanies.length}개)
                                 </div>`);
                    $('body').append($toast);
                    setTimeout(() => $toast.fadeOut(1000, function() { $(this).remove(); }), 3000);
                }
            }
        } catch (err) { console.error('Load companies critical error:', err); }
    }
    loadMyCompanies();

    // 기업 선택 시 필드 채우기
    async function fillCompanyFields(company) {
        if (!company) return;
        const companyName = company.companyName || '';
        // 기업명 반영 (검색 모드에서는 비활성화 유지)
        $('#seller-name-editor').text(companyName);
        // 검색 모드에서 선택된 경우: 기업명 필드는 비활성화 유지
        if (!isDirectInputMode) {
            disableSellerNameEditor();
        }
        document.title = `${companyName || '매도인'} - 매도인 정보`;
        $('#sidebar-header-title').text(companyName || '매도인 정보');
        
        // [산업군 로직 개선] 커스텀 산업군 및 '기타: ' 접두사 대응
        const industryVal = company.industry || '';
        const $industrySelect = $('#seller-industry');
        const $industryEtc = $('#seller-industry-etc');

        if (industryVal.startsWith('기타: ')) {
            $industrySelect.val('기타').trigger('change');
            $industryEtc.val(industryVal.replace('기타: ', ''));
        } else {
            const hasOption = $industrySelect.find(`option[value="${industryVal}"]`).length > 0;
            if (hasOption && industryVal !== '기타') {
                $industrySelect.val(industryVal).trigger('change');
            } else if (industryVal) {
                $industrySelect.val('기타').trigger('change');
                $industryEtc.val(industryVal === '기타' ? '' : industryVal);
            } else {
                $industrySelect.val('선택해주세요').trigger('change');
            }
        }

        $('#seller-ceo').val(company.ceoName || '');
        $('#seller-email').val(company.companyEmail || '');
        $('#seller-establishment').val(company.establishmentDate || '');
        $('#seller-address').val(company.companyAddress || '');
        $('#seller-summary').val(company.parsedSummary || company.summary || '');
        $('#seller-key-products').val(company.key_products || '');
        $('#seller-fin-analysis').val(company.financialAnalysis || '');
        
        // [추가] 기업명을 키워드 블라인드에 자동 추가
        if (companyName && !blindKeywords.includes(companyName)) {
            blindKeywords.push(companyName);
            renderBlindTags();
        }

        const finSource = company.financialDataArr || company.financial_info || company.financial_data;
        renderFinancialTable(migrateFinancialInfo(finSource, 'sellers'), 'financial-table-container', 'sellers');
        toggleCompanyFields(true);
        
        // 신규 매도자 생성 시 복수의 티저(글)를 작성할 수 있도록 
        // 기존의 sellerData를 강제로 불러와서 덮어씌우는(isNew = false) 로직을 제거하고,
        // 매도자 전용 필드를 초기화합니다.
        $('#seller-price').val('협의').prop('readonly', true).css('background', '#f8fafc');
        $('#negotiable-check').prop('checked', true);
        $('#seller-method').val('협의').prop('readonly', true).css('background', '#f8fafc');
        $('#method-negotiable-check').prop('checked', true);
        $('#seller-memo').val('');
        $('#seller-manager-memo').val('');
        if (typeof setChip === 'function') setChip('대기');
        $('#btn-delete-seller').hide();
        autoResizeAllTextareas();
        
        // 검색박스에 선택된 기업명 반영 및 readonly 처리
        $('#company-search-input').val(companyName).prop('readonly', true).css({ 'background': '#f5f3ff', 'color': '#7c3aed', 'font-weight': '600', 'border-color': '#ddd6fe' });
        
        loadAvailableFiles(); // 데이터 소스 패널(학습 데이터) 새로고침 추가
    }

    // 기업명 필드 비활성화 헬퍼
    function disableSellerNameEditor() {
        const $editor = $('#seller-name-editor');
        $editor.attr('contenteditable', 'false');
        $editor.css({ 'color': '#94a3b8', 'cursor': 'not-allowed' });
        $editor.closest('.db-field-wrapper').css({ 'background-color': '#f8fafc' });
    }

    // 기업명 필드 활성화 헬퍼
    function enableSellerNameEditor() {
        const $editor = $('#seller-name-editor');
        $editor.attr('contenteditable', 'true');
        $editor.css({ 'color': '#1e293b', 'cursor': 'auto' });
        $editor.closest('.db-field-wrapper').css({ 'background-color': '#ffffff' });
    }

    function toggleCompanyFields(isEnabled) {
        const activeStyle = { 'background-color': '#ffffff', 'color': '#1e293b', 'cursor': 'auto' };
        const disabledStyle = { 'background-color': '#f8fafc', 'color': '#94a3b8', 'cursor': 'not-allowed' };
        const currentStyle = isEnabled ? activeStyle : disabledStyle;

        const targetFields = [
            { el: $('#seller-industry'), type: 'select' },
            { el: $('#seller-ceo'), type: 'input' },
            { el: $('#seller-email'), type: 'input' },
            { el: $('#seller-establishment'), type: 'input' },
            { el: $('#seller-address'), type: 'input' },
            { el: $('#seller-summary'), type: 'textarea' },
            { el: $('#seller-key-products'), type: 'textarea' },
            { el: $('#seller-fin-analysis'), type: 'textarea' },
            { el: $('#seller-price'), type: 'input' },
            { el: $('#seller-method'), type: 'input' },
            { el: $('#seller-memo'), type: 'textarea' },
            { el: $('#seller-manager-memo'), type: 'textarea' },
            { el: $('#private-memo'), type: 'textarea' }
        ];

        targetFields.forEach(({ el, type }) => {
            if (type === 'select') el.prop('disabled', !isEnabled);
            else el.prop('readonly', !isEnabled);
            el.removeClass('field-active field-disabled').addClass(isEnabled ? 'field-active' : 'field-disabled');
        });

        // 기업명 필드: 직접 입력 모드일 때만 활성화
        if (isEnabled && isDirectInputMode) {
            enableSellerNameEditor();
        } else if (!isEnabled) {
            disableSellerNameEditor();
        }
        // 검색 선택 모드에서는 기업명 비활성화 유지 (별도 처리 불필요)

        // 체크박스 및 토글 처리
        $('#negotiable-check').prop('disabled', !isEnabled);
        $('#method-negotiable-check').prop('disabled', !isEnabled);
        $('.blind-check').prop('disabled', !isEnabled);


        // 버튼들 처리
        $('#ai-auto-fill-btn').prop('disabled', !isEnabled).css({ 'opacity': isEnabled ? '1' : '0.5', 'cursor': isEnabled ? 'pointer' : 'not-allowed' });
        // 재무 전치 테이블 입력 필드 활성화/비활성화
        $('#financial-table-container input').each(function() {
            $(this).prop('readonly', !isEnabled);
        });
        $('#financial-table-container button').toggle(isEnabled);
        $('#blind-tag-input').prop('readonly', !isEnabled).removeClass('field-active field-disabled').addClass(isEnabled ? 'field-active' : 'field-disabled');
        $('.btn-status-chip').css({ 'pointer-events': isEnabled ? 'auto' : 'none', 'opacity': isEnabled ? '1' : '0.7' });
    }

    // 기업명 입력 이벤트 (직접 입력 모드에서의 제목 업데이트만)
    $('#seller-name-editor').on('input focus keyup focusin', function() {
        const name = $(this).text().trim() || '매도인';
        document.title = `${name} - 매도인 정보`;
        $('#sidebar-header-title').text(name || '매도인 정보');
    });

    // [신규] 우측 패널 기업명 검색 이벤트
    $(document).on('input focus', '#company-search-input', function() {
        const query = $(this).val().trim().toLowerCase();
        const $suggestions = $('#company-search-suggestions');
        
        if (!query) { $suggestions.hide(); return; }
        
        const filtered = myCompanies.filter(c => 
            (c.name || "").toLowerCase().includes(query) || 
            (c.companyName || "").toLowerCase().includes(query)
        );
        
        $suggestions.empty().show();

        if (filtered.length > 0) {
            filtered.slice(0, 10).forEach(c => {
                const $item = $(`<div style="padding: 14px 20px; cursor: pointer; border-bottom: 1px solid #f8fafc; transition: all 0.2s ease;">
                                    <div style="display: flex; align-items: center; justify-content: space-between;">
                                        <div style="font-weight: 700; color: #1e293b; font-size: 14px;">${c.name || c.companyName || ""}</div>
                                        <div style="font-size: 11px; background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 6px;">${c.industry || '기타'}</div>
                                    </div>
                                    <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${c.companyAddress || '주소 정보 없음'}
                                    </div>
                                 </div>`);
                $item.on('mouseenter', function() { $(this).css({ 'background': '#f5f3ff', 'padding-left': '24px' }); })
                     .on('mouseleave', function() { $(this).css({ 'background': 'transparent', 'padding-left': '20px' }); });
                $item.on('mousedown', (e) => { 
                    e.preventDefault(); 
                    isDirectInputMode = false;
                    selectedCompanyId = c.id; 
                    fillCompanyFields(c); 
                    $suggestions.hide();
                });
                $suggestions.append($item);
            });
        } else {
            $suggestions.append(`<div style="padding: 12px 16px; font-size: 13px; color: #94a3b8; text-align: center;">검색 결과가 없습니다</div>`);
        }
    });

    // 검색창 외부 클릭 시 드롭다운 닫기
    $(document).on('click', function(e) {
        if (!$(e.target).closest('#company-search-input, #company-search-suggestions').length) {
            $('#company-search-suggestions').hide();
        }
    });

    // [신규] 직접 입력 버튼
    $(document).on('click', '#btn-direct-input', function() {
        isDirectInputMode = true;
        selectedCompanyId = null;
        
        // 기업명 필드 활성화
        enableSellerNameEditor();
        $('#seller-name-editor').text('').focus();
        
        // 모든 필드 활성화
        toggleCompanyFields(true);
        
        // 검색 입력 초기화
        $('#company-search-input').val('').prop('readonly', false).css({ 'background': '#ffffff', 'color': '#1e293b', 'font-weight': '400', 'border-color': '' });
        $('#company-search-suggestions').hide();
        
        showToast('직접 입력 모드가 활성화되었습니다.', { icon: 'edit_note', iconColor: '#7c3aed', duration: 2000 });
    });

    // [신규] 검색박스 지우기 (검색박스가 readonly인 상태에서 클릭 시 초기화)
    $(document).on('click', '#company-search-input', function() {
        if ($(this).prop('readonly')) {
            selectedCompanyId = null;
            $(this).val('').prop('readonly', false).css({ 'background': '#ffffff', 'color': '#1e293b', 'font-weight': '400', 'border-color': '' }).focus();
            
            // 기업명 필드 비활성화 (검색 모드로 돌아감)
            isDirectInputMode = false;
            disableSellerNameEditor();
            $('#seller-name-editor').text('');
            document.title = '매도인 - 매도인 정보';
            $('#sidebar-header-title').text('매도인 정보');
            
            // 모든 필드 비활성화
            toggleCompanyFields(false);
            renderFinancialTable(migrateFinancialInfo(null, 'sellers'), 'financial-table-container', 'sellers');
            loadAvailableFiles();
        }
    });

    $('#seller-industry').on('change', function() {
        if ($(this).val() === '기타') $('#seller-industry-etc').show().focus();
        else $('#seller-industry-etc').hide();
    });

    $('#negotiable-check').on('change', function() {
        const $priceInput = $('#seller-price');
        if ($(this).is(':checked')) $priceInput.val('협의').prop('readonly', true).css('background', '#f8fafc');
        else $priceInput.val('').prop('readonly', false).css('background', '#ffffff').focus();
    });

    $('#method-negotiable-check').on('change', function() {
        const $methodInput = $('#seller-method');
        if ($(this).is(':checked')) $methodInput.val('협의').prop('readonly', true).css('background', '#f8fafc');
        else $methodInput.val('').prop('readonly', false).css('background', '#ffffff').focus();
    });

    // 블라인드 설정 핸들러


    $('#blind-tag-input').on('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = $(this).val().replace(/,/g, '').trim();
            if (val && !blindKeywords.includes(val)) {
                blindKeywords.push(val);
                renderBlindTags();
                if (document.body.classList.contains('report-mode')) applyBlindMasking();
            }
            $(this).val('');
        }
    });

    function renderBlindTags() {
        const $tagList = $('#blind-tag-list');
        $tagList.empty();
        blindKeywords.forEach((kw, idx) => {
            const $tag = $(`<div style="background: #fde68a; color: #b45309; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                #${kw} <span class="material-symbols-outlined btn-remove-tag" data-index="${idx}" style="font-size: 14px; cursor: pointer;">close</span>
                            </div>`);
            $tagList.append($tag);
        });
    }

    $(document).on('click', '.btn-remove-tag', function() {
        const index = $(this).data('index');
        blindKeywords.splice(index, 1);
        renderBlindTags();
        if ($('#report-mode-css').length) applyBlindMasking();
    });

    $('.blind-check').on('change', function() {
        const field = $(this).data('field');
        blindPersonal[field] = $(this).is(':checked');
        if ($('#report-mode-css').length) applyBlindMasking();
    });

    // 데이터 로드 메인 함수
    async function loadSellerData() {
        if (isNew) {
            setChip('대기');
            // 신규 시에도 기본 재무 정보 표 렌더링 (금융 유틸리티 사용)
            renderFinancialTable(migrateFinancialInfo(null, 'sellers'), 'financial-table-container', 'sellers');
            
            toggleCompanyFields(false); // Initial State: Disable all fields
            disableSellerNameEditor(); // 기업명 필드도 비활성화
            $('#btn-delete-seller').hide();
            hideLoader();
            $('body').removeClass('is-loading');
            loadAvailableFiles(); // [추가] 초기 파일 목록 로드 호출 보장
            return;
        }

        try {
            let seller = null;
            const [sellerRes, allSellersRes] = await Promise.all([
                _supabase.from('sellers').select('*, companies(*)').eq('id', sellerId).maybeSingle(),
                _supabase.from('sellers').select('id, industry, created_at').is('deleted_at', null)
            ]);
            const fullData = sellerRes.data;

            if (fullData) seller = fullData;

            // total_sellers와 동일한 시리얼(매물번호) 계산
            if (Array.isArray(allSellersRes.data)) {
                assignBlindLabels(allSellersRes.data);
                const me = allSellersRes.data.find(s => String(s.id) === String(sellerId));
                if (me && me.blind_name_structured) blindNameStructured = me.blind_name_structured;
            }

            if (!seller) {
                alert('정보를 찾을 수 없거나 접근 권한이 없습니다.');
                location.href = resolveUrl('/my_sellers');
                return;
            }

            // [Refactored] NDA 체크 (작성자 본인 확인 절차 추가)
            // 작성자 본인인 경우 NDA 게이트를 건너뜁니다.
            const isOwner = user_id && String(seller.user_id) === String(user_id);
            
            if (!isOwner && (fromSource === 'shared' || fromSource === 'totalseller' || fromSource === 'total_sellers')) {
                const isSigned = await sharingUtils.checkNdaStatus(_supabase, sellerId, user_id, 'seller');
                if (!isSigned) {
                    $('body').addClass('nda-active');          // 배경 차단 클래스 추가
                    sharingUtils.initNdaGate(_supabase, sellerId, 'seller', userData, {
                        fromSource,
                        returnUrl: resolveUrl('/total_sellers'),
                        onSuccess: () => location.reload()
                    });
                    // 모달이 닫힐 때(취소 포함) nda-active 제거
                    document.getElementById('nda-modal').addEventListener('hidden.bs.modal', () => {
                        $('body').removeClass('nda-active');
                    }, { once: true });
                    return;
                }
            }

            currentSellerData = seller;
            window.currentSellerData = currentSellerData;
            $('#btn-delete-seller').show();
            blindKeywords = Array.isArray(seller.blind_keywords) ? seller.blind_keywords : [];
            const defaultBlind = { name: true, ceo: true, email: true, establishment: true, address: true, fin_summary: true, fin_analysis: true };
            blindPersonal = { ...defaultBlind, ...(seller.blind_personal || {}) };
            renderBlindTags();
            $('#blind-check-name').prop('checked', blindPersonal.name);
            $('#blind-check-ceo').prop('checked', blindPersonal.ceo);
            $('#blind-check-email').prop('checked', blindPersonal.email);
            $('#blind-check-establishment').prop('checked', blindPersonal.establishment);
            $('#blind-check-address').prop('checked', blindPersonal.address);
            $('#blind-check-fin-summary').prop('checked', blindPersonal.fin_summary);
            $('#blind-check-fin-analysis').prop('checked', blindPersonal.fin_analysis);

            const company = seller.companies || {};
            const sellerName = seller.name || company.name || '비공개 기업';
            $('#sidebar-header-title').text(sellerName);
            document.title = sellerName + ' - 매도인 정보';
            
            const updatedDate = new Date(seller.updated_at || seller.created_at).toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
            $('#memo-update-date').text(`최종 수정: ${updatedDate}`);
            $('#seller-name-editor').text(sellerName);
            // [산업군 로직 개선] 커스텀 산업군 및 '기타: ' 접두사 대응
            const industryVal = seller.industry || company.industry || '';
            const $industrySelect = $('#seller-industry');
            const $industryEtc = $('#seller-industry-etc');

            if (industryVal.startsWith('기타: ')) {
                $industrySelect.val('기타').trigger('change');
                $industryEtc.val(industryVal.replace('기타: ', ''));
            } else {
                const hasOption = $industrySelect.find(`option[value="${industryVal}"]`).length > 0;
                if (hasOption && industryVal !== '기타') {
                    $industrySelect.val(industryVal).trigger('change');
                } else if (industryVal) {
                    $industrySelect.val('기타').trigger('change');
                    $industryEtc.val(industryVal === '기타' ? '' : industryVal);
                } else {
                    $industrySelect.val('선택해주세요').trigger('change');
                }
            }


            $('#seller-ceo').val(seller.ceo_name || company.ceo_name || '');
            $('#seller-email').val(seller.email || company.email || '');
            $('#seller-establishment').val(seller.establishment_date || company.establishment_date || '');
            $('#seller-address').val(seller.address || company.address || '');
            $('#seller-price').val(seller.matching_price || seller.sale_price || '');
            if ($('#seller-price').val() === '협의') {
                $('#negotiable-check').prop('checked', true);
                $('#seller-price').prop('readonly', true).css('background', '#f8fafc');
            } else {
                $('#negotiable-check').prop('checked', false);
                $('#seller-price').prop('readonly', false).css('background', '#ffffff');
            }
            $('#seller-summary').val(seller.summary || company.summary || '');
            $('#seller-key-products').val(seller.key_products || company.key_products || '');
            $('#seller-fin-analysis').val(seller.financial_analysis || company.financial_analysis || '');
            $('#seller-memo').val(seller.sale_info || '');
            $('#seller-manager-memo').val(seller.manager_memo || '');
            $('#private-memo').val(seller.private_memo || '');
            setChip(seller.status || '대기');
            $('#seller-method').val((['대기', '진행중', '완료'].includes(seller.sale_method)) ? '' : (seller.sale_method || ''));
            if ($('#seller-method').val() === '협의') {
                $('#method-negotiable-check').prop('checked', true);
                $('#seller-method').prop('readonly', true).css('background', '#f8fafc');
            } else {
                $('#method-negotiable-check').prop('checked', false);
                $('#seller-method').prop('readonly', false).css('background', '#ffffff');
            }

            const finData = seller.financial_info || company.financial_info || null;
            renderFinancialTable(migrateFinancialInfo(finData, 'sellers'), 'financial-table-container', 'sellers');

            const authorId = seller.user_id;
            const { data: authorData } = authorId ? await _supabase.from('users').select('*').eq('id', authorId).maybeSingle() : { data: null };
            const author = authorData || DEFAULT_MANAGER;
            const $card = $('#memo-author-card');
            $card.find('.user-name').text(author.name || DEFAULT_MANAGER.name).css({'color':'#000','font-weight':'700'});
            $card.find('.user-company').text(author.company || 'DealChat');
            $card.find('.user-affiliation').text(author.department || author.affiliation || '-');
            $card.find('.user-avatar').attr('src', resolveAvatarUrl(author.avatar || author.avatar_url, 1));
            if (!author.email) {
                $card.find('.user-email-sep, .user-email').hide();
            } else {
                $card.find('.user-email').text(author.email);
                $card.find('.user-email-sep, .user-email').show();
            }
            $card.css('cursor', 'pointer').off('click').on('click', () => {
                if (author.email) {
                    navigator.clipboard.writeText(author.email).then(() => {
                        const $toast = $('#share-toast');
                        if ($toast.length) {
                            $toast.find('span').text('check_circle'); $toast.contents().last()[0].textContent = ' 담당자 이메일 복사 완료';
                            $toast.css('display', 'flex').hide().fadeIn(200).delay(2000).fadeOut(400);
                        } else alert('이메일 복사 완료: ' + author.email);
                    });
                }
            }).attr('title', '이메일 복사');

            autoResizeAllTextareas();
            if (shouldEnterReportMode({ viewMode, fromSource, allowedSources: ['totalseller', 'total_sellers', 'shared'], isNew, isOwner })) {
                applySellerReadOnlyMode();
                applyBlindMasking();
            } else if (seller.companies) {
                // 기존 데이터: 기업 연동이 된 경우 → 검색 모드 (기업명 비활성화)
                isDirectInputMode = false;
                selectedCompanyId = seller.company_id;
                toggleCompanyFields(true);
                disableSellerNameEditor();
                
                // 검색박스에 연동된 기업명 반영
                const linkedName = sellerName;
                $('#company-search-input').val(linkedName).prop('readonly', true).css({ 'background': '#f5f3ff', 'color': '#7c3aed', 'font-weight': '600', 'border-color': '#ddd6fe' });
            } else {
                // 기존 데이터: 기업 연동이 안 된 경우 → 직접 입력 모드
                isDirectInputMode = true;
                toggleCompanyFields(true);
                enableSellerNameEditor();
            }

            loadAvailableFiles();
            if (seller.history && Array.isArray(seller.history)) {
                conversationHistory = seller.history;
                conversationHistory.forEach(msg => addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false));
            }
        } catch (err) { console.error('Load error:', err); }
        finally { hideLoader(); $('body').removeClass('is-loading'); }
    }

    function buildPayload(isDraft) {
        const name = $('#seller-name-editor').text().trim();
        const rawIndustryEtc = $('#seller-industry-etc').val().trim();
        const industry = $('#seller-industry').val() === '기타' ? (rawIndustryEtc ? `기타: ${rawIndustryEtc}` : '기타') : $('#seller-industry').val();

        const summary = $('#seller-summary').val().trim();
        const price = $('#seller-price').val().trim();
        const method = $('#seller-method').val().trim();
        const sale_info = $('#seller-memo').val().trim() || '매각 가능성 검토를 위한 기초 시장 조사 단계';
        const manager_memo = $('#seller-manager-memo').val().trim();
        const status = $('.btn-status-chip.active').text().trim();
        const ceo = $('#seller-ceo').val().trim();
        const email = $('#seller-email').val().trim();
        const establishment = $('#seller-establishment').val().trim();
        const address = $('#seller-address').val().trim();
        const fin_analysis = $('#seller-fin-analysis').val().trim();
        const key_products = $('#seller-key-products').val().trim();
        const private_memo = $('#private-memo').val().trim();

        const financial_data = collectFinancialData('financial-table-container');

        if (!name || industry === '선택해주세요' || !summary) { alert('기업명, 산업, 소개는 필수입니다.'); return null; }

        return {
            company_id: currentSellerData ? currentSellerData.company_id : (selectedCompanyId || null),
            name, industry, ceo_name: ceo, email, establishment_date: establishment, address, summary,
            financial_info: financial_data, financial_analysis: fin_analysis,
            matching_price: price, sale_method: method, sale_info, manager_memo, status: status || '대기',
            key_products,
            is_draft: isDraft, user_id: user_id, updated_at: new Date().toISOString(),
            is_blind_active: isBlindActive, blind_keywords: blindKeywords, blind_personal: blindPersonal,
            private_memo
        };
    }

    async function saveSeller(isDraft, $btn) {
        if (!$('#seller-price').val().trim() && !$('#negotiable-check').is(':checked')) $('#negotiable-check').prop('checked', true).trigger('change');

        const payload = buildPayload(isDraft);
        if (!payload) return;

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin-animation" style="font-size:16px;">sync</span> 저장 중...');
        try {
            let res;
            if (isNew) {
                res = await _supabase.from('sellers').insert(payload).select().single();
                if (!res.error && res.data && pendingFiles.length > 0) {
                    const newId = res.data.id;
                    const pendingIds = pendingFiles.map(f => f.id);
                    await _supabase.from('files')
                        .update({ entity_id: newId, entity_type: 'seller' })
                        .in('id', pendingIds);
                    pendingFiles = [];
                }
            } else {
                res = await _supabase.from('sellers').update(payload).eq('id', sellerId);
            }
            if (res.error) throw res.error;
            alert(isDraft ? '비공개 저장 완료' : '저장 완료');
            if (isNew) {
                location.href = returnUrl;
            } else {
                location.reload();
            }
        } catch (err) { alert('저장 실패: ' + err.message); }
        finally { $btn.prop('disabled', false).html(origHtml); }
    }

    $('#btn-save-seller').on('click', function() { saveSeller(false, $(this)); });
    $('#btn-draft-seller').on('click', function() { saveSeller(true, $(this)); });
    $('#btn-delete-seller').on('click', async function() {
        if (!confirm('삭제하시겠습니까?')) return;
        showLoader();
        try {
            const { error } = await _supabase.from('sellers').update({ deleted_at: new Date().toISOString() }).eq('id', sellerId);
            alert('삭제되었습니다.');
            location.href = returnUrl;
        } catch (e) { alert('삭제 실패'); }
        finally { hideLoader(); }
    });

    function getFileBadgeHtml(file, status) {
        const parsedText = file ? (file.parsedtext || file.parsed_text || file.parsedText) : null;
        const isSearchable = parsedText && !parsedText.startsWith('[텍스트 미추출');
        
        if (!status) {
            status = isSearchable ? 'reflected' : 'failed';
        }

        if (status === 'loading') {
            return `<span class="ai-status-badge badge-ai-loading" style="font-size: 10px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #e2e8f0;">분석 중...</span>`;
        } else if (status === 'reflected') {
            return `<span class="ai-status-badge badge-ai-reflected" style="font-size: 10px; font-weight: 600; color: #8b5cf6; background: #f5f3ff; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #ddd6fe;">AI 반영됨</span>`;
        } else {
            return `<span class="ai-status-badge badge-ai-failed" style="font-size: 10px; font-weight: 600; color: #ef4444; background: #fee2e2; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #fecaca;">AI 불가</span>`;
        }
    }

    let companyLinkedFiles = [];
    async function loadAvailableFiles() {
        try {
            const { data: sFiles } = !isNew ? await _supabase.from('files').select('*, storage_type').eq('entity_id', sellerId).eq('entity_type', 'seller') : { data: [] };
            availableFiles = sFiles || [];
            
            // [추가] 신규 작성 중인 경우 보관된 파일들을 목록에 합침
            if (isNew && pendingFiles.length > 0) {
                availableFiles = [...availableFiles, ...pendingFiles];
            }
            
            const tid = (currentSellerData?.company_id) || selectedCompanyId;
            const { data: cFiles } = tid ? await _supabase.from('files').select('*, storage_type').eq('entity_id', tid).eq('entity_type', 'company') : { data: [] };
            companyLinkedFiles = cFiles || [];
            renderFileList();
        } catch (err) { console.error('Files load error:', err); }
    }

    function renderFileList() {
        const $listT = $('#source-list-training'), $listA = $('#source-list-additional');
        if($listT.length) {
            $listT.empty();
            if(companyLinkedFiles.length) {
                companyLinkedFiles.forEach(f => {
                    const badge = getFileBadgeHtml(f);
                    const parsedText = f.parsedtext || f.parsed_text || f.parsedText;
                    const isFailed = !parsedText || parsedText.startsWith('[텍스트 미추출');
                    const retryBtnHtml = isFailed
                        ? `<button class="btn-reextract" data-id="${f.id}" data-source="linked" title="AI 재인식 시도" style="background:none; border:none; cursor:pointer; color:#64748b; padding:2px; display:flex; align-items:center; opacity:0.6; transition:opacity 0.2s;">
                                <span class="material-symbols-outlined" style="font-size:16px;">refresh</span>
                            </button>`
                        : '';
                    const $item = $(`<li data-id="${f.id}" style="display:flex; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                        ${badge}
                        <a href="#" class="file-download-link" style="flex:1; font-size:13px; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-decoration:none;">${f.file_name}</a>
                        ${retryBtnHtml}
                    </li>`);

                    $item.find('.file-download-link').on('click', async (e) => {
                        e.preventDefault();
                        const url = await getSignedFileUrl(f.location || f.storage_path, f.storage_type);
                        if (url) window.open(url, '_blank');
                    });

                    $item.find('.btn-reextract').hover(
                        function() { $(this).css('opacity', '1'); },
                        function() { $(this).css('opacity', '0.6'); }
                    );

                    $listT.append($item);
                });
            }
        }
        if($listA.length) {
            $listA.empty();
            if(availableFiles.length) {
                availableFiles.forEach(f => {
                    const badge = getFileBadgeHtml(f);
                    const parsedText = f.parsedtext || f.parsed_text || f.parsedText;
                    const isFailed = !parsedText || parsedText.startsWith('[텍스트 미추출');
                    const retryBtnHtml = isFailed
                        ? `<button class="btn-reextract" data-id="${f.id}" title="AI 재인식 시도" style="background:none; border:none; cursor:pointer; color:#64748b; padding:2px; display:flex; align-items:center; opacity:0.6; transition:opacity 0.2s;">
                                <span class="material-symbols-outlined" style="font-size:16px;">refresh</span>
                            </button>`
                        : '';
                    const $item = $(`<li data-id="${f.id}" style="display:flex; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                        ${badge}
                        ${retryBtnHtml}
                        <a href="#" class="file-download-link" style="flex:1; font-size:13px; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-decoration:none;">${f.file_name}</a>
                        <button class="btn-remove-file" data-id="${f.id}" data-is-pending="${isNew}" style="background:none; border:none; cursor:pointer; color:#ef4444; padding:2px; display:flex; align-items:center; opacity:0.7; transition:opacity 0.2s;">
                            <span class="material-symbols-outlined" style="font-size:16px;">close</span>
                        </button>
                    </li>`);

                    $item.find('.file-download-link').on('click', async (e) => {
                        e.preventDefault();
                        const url = await getSignedFileUrl(f.location || f.storage_path, f.storage_type);
                        if (url) window.open(url, '_blank');
                    });

                    $item.find('.btn-reextract').hover(
                        function() { $(this).css('opacity', '1'); },
                        function() { $(this).css('opacity', '0.6'); }
                    );

                    $listA.append($item);
                });
                // 삭제 버튼 호버 효과
                $('.btn-remove-file').hover(function() { $(this).css('opacity', '1'); }, function() { $(this).css('opacity', '0.7'); });
            }
        }
    }

    $(document).on('click', '.btn-reextract', async function() {
        const id = $(this).data('id');
        const fileMeta = availableFiles.find(f => String(f.id) === String(id))
            || pendingFiles.find(f => String(f.id) === String(id))
            || companyLinkedFiles.find(f => String(f.id) === String(id));
        if (!fileMeta) return;
        const $item = $(this).closest('li');
        const { reExtractAndUpdateFile } = await import('./file_render_utils.js');
        const result = await reExtractAndUpdateFile($item, fileMeta, _supabase, '#8b5cf6');
        if (result.success) {
            fileMeta.parsedtext = result.text;
            fileMeta.parsedText = result.text;
        }
    });

    $('#add-source-additional').on('click', () => { currentSourceType = 'additional'; $('#file-upload').click(); });
    
    // 파일 업로드 통합 처리 함수
    async function handleFileUploads(files) {
        if (!files.length) return;
        const $listA = $('#source-list-additional');

        const total = files.length;
        let successCount = 0;
        let failCount = 0;
        let processed = 0;

        const $fileCard = $listA.closest('.file-list-card');
        const overlay = showPanelOverlay($fileCard[0], {
            label: total > 1 ? `파일 분석 중... (0/${total})` : '파일 분석 중...'
        });

        try {
            for (const file of files) {
                processed++;
                if (total > 1) overlay.update(`파일 분석 중... (${processed}/${total})`);

                if (!(await filetypecheck(file))) {
                    // 거부 토스트는 filetypecheck 내부에서 표시
                    failCount++;
                    continue;
                }

                const loadingBadge = getFileBadgeHtml(null, 'loading');
                const $tempItem = $(`<li class="temp-loading-item" style="display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                    ${loadingBadge}
                    <span style="flex:1; font-size:13px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name}</span>
                </li>`);

                if ($listA.find('li:contains("파일 없음")').length) $listA.empty();
                $listA.append($tempItem);

                try {
                    const uploadResult = await fileUpload(file, user_id, isNew ? null : sellerId, null, isNew ? null : sellerId);
                    const uploadedFile = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;

                    if (uploadedFile && uploadedFile.id) {
                        await _supabase.from('files')
                            .update({
                                entity_type: 'seller',
                                entity_id: isNew ? null : sellerId
                            })
                            .eq('id', uploadedFile.id);

                        // 업로드 직후 AI 미반영 사유를 사용자에게 즉시 안내 (일시 장애 vs 이미지 문서)
                        const pText = uploadedFile.parsedtext || uploadedFile.parsed_text || uploadedFile.parsedText;
                        const isSearchable = pText && !pText.startsWith('[텍스트 미추출');
                        if (!isSearchable) {
                            if (isAiPendingRetry(pText)) {
                                showToast(`"${file.name}": AI 텍스트 추출 서버 일시 혼잡. 잠시 후 파일 옆 새로고침 아이콘으로 재시도해주세요.`, { icon: 'schedule', iconColor: '#f59e0b', duration: 5000 });
                            } else {
                                showToast(`"${file.name}": 이미지 위주 문서로 보입니다. 파일은 저장됐지만 AI 검색에 활용되지 않습니다.`, { icon: 'info', iconColor: '#64748b', duration: 4500 });
                            }
                        }

                        if (isNew) pendingFiles.push(uploadedFile);
                        successCount++;
                    } else {
                        failCount++;
                        $tempItem.remove();
                        showToast(`${file.name} 업로드에 실패했습니다.`, { icon: 'error', iconColor: '#ef4444', duration: 3500 });
                    }
                } catch (err) {
                    console.error('Upload Error:', err);
                    $tempItem.remove();
                    failCount++;
                    const reason = (err && err.message) ? err.message.split('\n')[0] : '알 수 없는 오류';
                    showToast(`${file.name}: ${reason}`, { icon: 'error', iconColor: '#ef4444', duration: 3500 });
                }
            }
        } finally {
            if (successCount > 0) {
                const msg = failCount > 0
                    ? `${successCount}개 업로드 완료 · ${failCount}개 실패`
                    : `${successCount}개 파일 업로드 완료`;
                overlay.hide({ status: 'success', toast: msg });
            } else {
                overlay.hide();
            }
            loadAvailableFiles();
        }
    }

    $('#file-upload').on('change', function() {
        handleFileUploads(this.files);
        this.value = ''; 
    });

    // 드래그 앤 드롭 이벤트 바인딩
    const $dropZone = $('.file-list-card');
    $dropZone.on('dragover dragenter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).addClass('drag-over');
    });

    $dropZone.on('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.contains(e.originalEvent.relatedTarget)) {
            $(this).removeClass('drag-over');
        }
    });

    $dropZone.on('dragend drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('drag-over');
    });

    $dropZone.on('drop', function(e) {
        const files = e.originalEvent.dataTransfer.files;
        if (files && files.length > 0) {
            currentSourceType = 'additional';
            handleFileUploads(files);
        }
    });

    $(document).on('click', '.btn-remove-file', async function() {
        if (!confirm('삭제하시겠습니까?')) return;
        const fileId = $(this).data('id');
        const isPending = $(this).data('is-pending');
        
        try { 
            // 서버 DB 삭제 연동
            await _supabase.from('files').delete().eq('id', fileId); 
            
            if (isPending) {
                pendingFiles = pendingFiles.filter(f => f.id !== fileId);
            }
            
            loadAvailableFiles(); 
        }
        catch (err) { 
            console.error('File delete failed:', err);
            alert('삭제 실패'); 
        }
    });

    // AI 채팅 핸들러
    function addMessage(content, sender, animate = true) {
        $welcomeScreen.hide();
        const isUser = sender === 'user';
        const msgHtml = `<div class="${isUser ? 'user-bubble' : 'ai-bubble'}" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px; ${isUser ? 'flex-direction:row-reverse;' : ''}">
                <div style="width:32px; height:32px; border-radius:50%; background:${isUser ? '#8b5cf6' : '#f1f5f9'}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <span class="material-symbols-outlined" style="font-size:18px; color:${isUser ? '#fff' : '#64748b'};">${isUser ? 'person' : 'smart_toy'}</span>
                </div>
                <div style="max-width:80%; padding:12px 16px; border-radius:12px; background:${isUser ? '#8b5cf6' : '#f8fafc'}; color:${isUser ? '#fff' : '#334155'}; font-size:14px; line-height:1.7; box-shadow:0 2px 8px rgba(0,0,0,0.06);">${escapeForDisplay(content)}</div>
            </div>`;
        $chatMessages.append(msgHtml);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });
    }

    async function sendMessage() {
        const msg = $('#chat-input').val().trim(); if (!msg) return;
        $('#chat-input').val('').css('height', '42px');
        addMessage(msg, 'user');
        conversationHistory.push({ role:'user', content:msg });
        const $aiP = $('<div class="ai-bubble" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px;"><div style="width:32px; height:32px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:18px; color:#64748b;">smart_toy</span></div><div class="ai-typing" style="padding:12px 16px; border-radius:12px; background:#f8fafc; color:#64748b; font-size:14px;">생성 중...</div></div>');
        $chatMessages.append($aiP); $chatMessages[0].scrollTo({ top:$chatMessages[0].scrollHeight, behavior:'smooth' });

        try {
            // [수정] 매도자 ID(sellerId)와 연동된 기업 ID(selectedCompanyId) 두 곳 모두의 벡터 데이터를 검색함
            let ragContexts = [];
            // 1. 매도자 소유 파일 (기존 저장된 파일)
            availableFiles.forEach(f => {
                const txt = f.parsedtext || f.parsed_text || f.parsedText;
                if (txt && !txt.startsWith('[텍스트 미추출')) {
                    ragContexts.push(`[추가 업로드 파일(${f.file_name}) 내용]:\n${txt}`);
                }
            });
            
            // 2. 신규 작성 중 업로드된 파일(pendingFiles) 내용 포함
            if (pendingFiles.length > 0) {
                pendingFiles.forEach(f => {
                    const txt = f.parsedtext || f.parsed_text || f.parsedText;
                    if (txt && !txt.startsWith('[텍스트 미추출')) {
                        ragContexts.push(`[신규 업로드 파일(${f.file_name}) 내용]:\n${txt}`);
                    }
                });
            }
            
            // 3. 연동된 기업 소유 파일
            companyLinkedFiles.forEach(f => {
                const txt = f.parsedtext || f.parsed_text || f.parsedText;
                if (txt && !txt.startsWith('[텍스트 미추출')) {
                    ragContexts.push(`[기업 연동 파일(${f.file_name}) 내용]:\n${txt}`);
                }
            });
            
            const rag = ragContexts.join("\n\n---\n\n");
            const ctx = `[매도인 정보]\n기업명: ${$('#seller-name-editor').text()}\n산업: ${$('#seller-industry').val()}\n대표자: ${$('#seller-ceo').val()}\n소개: ${$('#seller-summary').val()}\n[참고 문서 내용]\n${rag}`;
            const res = await addAiResponse(msg, ctx, getCurrentModelId());
            const data = await res.json();
            const reply = data.answer || '답변 실패';
            $aiP.find('.ai-typing').html(escapeForDisplay(reply));
            conversationHistory.push({ role:'assistant', content:reply });
            if (!isNew) await _supabase.from('sellers').update({ history: conversationHistory }).eq('id', sellerId);
        } catch (e) { 
            console.error('AI Chat Error:', e);
            if (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED') || e.message.includes('quota')) {
                markModelAsExceeded(getCurrentModelId());
                $aiP.find('.ai-typing').html('현재 모델의 사용 한도가 초과되었습니다.<br>다른 모델로 변경하여 시도해 주세요.');
            } else if (e.message.includes('503') || e.message.includes('UNAVAILABLE') || e.message.includes('high demand')) {
                $aiP.find('.ai-typing').html('AI 서비스 접속자가 많아 지연되고 있습니다.<br>잠시 후 다시 시도해 주세요.');
            } else {
                $aiP.find('.ai-typing').text('오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'); 
            }
        }
    }

    $('#send-btn').on('click', sendMessage);
    $('#chat-input').on('keypress', (e) => { if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    $(document).on('click', '.prompt-chip', function() {
        const text = $(this).attr('data-prompt') || $(this).text();
        $('#chat-input').val(text);
        sendMessage();
    });

    // AI 자동 입력 추출
    $('#ai-auto-fill-btn').on('click', async function() {
        const totalFiles = availableFiles.length + companyLinkedFiles.length;
        if (totalFiles === 0) {
            showToast('분석할 파일이 없습니다. 파일을 먼저 추가하거나 기업을 선택하세요.', { icon: 'info', iconColor: '#6366f1', duration: 3000 });
            return;
        }

        const $btn = $(this);

        // [스켈레톤 + 경과시간] AI가 채울 타깃에 시머 적용 + 버튼 카운터
        // 기업명(#seller-name-editor)은 연동된 매물 정보 기준이라 AI 자동 입력 대상에서 제외
        const ux = beginAiAutofillUx({
            $btn,
            fields: [
                '#seller-industry', '#seller-industry-etc',
                '#seller-ceo', '#seller-email', '#seller-establishment', '#seller-address',
                '#seller-summary', '#seller-key-products',
                '#seller-fin-analysis', '#seller-manager-memo'
            ],
            containers: ['#financial-table-container']
        });

        let aiSucceeded = false;
        try {
            let ragContexts = [];
            
            // 1. 매도자 소유 파일 (기존 저장된 파일)
            availableFiles.forEach(f => {
                const txt = f.parsedtext || f.parsed_text || f.parsedText;
                if (txt && !txt.startsWith('[텍스트 미추출')) {
                    ragContexts.push(`파일명: ${f.file_name}\n내용: ${txt}`);
                }
            });

            // 2. 신규 작성 중 업로드된 파일(pendingFiles)
            if (pendingFiles.length > 0) {
                pendingFiles.forEach(f => {
                    const txt = f.parsedtext || f.parsed_text || f.parsedText;
                    if (txt && !txt.startsWith('[텍스트 미추출')) {
                        ragContexts.push(`파일명: ${f.file_name}\n내용: ${txt}`);
                    }
                });
            }

            // 3. 연동된 기업 소유 파일
            companyLinkedFiles.forEach(f => {
                const txt = f.parsedtext || f.parsed_text || f.parsedText;
                if (txt && !txt.startsWith('[텍스트 미추출')) {
                    ragContexts.push(`파일명: ${f.file_name}\n내용: ${txt}`);
                }
            });

            const ctx = ragContexts.join("\n\n---\n\n");
            if (!ctx) {
                showToast('파일에서 분석할 수 있는 텍스트를 찾을 수 없습니다.', { icon: 'info', iconColor: '#6366f1', duration: 2500 });
                return;
            }

            const prompt = `
업로드된 기업 관련 문서 내용을 바탕으로 다음 정보를 추출하여 정확한 JSON 형식으로 답변해주세요.
- companyName: 기업명(매도자) (단, '주식회사', '(주)' 등은 제외하고 추출)
- industry: 산업 분야 (가급적 드롭다운 목록에 있는 값으로 매핑: AI, IT·정보통신, SaaS·솔루션, 게임, 공공·국방, 관광·레저, 교육·에듀테크, 금융·핀테크, 농·임·어업, 라이프스타일, 모빌리티, 문화예술·콘텐츠, 바이오·헬스케어, 부동산, 뷰티·패션, 에너지·환경, 외식업·소상공인, 우주·항공, 유통·물류, 제조·건설, 플랫폼·커뮤니티 중 하나)
- ceoName: 대표자명
- email: 이메일
- establishment: 설립일자 (YYYY-MM-DD 형식)
- address: 주소
- summary: 회사소개
  · **헤드라인·넘버링·bullet 없이 평문 한 문장으로만 작성**
  · 예시: "유망 브랜드를 발굴, 육성하고 글로벌 인프라와 지분 투자를 통해 성장시키는 외식 기업"
  · 핵심 사업·제품·차별점을 압축한 한 줄
  · 어조: 객관적·서술형. 과장 형용사 금지("혁신적인", "최고의", "독보적인" 등)
  · 재무 수치 포함 금지
- keyProducts: 주요 제품/서비스
  · 형식: 줄마다 "숫자) 제품/서비스명 — 설명" 형태로 한 줄씩
    예시(줄바꿈 포함된 단일 문자열):
      1) 제품A — 한 줄 설명
      2) 제품B — 한 줄 설명
      3) 제품C — 한 줄 설명
  · **최대 4개 항목**. 정보가 부족하면 그 이하 허용
  · 각 줄은 80자 이내, 기능·용도 중심. 마케팅 카피 금지
  · 재무 수치 포함 금지
- financial_info: 연도별 배열. 각 항목은 아래 키를 포함합니다 (없는 항목은 빈 문자열 ""):
  {
    "year": "연도(4자리)",
    "revenue": "매출액(숫자만)",
    "cogs": "매출원가(숫자만) — 손익계산서에 '매출원가', '영업비용' 등으로 표기된 항목",
    "profit": "영업손익 값(숫자만, 손실이면 마이너스 부호 포함)",
    "profit_label": "영업 라인 라벨 원문 그대로",
    "net_profit": "당기순손익 값(숫자만, 손실이면 마이너스 부호 포함)",
    "net_profit_label": "당기순 라인 라벨 원문 그대로",
    "total_assets": "총자산(숫자만)",
    "total_liabilities": "총부채(숫자만)",
    "total_equity": "총자본(숫자만)",
    "cash": "현금및현금성자산(숫자만) — 재무상태표 유동자산 첫 항목",
    "short_term_debt": "단기차입금 합계(숫자만) — 재무상태표 유동부채 항목 중 아래 화이트리스트와 **정확히 일치**하는 항목만 합산: 단기차입금, 단기금융부채, 단기차입부채, 유동성장기부채, 유동성사채, 유동성사채및장기차입금, 단기사채, 금융리스부채(유동), 리스부채(유동). 명칭이 정확히 매칭되지 않거나 차입성 여부 판단이 애매한 항목은 절대 포함하지 말 것(추측·임의 합산 금지). 매입채무·미지급금·미지급비용·예수금·선수금·충당부채·이연수익·당기법인세부채 등 비차입성 항목은 항상 제외.",
    "long_term_debt": "장기차입금 합계(숫자만) — 재무상태표 비유동부채 항목 중 아래 화이트리스트와 **정확히 일치**하는 항목만 합산: 장기차입금, 장기금융부채, 장기차입부채, 사채, 장기성금융부채, 사채및장기차입금, 금융리스부채(비유동), 리스부채(비유동). 명칭이 정확히 매칭되지 않거나 차입성 여부 판단이 애매한 항목은 절대 포함하지 말 것(추측·임의 합산 금지). 장기매입채무·장기미지급금·퇴직급여충당부채·이연법인세부채 등 비차입성 항목은 항상 제외. 유동성장기부채는 short_term_debt 쪽에만 포함하고 여기서는 제외.",
    "ocf": "영업활동현금흐름(숫자만) — 현금흐름표 영업활동 합계, 음수 가능",
    "capex": "자본적지출(숫자만, 양수) — 현금흐름표 투자활동 중 유형자산 취득액"
  }
  · profit / net_profit 값은 손실(음수)이면 반드시 마이너스 부호('-')를 붙여 반환하세요. 재무제표에 "(123)" 또는 "△123"으로 적혀 있으면 "-123"으로 반환합니다. profit_label에는 원문 라벨을 그대로 적어주세요 (클라이언트 보조 검증용).
  · profit_label: 영업 라인 라벨 원문 그대로 (예: "영업이익", "영업손익", "영업손실", "영업이익(손실)")
  · net_profit_label: 손익계산서 최종 줄 라벨 원문 그대로 (예: "당기순이익", "당기순손익", "당기순손실", "당기순이익(손실)")
  · 혼동 주의: "법인세비용차감전순이익/차감전손익", "계속영업이익", "중단영업이익" 등은 당기순이익이 아닙니다. 그 아래에 "당기순이익/당기순손익/당기순손실" 줄이 있으면 그것을 사용하세요. 정상 손익계산서에는 거의 항상 당기순이익 줄이 존재하니 적극적으로 찾아 추출하세요.
  · ocf는 음수일 수 있습니다 (영업활동현금흐름이 마이너스인 경우 그대로 음수로 추출).
  · cogs가 손익계산서에 별도 라인으로 없는 경우(예: 순수 서비스업) 빈 문자열로 두세요.
  · cash, short_term_debt, long_term_debt, ocf, capex가 문서에 없으면 빈 문자열로 두세요. 단 short_term_debt / long_term_debt는 위 정의의 동의어 항목이 하나라도 있으면 그 합계를 반환하고, 정말 어떤 차입성 부채 항목도 없을 때만 빈 문자열로 두세요.
- financial_analysis: 재무제표 분석 (의미·흐름 중심)
  · 형식: 항목마다 두 줄 — 첫 줄에 "숫자) 헤드라인", 둘째 줄에 "- 분석 본문". **항목 사이는 빈 줄 1줄로 구분**
    예시(줄바꿈 포함된 단일 문자열):
      1) 외형의 고속 성장
      - 매출이 최근 2년간 가파른 확대 흐름을 보이며 시장 침투가 본격화된 국면으로 해석되나, 직전 연도 대비 성장률이 둔화되어 성장 속도의 정점 통과 가능성도 함께 관찰됩니다.

      2) 공격적 투자에 따른 자산·자본 동반 확장
      - 총자산이 약 2.4배 수준으로 증가하는 가운데 무형자산·투자자산이 큰 비중으로 늘어, 사업 확장기에 진입한 회사가 외부 자본을 끌어와 인프라·R&D에 선제 투입하는 전형적 패턴으로 보입니다.

      3) 성장 비용 부담에 따른 수익성 악화
      - 흑자에서 대규모 순손실로 전환된 흐름은 매출 확대에도 불구하고 고정비·감가상각·금융비용 부담이 빠르게 커지고 있음을 시사하며, 손익분기점 도달 시점이 수익성 정상화의 핵심 변수로 보입니다.

      4) 자본 확충 중심의 재무구조 개편
      - 부채는 소폭 감소한 반면 자본이 큰 폭으로 증가해, 차입보다 지분성 자금 조달에 의존해 성장을 뒷받침하는 구조이며, 향후 추가 라운드 없이도 운전자본을 감당할 수 있는지가 재무 건전성의 관건입니다.
  · **각 항목(헤드라인+본문) 사이에는 반드시 빈 줄 1줄을 삽입.** 즉 단일 문자열 내에서 항목 구분자는 "\n\n"
  · **헤드라인은 현상을 해석한 짧은 표현**으로 작성 (예: "외형의 고속 성장", "공격적 투자에 따른 자산·자본 동반 확장", "성장 비용 부담에 따른 수익성 악화"). 단순 항목명("매출액 증가") 금지
  · **본문은 추세의 방향·동인·시사점 서술이 중심.** 수치는 항목당 **최대 1개**만 인용하며, 그것도 변화의 크기를 직관적으로 보여주기 위한 앵커로만 사용 (예: "약 2.4배", "12배 수준"). 절대값·연도별 나열 금지
  · 본문이 "A는 X원, B는 Y원, C는 Z원"처럼 수치 나열로 흘러서는 안 됨. "이 흐름이 무엇을 의미하는가"가 본문의 90% 이상을 차지해야 함
  · **financial_info 표뿐 아니라 업로드된 재무제표(재무상태표/손익계산서/현금흐름표 등)의 주요 항목도 함께 읽어 분석에 활용**
    - 표에 없지만 의미 있는 항목(예: 투자자산, 무형자산/개발비, 영업활동현금흐름, 자본잉여금 등)도 포함 가능
    - 단, 본문에 인용하는 수치는 업로드 문서 또는 financial_info에 **명시된 값만** 사용 (추측·계산 금지)
  · **최대 4개 항목**, 중요한 흐름 위주로 선별. 모든 계정을 다루지 말 것
  · 1개 연도 데이터만 있으면 "단년 데이터로 추세 판단 불가"를 단일 항목으로만 반환
  · **기업명은 직접 언급 금지 — 주어 생략 또는 "동사"로 치환하여 서술**
- manager_memo: 담당자 의견 — **M&A 관점에서 동사가 보유한 강점**을 투자심사역 시각으로 분석
  · 형식: 항목마다 두 줄 — 첫 줄에 "숫자) 헤드라인", 둘째 줄에 "- 평가 본문". 관점별로 헤드라인을 따로 둠. **항목 사이는 빈 줄 1줄로 구분**
    예시(줄바꿈 포함된 단일 문자열):
      1) 운영 연속성·PMI 용이성: 인수 직후 가치 훼손 리스크가 낮은 운영 기반
      - 다년간 누적된 운영 노하우와 표준화된 프로세스가 정착되어 있어, 인수 후 별도 통합 비용 없이 운영 연속성을 즉시 확보할 수 있는 점은 M&A 거래에서 핵심 강점으로 평가됨. 인수자 입장에서 PMI(Post-Merger Integration) 리스크가 낮다는 것은 거래 클로징 이후의 가치 훼손 가능성을 줄여주는 중요한 요소로 작용함

      2) 무형자산·진입장벽: 모방이 어려운 구조적 해자 보유
      - 진입장벽이 높은 영역에서 확보한 라이선스·인허가·인증 자산은 신규 진입자가 단기간에 모방하기 어려운 구조적 해자로 작용하여, 인수자 관점에서 시간·비용 절감 효과가 큰 무형자산으로 판단됨. 특히 동사의 이러한 자산은 향후 인접 시장으로의 확장 시에도 발판으로 기능할 수 있어 전략적 가치가 높음

      3) 비즈니스 모델·시너지 여지: 결합 시 수익성 빠른 개선 가능
      - 고정비 비중이 낮고 변동비 위주의 구조로 설계되어 있어, 인수자가 보유한 인프라·유통망·고객 베이스와 결합 시 단위당 수익성을 빠르게 끌어올릴 수 있는 시너지 여지가 충분히 존재하는 것으로 평가됨. 전략적 인수자(SI) 관점에서는 즉각적인 수익성 개선이 가능한 구조라는 점에서 입찰 매력도가 높을 것으로 분석됨

      4) 인력·조직 안정성: 매니지먼트 의존도 낮아 엑싯 밸류에이션 보호 용이
      - 핵심 인력의 장기 근속 비율과 키 매니저의 역할 분산 수준이 양호하여, 인수 후 핵심 인력 이탈로 인한 기업 가치 훼손 리스크가 상대적으로 낮은 것으로 분석됨. 재무적 인수자(FI) 입장에서도 매니지먼트 의존도가 낮다는 것은 엑싯 시점의 밸류에이션 보호 측면에서 긍정적으로 평가됨
  · **각 항목(헤드라인+본문) 사이에는 반드시 빈 줄 1줄을 삽입.** 즉 단일 문자열 내에서 항목 구분자는 "\n\n"
  · **투자심사역(IB·PE·전략적 투자자) 관점에서, 동사를 M&A 대상으로 검토할 때의 강점을 디테일하게 서술**
  · **헤드라인은 "관점명: 해당 관점의 평가 요지"** 형태로 작성. 단순 관점명("무형자산")만 적는 것 금지
  · **최대 4개 항목**, 각 항목 본문은 **2~4문장 분량으로 상세히 작성**. 짧은 한 문장 금지 — 근거·맥락·시사점이 보이는 깊이 있는 서술
  · 다룰 수 있는 관점(모두 다룰 필요는 없고, 동사 특성에 가장 부합하는 강점을 중심으로 4개 선택):
    - 시장 포지셔닝·진입장벽·해자(moat)
    - 비즈니스 모델의 수익 구조·확장성·시너지 가능성
    - 운영 효율성·고객 베이스의 질·전환비용·록인(lock-in)
    - 인력·조직 안정성·핵심 인력 의존도
    - 무형자산(IP·라이선스·브랜드·데이터·계약 관계)의 가치
    - 재무 구조 안정성·캐시플로우 예측 가능성·PMI 용이성
    - 인수자 유형별 전략적 적합도(SI vs FI), 엑싯 시나리오의 명확성
  · **기업명은 직접 언급 금지 — 반드시 "동사"로 치환하여 서술** (예: "동사의 운영 모델은~", "동사가 보유한~")
  · **주요 서비스명·제품명·아이템명·브랜드명도 직접 언급 금지.** 그 대신 해당 서비스/제품이 가진 **특성·구조·역할 등 내용 중심으로 서술**
    (예: "○○ 플랫폼은~" 금지 → "동사의 핵심 서비스는 ~한 구조로 운영되어~" 식)
  · 학습 데이터(산업 트렌드, M&A 시장 통념, 일반적 투자심사 기준)를 적극 활용하여 깊이 있게 작성
  · 단정적 표현 지양, "~로 평가됨", "~판단됨", "~경향이 있음", "~로 분석됨" 같은 **투자심사 보고서 톤**의 완화된 표현 사용

[출력 형식 — keyProducts / financial_analysis / manager_memo 공통 ※매우 중요]
- 각 항목은 **줄바꿈 문자(\n)로 구분된 단일 JSON 문자열**로 반환
- **절대 배열([...])로 반환하지 마세요.** 예: ["1) 항목", "2) 항목"] (X) → "1) 항목\n2) 항목" (O)
- 정보가 부족하면 최대 개수 미만 허용

**주의사항**:
1. 매도 방식 등 별도 항목은 분석 결과가 확실한 경우에만 포함하세요.
2. 금액이나 숫자는 단위 구분 쉼표 없이 숫자만 추출하세요. (예: 1,000,000 -> 1000000)
3. 알 수 없는 정보는 빈 문자열("") 또는 0으로 반환하세요. 단, manager_memo는 학습 데이터를 기반으로 가능한 한 작성하세요.
4. 반드시 유효한 JSON 형식으로만 답변하세요. 다른 설명은 생략하세요.
5. **[중요] 'companyName' 필드에는 실제 기업명을 추출하되, 그 외 본문 항목에서는 기업명을 직접 언급하지 마세요.**
   - 'summary', 'keyProducts'에서는 주어를 생략하거나 '해당 기업'과 같은 중립적 표현 사용
   - 'manager_memo'에서는 반드시 **'동사'**로 치환하여 서술 (M&A 투자심사 보고서 톤)
            `.trim();

            const res = await addAiResponse(prompt, ctx, getCurrentModelId());
            const data = await res.json();
            let resultText = data.answer || data.text || "";
            let jsonString = '';
            const markdownMatch = resultText.match(/```json\n?([\s\S]*?)\n?```/);
            if (markdownMatch) jsonString = markdownMatch[1].trim();
            else {
                const curlyMatch = resultText.match(/\{[\s\S]*\}/);
                if (curlyMatch) jsonString = curlyMatch[0].trim();
            }
            if (!jsonString) throw new Error('유효한 데이터 추출에 실패했습니다.');

            let json;
            try { json = JSON.parse(jsonString); } catch (pErr) {
                try { json = JSON.parse(tryRepairJson(jsonString)); } catch (rErr) { throw new Error('AI 응답이 끊겼거나 형식이 올바르지 않습니다.'); }
            }

            if (json) {
                // [방어 코드] 일부 모델이 텍스트 필드를 배열로 반환하는 경우 \n으로 join
                ['summary', 'keyProducts', 'financial_analysis', 'manager_memo'].forEach(f => {
                    if (Array.isArray(json[f])) json[f] = json[f].join('\n');
                });

                // [신규] 본문 항목에서 기업명 언급 제거 후처리
                const cName = json.companyName;
                if (cName && cName.length > 1) {
                    const fieldsToClean = ['summary', 'keyProducts', 'financial_analysis', 'manager_memo'];
                    // (주), 주식회사 등이 포함된 경우도 대응하기 위해 정규식 구성
                    const escapedName = cName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const cleanRegex = new RegExp(`(\\(\\주\\)|주식회사\\s*)?${escapedName}`, 'g');
                    
                    fieldsToClean.forEach(f => {
                        if (json[f] && typeof json[f] === 'string') {
                            json[f] = json[f].replace(cleanRegex, '해당 기업');
                        }
                    });
                }

                if (json.companyName) {
                    const companyName = json.companyName;
                    // 검색 모드에서 이미 기업이 선택된 경우에는 기업명을 덮어쓰지 않음
                    if (isDirectInputMode || !selectedCompanyId) {
                        $('#seller-name-editor').text(companyName);
                        document.title = `${companyName} - 매도인 정보`;
                        $('#sidebar-header-title').text(companyName || '매도인 정보');
                    }
                    // [추가] 기업명을 키워드 블라인드에 자동 추가
                    if (companyName && !blindKeywords.includes(companyName)) {
                        blindKeywords.push(companyName);
                        renderBlindTags();
                    }
                }
                if (json.industry) {
                    const $ind = $('#seller-industry');
                    const options = $ind.find('option').map(function() { return $(this).val(); }).get();
                    if (options.includes(json.industry)) $ind.val(json.industry).trigger('change');
                    else { $ind.val('기타').trigger('change'); $('#seller-industry-etc').val(json.industry).show(); }
                }
                if (json.ceoName) $('#seller-ceo').val(json.ceoName);
                if (json.email) $('#seller-email').val(json.email);
                if (json.establishment) $('#seller-establishment').val(json.establishment);
                if (json.address) $('#seller-address').val(json.address);
                if (json.summary) $('#seller-summary').val(json.summary);
                if (json.keyProducts) $('#seller-key-products').val(json.keyProducts);
                if (json.financial_analysis) $('#seller-fin-analysis').val(json.financial_analysis);
                if (json.manager_memo) $('#seller-manager-memo').val(json.manager_memo);
                if (json.financial_info && Array.isArray(json.financial_info) && json.financial_info.length > 0) {
                    const existingWire = collectFinancialData('financial-table-container');
                    const merged = mergeFinancialData(existingWire, json.financial_info, 'sellers');
                    renderFinancialTable(merged, 'financial-table-container', 'sellers');
                }
                autoResizeAllTextareas();
                aiSucceeded = true;
                showToast('AI 자동 입력이 완료되었습니다.', { icon: 'check_circle', iconColor: '#22c55e' });
            }
        } catch (e) {
            console.error('AI Auto-fill Error:', e);
            const errMsg = e.message || '';
            let toastMsg;
            if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
                markModelAsExceeded(getCurrentModelId());
                toastMsg = 'AI 요청 한도를 초과했습니다. 다른 모델을 선택해 주세요.';
            } else if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
                toastMsg = 'AI 서비스 접속자가 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요.';
            } else {
                toastMsg = '정보 추출 중 오류가 발생했습니다: ' + (errMsg || '알 수 없는 형식');
            }
            showToast(toastMsg, { icon: 'error', iconColor: '#ef4444', duration: 4500 });
        }
        finally {
            ux.end(aiSucceeded);
        }
    });


    // 블라인드 마스킹 실제 수행
    function applyBlindMasking() {
        const anyPersonal = Object.values(blindPersonal).some(v => v);
        if (!isBlindActive && !anyPersonal) return;

        const blindBadge = '<span class="badge-blind">blind</span>';
        const blindNameHtml = blindNameStructured
            ? `<span class="seller-blind-serial">${escapeForDisplay(blindNameStructured)}</span>`
            : blindBadge;
        const regex = (isBlindActive && blindKeywords.length) ? new RegExp(blindKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') : null;

        // 1-a. 기업명: 매물번호(시리얼)로 표시 (행을 숨기지 않음)
        if (blindPersonal.name) {
            const $name = $('#seller-name-editor'), $rep = $name.next('.report-text-field');
            if ($rep.length) $rep.html(blindNameHtml);
            else $name.html(blindNameHtml);
        }

        // 1-b. 개별 필드 블라인드 -> 해당 flex:1 컬럼 또는 width:100% 컨테이너 숨김
        const fieldMap = {
            'ceo': 'ceo',
            'email': 'email',
            'establishment': 'establishment',
            'address': 'address',
            'fin-analysis': 'fin_analysis'
        };
        ['seller-ceo', 'seller-email', 'seller-establishment', 'seller-address', 'seller-fin-analysis'].forEach(id => {
            const suffix = id.replace('seller-', '');
            const key = fieldMap[suffix] || suffix;
            if (blindPersonal[key]) {
                $(`#${id}`).closest('div[style*="flex: 1"], div[style*="width: 100%"]').hide();
            }
        });

        // [여백 제거] 행 내 모든 필드가 숨겨진 경우 부모 flex 행 컨테이너도 숨겨 margin 제거
        // 대표자명 & 이메일 행
        const $ceoCol = $('#seller-ceo').closest('div[style*="flex: 1"]');
        const $emailCol = $('#seller-email').closest('div[style*="flex: 1"]');
        if ($ceoCol.length && $emailCol.length && $ceoCol.is(':hidden') && $emailCol.is(':hidden')) {
            $ceoCol.parent().hide();
        }

        // 설립일자 & 주소 행
        const $estCol = $('#seller-establishment').closest('div[style*="flex: 1"]');
        const $addrCol = $('#seller-address').closest('div[style*="flex: 1"]');
        if ($estCol.length && $addrCol.length && $estCol.is(':hidden') && $addrCol.is(':hidden')) {
            $estCol.parent().hide();
        }

        // 2. 키워드 블라인드 (본문 및 블라인드 체크 안 된 개별 필드) -> ○로 표시
        if (regex) {
            ['#seller-summary', '#seller-key-products', '#seller-fin-analysis', '#seller-memo', '#seller-manager-memo'].forEach(sel => {
                const $el = $(sel), $rep = $el.next('.report-text-content');
                if ($rep.length) $rep.html($rep.text().replace(regex, (match) => maskWithCircles(match)));
                else if ($el.length) $el.val($el.val().replace(regex, (match) => maskWithCircles(match)));
            });

            // 키워드 블라인드: 이름 필드 (이름 자체가 블라인드 체크 안 된 경우에만 수행)
            if (!blindPersonal.name) {
                const $name = $('#seller-name-editor');
                $name.html($name.text().replace(regex, (match) => maskWithCircles(match)));
            }
        }
    }

    /**
     * 재무 요약 모드: 최근 연도의 매출/영업이익/당기순이익을 억 단위로 요약 표시
     * - #financial-table-container 를 hide하고 요약 패널을 그 자리에 삽입
     * - removeFinancialSummaryMode()로 원복 가능
     */
    function applyFinancialSummaryMode() {
        const $container = $('#financial-table-container');
        // 이미 요약 모드가 적용된 경우 중복 적용 방지
        if ($('#fin-summary-panel').length) return;

        const data = collectFinancialData('financial-table-container');

        // 가장 최근 연도 식별 (숫자 기준으로 가장 큰 값, 없으면 마지막 항목)
        let latestYear = null;
        if (data.years && data.years.length > 0) {
            const numericYears = data.years.map(y => parseInt(y, 10)).filter(n => !isNaN(n));
            if (numericYears.length > 0) {
                latestYear = String(Math.max(...numericYears));
            } else {
                latestYear = data.years[data.years.length - 1];
            }
        }

        // 억 단위 변환 헬퍼
        function toEok(rawVal) {
            if (!rawVal && rawVal !== 0) return null;
            const cleaned = String(rawVal).replace(/,/g, '').trim();
            if (cleaned === '' || cleaned === '-' || cleaned === '—') return null;
            const num = parseFloat(cleaned);
            if (isNaN(num)) return null;
            return (num / 100000000).toFixed(2);
        }

        // 매출액 레인지 변환 헬퍼
        function toRevenueRange(eok) {
            if (eok === null) return '-';
            const v = parseFloat(eok);
            if (isNaN(v))      return '-';
            if (v < 5)         return '5억 미만';
            if (v < 10)        return '5억 ~ 10억';
            if (v < 30)        return '10억 ~ 30억';
            if (v < 50)        return '30억 ~ 50억';
            if (v < 100)       return '50억 ~ 100억';
            if (v < 300)       return '100억 ~ 300억';
            if (v < 500)       return '300억 ~ 500억';
            if (v < 1000)      return '500억 ~ 1,000억';
            return '1,000억 이상';
        }

        // 매출액만 표시
        let revenueRange = '-';
        if (data.items && latestYear) {
            const matched = data.items.find(item => item.label && item.label.includes('매출'));
            if (matched) revenueRange = toRevenueRange(toEok(matched.values[latestYear]));
        }

        const yearLabel = latestYear ? `${latestYear}년 재무 요약` : '재무 요약';
        const rowsHtml =
            `<div class="fin-summary-row" style="display:flex; align-items:center; padding:6px 0; font-size:13px; color:#334155;">
                <span style="flex:0 0 100px; color:#64748b; font-weight:500;">매출액 규모</span>
                <span style="flex:1; font-weight:600; color:#1e293b; text-align:right;">${revenueRange}</span>
            </div>`;

        const $panel = $(`
            <div id="fin-summary-panel" style="margin-top:4px; padding:12px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="font-size:12px; font-weight:700; color:#7c3aed; margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                    <span class="material-symbols-outlined" style="font-size:14px;">summarize</span>
                    ${yearLabel}
                </div>
                ${rowsHtml}
            </div>
        `);

        $container.hide();
        $container.after($panel);
    }

    function applySellerReadOnlyMode() {
        applyReportMode({
            reportTitle: '매도자 정보 - DealChat',
            titleSelector: '#seller-name-editor',
            textareaIds: ['seller-summary', 'seller-key-products', 'seller-fin-analysis', 'seller-memo', 'seller-manager-memo'],
            inputIds: ['seller-name-editor', 'seller-ceo', 'seller-email', 'seller-establishment', 'seller-address', 'seller-price', 'seller-method'],
            afterApply: () => {
                if ($('#blind-check-fin-summary').is(':checked')) {
                    applyFinancialSummaryMode();
                } else {
                    reformatFinancialTableTransposed('financial-table-container');
                }
                injectReportSectionIcons({
                    'status-chip-group': 'account_tree',
                    'seller-summary': 'description',
                    'seller-key-products': 'inventory_2',
                    'financial-section': 'analytics',
                    'seller-fin-analysis': 'query_stats',
                    'seller-memo': 'sell',
                    'seller-manager-memo': 'chat_bubble'
                });
            }
        });
    }





    // 초기 데이터 로드 시작
    loadSellerData();

    // 기타 헬퍼 함수들
    function setChip(status) {
        $('.btn-status-chip').removeClass('active');
        $(`.btn-status-chip:contains("${status}")`).addClass('active');
    }

    // [New] 자동 높이 조절 함수 (표준화)


    function autoResizeAllTextareas() {
        autoResizeTextarea($('#seller-summary'));
        autoResizeTextarea($('#seller-key-products'));
        autoResizeTextarea($('#seller-fin-analysis'));
        autoResizeTextarea($('#seller-memo'));
        autoResizeTextarea($('#seller-manager-memo'));
        autoResizeTextarea($('#private-memo'));
    }

    // 입력 시 자동 높이 조절 연결
    $(document).on('input', '#seller-summary, #seller-key-products, #seller-fin-analysis, #seller-memo, #seller-manager-memo, #private-memo', function() {
        autoResizeTextarea($(this));
    });


    
    $('.btn-status-chip').on('click', function() { $('.btn-status-chip').removeClass('active'); $(this).addClass('active'); });
});
