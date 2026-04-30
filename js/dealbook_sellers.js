import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER, showLoader } from './auth_utils.js';
import * as sharingUtils from './sharing_utils.js';
import { escapeForDisplay, tryRepairJson, applyKeywordsMasking, maskWithCircles } from './utils.js';
import { initModelSelector } from './model_selector.js';
import { applyReportMode, removeReportMode, shouldEnterReportMode, injectReportSectionIcons, reformatFinancialTableTransposed } from './dealbook_report_utils.js';
import { autoResizeTextarea } from './textarea_utils.js';
import { migrateFinancialInfo, renderFinancialTable, collectFinancialData } from './financial_utils.js';
import { getSignedFileUrl } from './file_render_utils.js';


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
    let blindPersonal = { name: false, ceo: false, email: false, establishment: false, address: false, fin_summary: false, fin_analysis: false };
    
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
        $('#seller-name-editor').text(companyName).trigger('input');
        $('#seller-industry').val(company.industry || '기타').trigger('change');
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
        renderFinancialTable(migrateFinancialInfo(finSource), 'financial-table-container');
        toggleCompanyFields(true);
        
        // 신규 매도자 생성 시 복수의 티저(글)를 작성할 수 있도록 
        // 기존의 sellerData를 강제로 불러와서 덮어씌우는(isNew = false) 로직을 제거하고,
        // 매도자 전용 필드를 초기화합니다.
        $('#seller-price').val('');
        $('#negotiable-check').prop('checked', false);
        $('#seller-price').prop('readonly', false).css('background', '#ffffff');
        $('#seller-method').val('');
        $('#seller-memo').val('');
        $('#seller-manager-memo').val('');
        if (typeof setChip === 'function') setChip('대기');
        $('#btn-delete-seller').hide();
        autoResizeAllTextareas();
        $('#company-suggestions').hide();
        loadAvailableFiles(); // 데이터 소스 패널(학습 데이터) 새로고침 추가
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

        // 체크박스 및 토글 처리
        $('#negotiable-check').prop('disabled', !isEnabled);
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

    // 기업명 입력 이벤트 (자동 완성)
    $('#seller-name-editor').on('input focus keyup focusin', function() {
        const name = $(this).text().trim() || '매도인';
        const query = name.toLowerCase();
        document.title = `${name} - 매도인 정보`;
        $('#sidebar-header-title').text(name || '매도인 정보');

        const $suggestions = $('#company-suggestions');
        if (!name || name === '매도인') { $suggestions.hide(); return; }
        
        const filtered = myCompanies.filter(c => (c.name || "").toLowerCase().includes(query) || (c.companyName || "").toLowerCase().includes(query));
        
        $suggestions.empty().show();

        if (filtered.length > 0) {
            filtered.slice(0, 10).forEach(c => {
                const $item = $(`<div style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; transition: background 0.2s;">
                                    <div style="font-weight: 700; color: #1e293b;">${c.name || c.companyName || ""}</div>
                                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${c.industry || '기타'}</div>
                                 </div>`);
                $item.on('mouseenter', function() { $(this).css('background', '#f1f5f9'); }).on('mouseleave', function() { $(this).css('background', 'white'); });
                $item.on('mousedown', (e) => { e.preventDefault(); selectedCompanyId = c.id; fillCompanyFields(c); });
                $suggestions.append($item);
            });
        }

        const $directItem = $(`<div style="padding: 10px 16px; cursor: pointer; border-top: 2px solid #f1f5f9; font-size: 13px; color: #8b5cf6; font-weight: 600; background: #f8fafc;">
                                <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">edit_note</span> 직접 입력 (편집 활성화)
                             </div>`);
        $directItem.on('mousedown', (e) => { 
            e.preventDefault(); 
            toggleCompanyFields(true);
            $suggestions.hide(); 
        });
        $suggestions.append($directItem);
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
            renderFinancialTable(migrateFinancialInfo(null), 'financial-table-container');
            
            toggleCompanyFields(false); // Initial State: Disable all fields
            $('#btn-delete-seller').hide();
            hideLoader();
            $('body').removeClass('is-loading');
            loadAvailableFiles(); // [추가] 초기 파일 목록 로드 호출 보장
            return;
        }

        try {
            let seller = null;
            const { data: fullData } = await _supabase.from('sellers').select('*, companies(*)').eq('id', sellerId).maybeSingle();
            
            if (fullData) seller = fullData;

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
            const defaultBlind = { name: false, ceo: false, email: false, establishment: false, address: false, fin_summary: false, fin_analysis: false };
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
            $('#seller-industry').val(seller.industry || company.industry || '기타').trigger('change');
            if ($('#seller-industry').val() === '기타') $('#seller-industry-etc').val(seller.industry || company.industry || '');

            $('#seller-ceo').val(seller.ceo_name || company.ceo_name || '');
            $('#seller-email').val(seller.email || company.email || '');
            $('#seller-establishment').val(seller.establishment_date || company.establishment_date || '');
            $('#seller-address').val(seller.address || company.address || '');
            $('#seller-price').val(seller.matching_price || seller.sale_price || '');
            if ($('#seller-price').val() === '협의') {
                $('#negotiable-check').prop('checked', true);
                $('#seller-price').prop('readonly', true).css('background', '#f8fafc');
            }
            $('#seller-summary').val(seller.summary || company.summary || '');
            $('#seller-key-products').val(seller.key_products || company.key_products || '');
            $('#seller-fin-analysis').val(seller.financial_analysis || company.financial_analysis || '');
            $('#seller-memo').val(seller.sale_info || '');
            $('#seller-manager-memo').val(seller.manager_memo || '');
            $('#private-memo').val(seller.private_memo || '');
            setChip(seller.status || '대기');
            $('#seller-method').val((['대기', '진행중', '완료'].includes(seller.sale_method)) ? '' : (seller.sale_method || ''));

            const finData = seller.financial_info || company.financial_info || null;
            renderFinancialTable(migrateFinancialInfo(finData), 'financial-table-container');

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
            } else if (seller.companies) toggleCompanyFields(true);

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
        const industry = $('#seller-industry').val() === '기타' ? $('#seller-industry-etc').val().trim() : $('#seller-industry').val();
        const summary = $('#seller-summary').val().trim();
        const price = $('#seller-price').val().trim();
        const method = $('#seller-method').val().trim();
        const sale_info = $('#seller-memo').val().trim();
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
        
        // [추가] '저장하기' 시 블라인드 체크박스 자동 활성화 (비공개 저장은 제외)
        if (!isDraft) {
            $('#blind-check-name, #blind-check-ceo, #blind-check-email, #blind-check-establishment, #blind-check-address, #blind-check-fin-summary, #blind-check-fin-analysis').prop('checked', true).trigger('change');
        }

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
            location.href = returnUrl;
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
                    const $item = $(`<li style="display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                        ${badge}
                        <a href="#" class="file-download-link" style="flex:1; font-size:13px; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-decoration:none;">${f.file_name}</a>
                    </li>`);
                    
                    $item.find('.file-download-link').on('click', async (e) => {
                        e.preventDefault();
                        const url = await getSignedFileUrl(f.location || f.storage_path, f.storage_type);
                        if (url) window.open(url, '_blank');
                    });
                    $listT.append($item);
                });
            }
        }
        if($listA.length) {
            $listA.empty();
            if(availableFiles.length) {
                availableFiles.forEach(f => {
                    const badge = getFileBadgeHtml(f);
                    const $item = $(`<li style="display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                        ${badge}
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
                    
                    $listA.append($item);
                });
                // 삭제 버튼 호버 효과
                $('.btn-remove-file').hover(function() { $(this).css('opacity', '1'); }, function() { $(this).css('opacity', '0.7'); });
            }
        }
    }

    $('#add-source-additional').on('click', () => { currentSourceType = 'additional'; $('#file-upload').click(); });
    
    // 파일 업로드 통합 처리 함수
    async function handleFileUploads(files) {
        if (!files.length) return;
        const $listA = $('#source-list-additional');
        
        for (const file of files) {
            if (!(await filetypecheck(file))) continue;
            
            // 1. 임시 로딩 항목 추가
            const loadingBadge = getFileBadgeHtml(null, 'loading');
            const $tempItem = $(`<li class="temp-loading-item" style="display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f1f5f9;">
                ${loadingBadge}
                <span style="flex:1; font-size:13px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name}</span>
            </li>`);
            
            // "파일 없음" 문구 제거 (이미 renderFileList에서 제거했으므로 추가 안전장치)
            if ($listA.find('li:contains("파일 없음")').length) $listA.empty();
            $listA.append($tempItem);

            try {
                // File_Functions.js의 fileUpload는 내부적으로 DB Insert까지 수행함
                const uploadResult = await fileUpload(file, user_id, isNew ? null : sellerId, null, isNew ? null : sellerId);

                
                const uploadedFile = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;
                
                if (uploadedFile && uploadedFile.id) {
                    // [중요] 엔티티 타입과 ID를 seller로 명시적으로 업데이트
                    await _supabase.from('files')
                        .update({ 
                            entity_type: 'seller', 
                            entity_id: isNew ? null : sellerId 
                        })
                        .eq('id', uploadedFile.id);
                    
                    if (isNew) {
                        pendingFiles.push(uploadedFile);
                    }
                }
            } catch (err) { 
                console.error('Upload Error:', err);
                alert(`${file.name} 업로드 실패: ${err.message}`); 
                $tempItem.remove();
            }
        }
        loadAvailableFiles();
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

    $dropZone.on('dragleave dragend drop', function(e) {
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
        const text = $(this).text();
        $('#chat-input').val(text);
        sendMessage();
    });

    // AI 자동 입력 추출
    $('#ai-auto-fill-btn').on('click', async function() {
        const totalFiles = availableFiles.length + companyLinkedFiles.length;
        if (totalFiles === 0) { alert('분석할 파일이 없습니다. 파일을 먼저 추가하거나 기업을 선택하세요.'); return; }
        
        const $btn = $(this), orig = $btn.html();
        
        $btn.prop('disabled', true)
            .addClass('analyzing')
            .html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="margin-right: 8px; color: #ffffff;"></span><span style="font-size: 14px; font-weight: 600; color: #ffffff;">분석 중...</span>');

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
            if (!ctx) { alert('파일에서 분석할 수 있는 텍스트를 찾을 수 없습니다.'); return; }

            const prompt = `
업로드된 기업 관련 문서 내용을 바탕으로 다음 정보를 추출하여 정확한 JSON 형식으로 답변해주세요.
- companyName: 기업명(매도자) (단, '주식회사', '(주)' 등은 제외하고 추출)
- industry: 산업 분야 (가급적 드롭다운 목록에 있는 값으로 매핑: AI, IT·정보통신, SaaS·솔루션, 게임, 공공·국방, 관광·레저, 교육·에듀테크, 금융·핀테크, 농·임·어업, 라이프스타일, 모빌리티, 문화예술·콘텐츠, 바이오·헬스케어, 부동산, 뷰티·패션, 에너지·환경, 외식업·소상공인, 우주·항공, 유통·물류, 제조·건설, 플랫폼·커뮤니티 중 하나)
- ceoName: 대표자명
- email: 이메일
- establishment: 설립일자 (YYYY-MM-DD 형식)
- address: 주소
- summary: 회사소개 (300자 내외 요약)
- keyProducts: 주요 제품/서비스 (핵심 기술 및 제품 라인업)
- financial_info: [{ "year": "연도", "revenue": "매출액(숫자만)", "profit": "영업이익(숫자만)", "net_profit": "당기순이익(숫자만)", "total_assets": "총자산(숫자만)", "total_liabilities": "총부채(숫자만)", "total_equity": "총자본(숫자만)" }]

**주의사항**:
1. "담당자 의견"이나 매도 방식 등은 분석 결과가 확실한 경우에만 포함하세요.
2. 금액이나 숫자는 단위 구분 쉼표 없이 숫자만 추출하세요. (예: 1,000,000 -> 1000000)
3. 알 수 없는 정보는 빈 문자열("") 또는 0으로 반환하세요.
4. 반드시 유효한 JSON 형식으로만 답변하세요. 다른 설명은 생략하세요.
5. **[중요] 'companyName' 필드에는 실제 기업명을 추출하되, 'summary', 'keyProducts' 등 그 외 본문 항목에서는 기업명을 직접 언급하지 마세요.** 필요한 경우 '해당 기업'과 같은 중립적인 표현을 사용하거나 주어를 생략하세요.
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
                    $('#seller-name-editor').text(companyName).trigger('input');
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
                if (json.financial_info && Array.isArray(json.financial_info) && json.financial_info.length > 0) {
                    renderFinancialTable(migrateFinancialInfo(json.financial_info), 'financial-table-container');
                }
                autoResizeAllTextareas();
                $('#company-suggestions').hide();
                alert('AI가 파일 내용을 분석하여 정보를 자동으로 입력했습니다.');
            }
        } catch (e) { 
            console.error('AI Auto-fill Error:', e); 
            const errMsg = e.message || '';
            if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
                markModelAsExceeded(getCurrentModelId());
                alert('⚠️ AI 요청 한도를 초과했습니다.\n다른 모델을 선택해 주세요.');
            } else if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
                alert('⚠️ AI 서비스 접속자가 많아 현재 요청을 처리할 수 없습니다.\n잠시 후 다시 시도해 주세요.');
            } else {
                alert('정보 추출 중 오류가 발생했습니다: ' + (errMsg || '알 수 없는 형식'));
            }
        }
        finally { $btn.prop('disabled', false).removeClass('analyzing').html(orig); }
    });


    // 블라인드 마스킹 실제 수행
    function applyBlindMasking() {
        const anyPersonal = Object.values(blindPersonal).some(v => v);
        if (!isBlindActive && !anyPersonal) return;

        const blindBadge = '<span class="badge-blind">blind</span>';
        const regex = (isBlindActive && blindKeywords.length) ? new RegExp(blindKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') : null;

        // 1-a. 기업명: 뱃지 형태로 표시 (행을 숨기지 않음)
        if (blindPersonal.name) {
            const $name = $('#seller-name-editor'), $rep = $name.next('.report-text-field');
            if ($rep.length) $rep.html(blindBadge);
            else $name.html(blindBadge);
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
