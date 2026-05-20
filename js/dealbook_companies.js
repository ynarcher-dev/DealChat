import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, showLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import { checkNdaStatus, initNdaGate } from './sharing_utils.js';
import { escapeForDisplay, tryRepairJson, resolveIndustry, resolveMgmtStatus, buildFinancialString, buildInvestmentString, buildChatContext } from './utils.js';
import { initModelSelector } from './model_selector.js';
import { applyReportMode, removeReportMode, shouldEnterReportMode, injectReportSectionIcons, reformatReportTable, reformatFinancialTableTransposed } from './dealbook_report_utils.js';
import { autoResizeTextarea } from './textarea_utils.js';
import { migrateFinancialInfo, renderFinancialTable, collectFinancialData, mergeFinancialData } from './financial_utils.js';
import { addFileToSourceList } from './file_render_utils.js';
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
    showLoader();
    // ==========================================
    // 인증 및 초기 설정
    // ==========================================
    let userData = null;
    try {
        userData = JSON.parse(localStorage.getItem('dealchat_users'));
    } catch (e) {}

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    const fromSource = urlParams.get('from');

    // [New] 이전 페이지(목록)로 돌아갈 URL 설정
    let returnUrl = resolveUrl('/my_companies');
    if (fromSource === 'total_companies' || fromSource === 'totalstartup') {
        returnUrl = resolveUrl('/total_companies');
    }

    // [New] 헤더의 뒤로가기 버튼 URL 업데이트
    $('.btn-icon-only[title="이전으로"]').off('click').on('click', function() {
        location.href = returnUrl;
    });

    if (!userData || !userData.isLoggedIn) {
        if (fromSource === 'shared' && companyId) {

        } else {
            checkAuth();
            return;
        }
    } else {
        updateHeaderProfile(userData);
        initUserMenu();
    }

    const user_id = userData ? userData.id : null;
    let isNew = companyId === 'new';
    
    if (isNew) {
        $('#btn-delete-company').hide();
    } else {
        $('#btn-delete-company').show();
    }

    let currentCompanyData = null;
    let availableFiles = [];
    let conversationHistory = [];
    let availableReportTypes = [];
    let currentUploadIsTraining = true;
    let currentSourceType = 'training';

    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    const $summaryText = $('#summary');
    const $industryText = $('#industry');
    const $notebookTitleText = $('#notebook-title-editor');

    // ==========================================
    // AI 모델 선택기 초기화 및 관리
    // ==========================================
    // AI 모델 선택기
    // ==========================================
    const { markModelAsExceeded, getCurrentModelId } = initModelSelector(addAiResponse);

    // ==========================================
    // 데이터 로딩
    // ==========================================

    async function loadCompanyData() {
        try {

            
            // 모든 사용자 정보 로드 (작성자 표시용)
            const { data: users, error: uError } = await _supabase.from('users').select('*');
            if (uError) throw uError;

            const userMap = {};
            if (users) {
                users.forEach(u => {
                    userMap[u.id] = {
                        name: u.name || DEFAULT_MANAGER.name,
                        company: u.company || DEFAULT_MANAGER.company,
                        affiliation: (u.department || u.affiliation) || DEFAULT_MANAGER.department,
                        email: u.email || DEFAULT_MANAGER.email,
                        avatar: u.avatar_url || DEFAULT_MANAGER.avatar
                    };
                });
            }

            // 유틸리티: 사용자 카드 렌더링
            function renderUserCard($card, user, isViewer = false) {
                if (!user) return;
                $card.find('.user-name').text(user.name || '알 수 없음').css('color', '#000000').css('font-weight', '700');
                $card.find('.user-company').text(user.company || 'DealChat');
                $card.find('.user-affiliation').text(user.affiliation || '-');
                
                const $email = $card.find('.user-email');
                $email.text(user.email || '');
                
                // 열람 카드의 경우 이메일 볼드 제거 (색상은 동일하게 유지)
                if (isViewer) {
                    $email.css('font-weight', '400').css('color', '#64748b');
                } else {
                    $email.css('font-weight', 'inherit').css('color', '#64748b');
                }
                
                $card.find('.user-avatar').attr('src', resolveAvatarUrl(user.avatar, 1));
                
                if (!user.email) {
                    $email.hide();
                    $card.find('.user-email-sep').hide();
                } else {
                    $email.show();
                    $card.find('.user-email-sep').show();
                }

                // 이메일 복사 및 효과 연동
                $card.css('cursor', 'pointer').off('click').on('click', function() {
                    if (user.email) {
                        navigator.clipboard.writeText(user.email).then(() => {
                            const $toast = $('#share-toast');
                            if ($toast.length) {
                                $toast.find('span').text('check_circle');
                                $toast.contents().last()[0].textContent = ' 담당자 이메일이 복사되었습니다.';
                                $toast.css('display', 'flex').hide().fadeIn(200).delay(2000).fadeOut(400);
                            } else {
                                alert('담당자 이메일이 복사되었습니다: ' + user.email);
                            }
                        }).catch(err => console.error('Email copy failed:', err));
                    }
                });
                
                $card.attr('title', '작성자의 이메일을 복사합니다.')
                    .hover(
                        function() { $(this).css('border-color', '#1A73E8').css('background', '#f8fafc').css('transform', 'translateY(-1px)'); },
                        function() { $(this).css('border-color', '#e2e8f0').css('background', '#ffffff').css('transform', 'translateY(0)'); }
                    );
            }

            if (isNew) {
                // 신규 작성 시 기본값 설정
                setMgmtStatusChip('발굴기업');
                
                // 신규 작성 시 현재 사용자 정보를 작성자(공유) 및 열람자로 표시
                const currentUser = userMap[user_id] || DEFAULT_MANAGER;
                renderUserCard($('#memo-author-card'), currentUser);
                
                const d = new Date();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                $('#memo-update-date').text(`작성 일시: ${d.getFullYear()}.${mm}.${dd}`);

                // 신규 시에도 기본 재무 정보 표 렌더링 (금융 유틸리티 사용)
                renderFinancialTable(migrateFinancialInfo(null), 'financial-table-container');
                
                hideLoader();
                $('body').removeClass('is-loading');
                return;
            }

            // 기업 정보 로드
            const { data: company, error: cError } = await _supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
            if (cError) throw cError;
            if (!company) {
                alert('기업 정보를 찾을 수 없습니다.');
                location.href = resolveUrl('/my_companies');
                return;
            }

            currentCompanyData = company;
            const isOwner = company && user_id && String(company.user_id) === String(user_id);

            
            // UI 업데이트
            $notebookTitleText.text(company.name || '제목 없음');
            document.title = (company.name || '기업') + ' - DealBook';
            
            $summaryText.val(company.summary || '');
            const rawIndustry = company.industry || '';
            if (rawIndustry.startsWith('기타: ')) {
                $industryText.val('기타').trigger('change');
                $('#industry-other').val(rawIndustry.replace('기타: ', '')).show();
            } else {
                $industryText.val(rawIndustry).trigger('change');
            }

            if (rawIndustry) {
                $industryText.css('color', '#1e293b'); // 저장된 값이 있으면 검은색
            } else {
                $industryText.css('color', '#94a3b8'); // 값이 없으면 초기 회색
            }

            $('#ceo-name').val(company.ceo_name || '');
            $('#company-email').val(company.email || '');
            $('#establishment-date').val(company.establishment_date && company.establishment_date !== '-' ? company.establishment_date : '');
            $('#company-address').val(company.address || '');
            $('#financial-analysis').val(company.financial_analysis || '');
            $('#manager-memo').val(company.manager_memo || '');

            // 진행 현황 버튼 설정
            const status = company.mgmt_status || '대기';
            setMgmtStatusChip(status);

            // 재무 정보 전치 테이블 렌더링
            renderFinancialTable(migrateFinancialInfo(company.financial_info), 'financial-table-container');

            // 투자 정보 행 생성
            $('#investment-rows').empty();
            if (company.investment_info && Array.isArray(company.investment_info)) {
                // 최신 연도가 상단에 오도록 내림차순 정렬
                const sortedInv = [...company.investment_info].sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
                sortedInv.forEach(i => {
                    createInvestmentRow(i.year, i.stage, i.valuation, i.amount, i.investor);
                });
            }
            if ($('#investment-rows').children().length === 0) createInvestmentRow();

            // 신규 필드 반영 [New]
            $('#key-products').val(company.key_products || '');
            $('#private-memo').val(company.private_memo || '');
            


            // 작성자/열람자 정보 반영
            const author = userMap[company.user_id] || DEFAULT_MANAGER;
            const viewer = userMap[user_id] || DEFAULT_MANAGER;
            
            renderUserCard($('#memo-author-card'), author);

            if (company.updated_at || company.created_at) {
                const date = new Date(company.updated_at || company.created_at);
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');
                const hh = String(date.getHours()).padStart(2, '0');
                const min = String(date.getMinutes()).padStart(2, '0');
                $('#memo-update-date').text(`최종 업데이트: ${date.getFullYear()}.${mm}.${dd} ${hh}:${min}`);
            }

            // 채팅 기록 로드
            if (company.history && Array.isArray(company.history) && company.history.length > 0) {
                conversationHistory = company.history;
                $chatMessages.find('.message').remove();
                $welcomeScreen.hide();
                conversationHistory.forEach(msg => {
                    addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                });
                // 채팅 내역 로드 후 스크롤 최하단 이동
                setTimeout(() => {
                    $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                }, 100);
            } else {
                // 채팅 기록이 없으면 시작 화면 표시
                $chatMessages.find('.message').remove();
                $welcomeScreen.show();
            }

            autoResizeAllTextareas();
            
            // [Refactored] NDA 체크 (기업 페이지: 회원은 면제, 비회원은 필수)
            const isMember = userData && userData.isLoggedIn;
            if (!isMember) {
                const isSigned = await checkNdaStatus(_supabase, companyId, user_id, 'company');
                if (!isSigned) {
                    $('body').addClass('nda-active');
                    initNdaGate(_supabase, companyId, 'company', userData, {
                        fromSource,
                        returnUrl: resolveUrl('/shared_items'),
                        onSuccess: () => location.reload()
                    });
                    document.getElementById('nda-modal').addEventListener('hidden.bs.modal', () => {
                        $('body').removeClass('nda-active');
                    }, { once: true });
                    return;
                }
            }

            const viewMode = urlParams.get('mode');

            if (shouldEnterReportMode({ viewMode, fromSource, allowedSources: ['totalstartup', 'total_companies', 'shared'], isNew, isOwner })) {
                applyReadOnlyMode();
            }

        } catch (err) {
            console.error('Data load error:', err);
            alert('데이터를 불러오는 중 오류가 발생했습니다.');
        } finally {
            hideLoader();
            $('body').removeClass('is-loading');
        }
    }

    async function loadAvailableFiles() {
        if (isNew) return; // 신규 작성 시에는 개별 파일 로드 생략
        try {
            const { data, error } = await _supabase
                .from('files')
                .select('*')
                .eq('entity_id', companyId)
                .eq('entity_type', 'company');
            if (error) throw error;

            availableFiles = data || [];
            renderCompanyFiles();
        } catch (err) {
            console.error('File load error:', err);
        }
    }

    function renderCompanyFiles() {
        $('#source-list-training').empty();

        const companyFiles = availableFiles.filter(f => f.entity_id === companyId);
        companyFiles.forEach(file => {
            addFileToSourceList(file.file_name, file.id, file.storage_path, true, false, file.parsedtext || file.parsedText, null, '#1A73E8', file.storage_type || 's3');
        });
    }

    // ==========================================
    // UI 헬퍼 함수
    // ==========================================
    function setMgmtStatusChip(value) {
        $('.btn-status-chip').removeClass('active');
        if (!value) return;
        
        const isOther = value.startsWith('기타: ') || value === '기타';
        const targetValue = isOther ? '기타' : value.replace(/\s+/g, '');

        $('.btn-status-chip').each(function() {
            const chipValue = ($(this).data('value') || "").replace(/\s+/g, '');
            if (chipValue === targetValue) {
                $(this).addClass('active');
            }
        });

        if (isOther) {
            $('#mgmt-status-other-wrapper').show();
            if (value.startsWith('기타: ')) {
                $('#mgmt-status-other').val(value.replace('기타: ', ''));
            }
        } else {
            $('#mgmt-status-other-wrapper').hide();
        }
    }

    $(document).on('click', '.btn-status-chip', function() {
        setMgmtStatusChip($(this).data('value'));
    });

    // [New] 산업군 '기타' 선택 시 입력 필드 토글 및 색상 변경
    $('#industry').on('change', function() {
        const val = $(this).val();
        
        // 색상 변경 처리 (플레이스홀더 효과)
        if (val) {
            $(this).css('color', '#1e293b');
        } else {
            $(this).css('color', '#94a3b8');
        }

        if (val === '기타') {
            $('#industry-other').fadeIn(200).focus();
        } else {
            $('#industry-other').hide().val('');
        }
    });




    function autoResizeAllTextareas() {
        autoResizeTextarea($summaryText);
        autoResizeTextarea($('#key-products'));
        autoResizeTextarea($('#financial-analysis'));
        autoResizeTextarea($('#manager-memo'));
        autoResizeTextarea($('#private-memo'));
    }

    // [New] 텍스트 입력 시 자동 높이 조절 연결
    $(document).on('input', '#summary, #key-products, #financial-analysis, #manager-memo, #private-memo', function() {
        autoResizeTextarea($(this));
    });

    // 재무 정보 행 추가


    // 투자 정보 행 추가
    function createInvestmentRow(year = '', stage = '', valuation = '', amount = '', investor = '') {
        const stages = ['Seed', 'Pre-A', 'Series A', 'Series B', 'Series C 이상', 'M&A', 'Pre-IPO', 'IPO'];
        let stageOptions = '<option value="">단계 선택</option>';
        stages.forEach(s => {
            stageOptions += `<option value="${s}" ${stage === s ? 'selected' : ''}>${s}</option>`;
        });

        const rowId = `inv-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const rowHtml = `
            <div class="investment-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; padding: 0 36px 0 12px; box-sizing: border-box; width: 100%;">
                <input type="text" class="inv-year" value="${year}" placeholder="연도"
                    style="flex: 1; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: center; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
                <select class="inv-stage"
                    style="flex: 1.5; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">${stageOptions}</select>
                <input type="text" class="inv-valuation format-number" value="${valuation}" placeholder="밸류"
                    style="flex: 2; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
                <input type="text" class="inv-amount format-number" value="${amount}" placeholder="금액"
                    style="flex: 2; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
                <input type="text" class="inv-investor" value="${investor}" placeholder="투자자"
                    style="flex: 2.5; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px; text-align: left; background: #ffffff; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #cbd5e1; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -30px; transition: color 0.2s;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">do_not_disturb_on</span>
                </button>
            </div>
        `;
        $('#investment-rows').append(rowHtml);
    }




    $(document).on('click', '.btn-remove-row', function() { $(this).parent().remove(); });
    $('#add-investment-btn').on('click', () => createInvestmentRow());

    // 숫지 포맷팅
    $(document).on('input', '.format-number', function() {
        let val = $(this).val().replace(/[^0-9.-]/g, '');
        if (val) {
            const parts = val.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            $(this).val(parts.join('.'));
        }
    });

    // ==========================================
    // 저장 및 삭제 로직
    // ==========================================
    async function saveCompany(isDraft = false) {
        const name = $notebookTitleText.text().trim();
        if (!name || name === '제목 없음' || name === '') { 
            alert('기업명을 입력해주세요.'); 
            $notebookTitleText.focus();
            return; 
        }

        const industryResult = resolveIndustry($('#industry').val(), $('#industry-other').val());
        if (industryResult.error) {
            alert(industryResult.error);
            $('#industry').focus();
            return;
        }
        const industry = industryResult.value;

        const statusResult = resolveMgmtStatus(
            $('.btn-status-chip.active').data('value'),
            $('#mgmt-status-other').val()
        );
        if (statusResult.error) {
            alert(statusResult.error);
            return;
        }
        const status = statusResult.value;

        // 재무 정보 수집 (전치 테이블)
        const financial_info = collectFinancialData('financial-table-container');

        // 투자 정보 수집
        const investment_info = [];
        $('.investment-row').each(function() {
            investment_info.push({
                year: $(this).find('.inv-year').val(),
                stage: $(this).find('.inv-stage').val(),
                valuation: $(this).find('.inv-valuation').val(),
                amount: $(this).find('.inv-amount').val(),
                investor: $(this).find('.inv-investor').val()
            });
        });




        const payload = {
            name: name,
            industry: industry,
            mgmt_status: status,
            summary: $summaryText.val(),
            ceo_name: $('#ceo-name').val(),
            email: $('#company-email').val(),
            establishment_date: $('#establishment-date').val() || '-',
            address: $('#company-address').val(),
            financial_info: financial_info,
            investment_info: investment_info,
            financial_analysis: $('#financial-analysis').val(),
            manager_memo: $('#manager-memo').val(),
            key_products: $('#key-products').val(),
            private_memo: $('#private-memo').val(),

            is_draft: isDraft,
            user_id: user_id,
            history: conversationHistory,
            updated_at: new Date().toISOString()
        };

        showLoader();
        try {
            let result;
            if (isNew) {
                result = await _supabase.from('companies').insert(payload).select().single();
                if (!result.error && result.data && pendingFiles.length > 0) {
                    const newId = result.data.id;
                    const pendingIds = pendingFiles.map(f => f.id);
                    await _supabase.from('files')
                        .update({ entity_id: newId, entity_type: 'company' })
                        .in('id', pendingIds);
                    pendingFiles = [];
                }
            } else {
                result = await _supabase.from('companies').update(payload).eq('id', companyId).select().single();
            }

            if (result.error) throw result.error;

            alert(isDraft ? '비공개로 저장되었습니다.' : '저장되었습니다.');
            if (isNew) {
                location.href = returnUrl;
            } else {
                location.reload();
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('저장 중 오류가 발생했습니다.');
        } finally {
            hideLoader();
        }
    }

    $('#btn-save').on('click', () => saveCompany(false));
    $('#btn-draft').on('click', () => saveCompany(true));

    // [New] AI 자동 입력 기능
    $('#ai-auto-fill-btn').on('click', async function() {
        const trainingFiles = availableFiles.filter(f => f.entity_id === companyId || pendingFiles.some(pf => pf.id === f.id));
        const contextText = trainingFiles
            .filter(f => (f.parsedtext || f.parsedText) && !(f.parsedtext || f.parsedText).startsWith('[텍스트 미추출'))
            .map(f => `파일명: ${f.file_name}\n내용: ${f.parsedtext || f.parsedText}`)
            .join('\n\n---\n\n');

        if (!contextText) {
            showToast('분석할 수 있는 파일 내용이 없습니다. 먼저 분석 완료된 파일을 업로드해주세요.', { icon: 'info', iconColor: '#6366f1', duration: 3000 });
            return;
        }

        const $btn = $(this);

        // [스켈레톤 + 경과시간] AI가 채울 타깃에 시머 적용 + 버튼 카운터
        const ux = beginAiAutofillUx({
            $btn,
            fields: [
                '#notebook-title-editor', '#industry', '#industry-other',
                '#ceo-name', '#company-email', '#establishment-date', '#company-address',
                '#summary', '#key-products', '#financial-analysis', '#manager-memo'
            ],
            containers: ['#financial-table-container', '#investment-rows']
        });

        let aiSucceeded = false;
        try {
            // [1] 일반 회사 정보 프롬프트 (financial_info 제외)
            const generalPrompt = `
업로드된 기업 관련 문서 내용을 바탕으로 다음 정보를 추출하여 정확한 JSON 형식으로 답변해주세요.
- name: 기업명 (단, '주식회사', '(주)' 등은 제외하고 추출)
- industry: 산업 분야 (가급적 드롭다운 목록에 있는 값으로 매핑: AI, IT·정보통신, SaaS·솔루션, 게임, 공공·국방, 관광·레저, 교육·에듀테크, 금융·핀테크, 농·임·어업, 라이프스타일, 모빌리티, 문화예술·콘텐츠, 바이오·헬스케어, 부동산, 뷰티·패션, 에너지·환경, 외식업·소상공인, 우주·항공, 유통·물류, 제조·건설, 플랫폼·커뮤니티 중 하나)
- ceo_name: 대표자명
- email: 이메일
- establishment_date: 설립일자 (YYYY-MM-DD 형식)
- address: 주소
- summary: 회사소개
  · **헤드라인·넘버링·bullet 없이 평문 한 문장으로만 작성**
  · 예시: "유망 브랜드를 발굴, 육성하고 글로벌 인프라와 지분 투자를 통해 성장시키는 외식 기업"
  · 핵심 사업·제품·차별점을 압축한 한 줄
  · 어조: 객관적·서술형. 과장 형용사 금지("혁신적인", "최고의", "독보적인" 등)
  · 회사명은 직접 언급 금지 (주어 생략 또는 "해당 기업")
  · 재무 수치 포함 금지
- key_products: 주요 제품/서비스
  · 형식: 줄마다 "숫자) 제품/서비스명 — 설명" 형태로 한 줄씩
    예시(줄바꿈 포함된 단일 문자열):
      1) 제품A — 한 줄 설명
      2) 제품B — 한 줄 설명
      3) 제품C — 한 줄 설명
  · **최대 4개 항목**. 정보가 부족하면 그 이하 허용
  · 각 줄은 80자 이내, 기능·용도 중심. 마케팅 카피 금지
  · 재무 수치 포함 금지
- investment_info: [{ "year": "연도", "stage": "단계", "valuation": "벨류(숫자만)", "amount": "금액(숫자만)", "investor": "투자자" }]
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
- manager_memo: 담당자 의견 (다각도 평가)
  · 형식: 항목마다 두 줄 — 첫 줄에 "숫자) 헤드라인", 둘째 줄에 "- 평가 본문". 부문별로 헤드라인을 따로 둠. **항목 사이는 빈 줄 1줄로 구분**
    예시(줄바꿈 포함된 단일 문자열):
      1) 사업·시장성: 확장 여지가 큰 시장에서의 선점 포지션
      - 타깃 시장 규모가 충분하고 진입 장벽이 형성되는 초기 국면이어서, 현재의 점유율 확대 흐름이 유지될 경우 카테고리 리더십 확보 가능성이 있는 것으로 평가됩니다.

      2) 기술·제품 경쟁력: 차별화 요소 보유, 다만 모방 위험 상존
      - 핵심 제품의 사용성·완성도가 경쟁사 대비 앞서 있다는 정성적 신호가 관찰되나, 진입 장벽이 특허·네트워크 효과보다 운영 역량에 기반해 후발 주자의 추격이 빠를 수 있는 경향이 있습니다.

      3) 재무·성장성: 외형 성장과 수익성 사이의 트레이드오프
      - 매출 성장과 동시에 손익이 악화되는 구간으로, 단기 적자는 성장기 기업에서 흔한 패턴이지만 손익분기점 도달 시점과 자금 소진 속도가 향후 가치 평가의 핵심 변수로 보입니다.

      4) 리스크·거래 매력도: 자금 조달·규제·핵심 인력 의존 등 다층 리스크
      - 추가 라운드 의존도, 산업 규제 변화 민감도, 핵심 인력 이탈 가능성 등 복수 리스크가 동시에 존재해, 거래 시 밸류에이션 협상력은 인수자 측에 다소 유리하게 작용할 수 있는 경향이 있습니다.
  · **각 항목(헤드라인+본문) 사이에는 반드시 빈 줄 1줄을 삽입.** 즉 단일 문자열 내에서 항목 구분자는 "\n\n"
  · **헤드라인은 "부문명: 해당 부문의 평가 요지"** 형태로 작성. 단순 부문명("재무·성장성")만 적는 것 금지
  · **최대 4개 항목** (사업·시장성 / 기술·제품 경쟁력 / 재무·성장성 / 리스크·거래 매력도 중심으로 선별). 정보 부족 시 그 이하 허용
  · 본문은 항목당 1~2문장. 한 부문에 치우치지 말 것
  · **학습 데이터(LLM 일반 지식)를 적극 활용하여 산업·시장·경쟁 관점에서 다각도로 평가**
  · 업로드 문서뿐 아니라 알려진 산업 트렌드, 경쟁 환경, 일반적 평가 기준을 반영
  · 단정적 표현 지양, "~로 평가됨", "~경향이 있음" 같은 완화된 표현 사용

[출력 형식 — key_products / financial_analysis / manager_memo 공통 ※매우 중요]
- 각 항목은 **줄바꿈 문자(\n)로 구분된 단일 JSON 문자열**로 반환
- **절대 배열([...])로 반환하지 마세요.** 예: ["1) 항목", "2) 항목"] (X) → "1) 항목\n2) 항목" (O)
- 정보가 부족하면 최대 개수 미만 허용

**주의사항**:
1. 금액이나 숫자는 단위 구분 쉼표 없이 숫자만 추출하세요. (예: 1,000,000 -> 1000000)
2. 알 수 없는 정보는 빈 문자열("") 또는 빈 배열([])로 반환하세요. 단, manager_memo는 학습 데이터를 기반으로 가능한 한 작성하세요.
3. 반드시 유효한 JSON 형식으로만 답변하세요. 다른 설명은 생략하세요.
            `.trim();

            // [2] 재무정보 전용 프롬프트 (표 구조 매핑 가드 강화)
            const financialPrompt = `
업로드된 문서에서 재무제표 데이터를 추출하여 JSON 객체로만 답변하세요.

[출력 형식]
{
  "financial_info": [
    { "year": "YYYY", "revenue": "숫자", "profit": "숫자", "profit_label": "라벨원문", "net_profit": "숫자", "net_profit_label": "라벨원문", "total_assets": "숫자", "total_liabilities": "숫자", "total_equity": "숫자" }
  ]
}

[필드 정의]
- year: 연도 (예: "2023"). 회계연도/사업연도 표기를 우선 사용.
- revenue: 매출액 / 영업수익
- profit: 영업손익 줄의 값 (손실이면 마이너스 부호 포함). 라벨이 "영업이익"/"영업손익"/"영업손실"인 줄.
- profit_label: profit을 추출한 줄의 라벨 원문 그대로. (예: "영업이익", "영업손익", "영업손실", "영업이익(손실)")
- net_profit: 당기순손익 줄의 값 (손실이면 마이너스 부호 포함). 라벨이 "당기순이익"/"당기순손익"/"당기순손실"인 줄 — 손익계산서의 **최종 줄**(법인세 차감 후).
- net_profit_label: net_profit을 추출한 줄의 라벨 원문 그대로. (예: "당기순이익", "당기순손익", "당기순손실", "당기순이익(손실)")

[혼동하기 쉬운 항목 — net_profit으로 잡지 말 것]
  · "법인세비용차감전순이익" / "법인세비용차감전손익" — 세전 값이라 당기순이익과 다름
  · "계속영업이익" / "중단영업이익" — 별도 항목
  · 위 항목들은 net_profit이 아닙니다. 그 아래(또는 별도)에 "당기순이익/당기순손익/당기순손실" 줄이 있으면 그것을 사용하세요.
  · 정상적인 손익계산서라면 거의 항상 당기순이익 줄이 존재합니다. 적극적으로 찾아 추출하세요.
- total_assets: 총자산 (자산총계)
- total_liabilities: 총부채 (부채총계)
- total_equity: 총자본 (자본총계)

[엄격 규칙 — 위반 시 잘못된 답변으로 간주]
1. **연도-값 매핑이 모호하면 그 연도 전체를 빈 객체로 만들지 말고, 아예 결과에서 제외하세요.** 추측 금지.
2. 표의 열 헤더(연도)와 행 헤더(매출액 등)가 명확히 교차하는 셀의 값만 사용하세요.
3. 단위 표시("(단위: 백만원)", "(단위: 천원)", "단위: 원" 등)가 표 근처에 있다면 **실제 원(KRW) 단위로 환산**한 정수를 반환하세요.
   - "(단위: 백만원)"이고 표 값이 "1,200"이면 → "1200000000"
   - "(단위: 천원)"이고 표 값이 "1,200"이면 → "1200000"
   - 단위 표시가 없으면 표 값 자체를 숫자로 변환 (예: "1,234,567" → "1234567")
4. **profit / net_profit는 손실(음수)이면 반드시 마이너스 부호로 반환.** 재무제표에 "영업손실 (123)" 또는 "영업손실 △123"으로 적혀 있으면 "-123"으로 반환하세요. 라벨이 "영업손익" / "영업이익(손실)" 같은 중립 표제일 때도 실제 값이 손실이면 마이너스 부호를 붙여야 합니다. profit_label에는 원문 라벨을 그대로 적어주세요 (클라이언트 보조 검증용).
5. **profit_label / net_profit_label은 재무제표 라벨을 글자 그대로 복사.** 변형·번역·요약 금지. (예: 문서가 "영업이익(손실)"이면 그대로 "영업이익(손실)").
6. 그 외 항목(revenue, total_assets, total_liabilities, total_equity)에서 음수(괄호·△·마이너스)가 있으면 마이너스 부호로 반환하세요. (예: "(123)" → "-123")
7. 알 수 없거나 비어있는 셀은 빈 문자열("")로. profit_label / net_profit_label도 라벨을 못 읽으면 ""로.
8. 천 단위 쉼표는 모두 제거하세요.
9. 같은 연도가 여러 번 나타나면 가장 신뢰도 높은 표(예: 정식 재무상태표/손익계산서) 값을 사용하세요.
10. 회계 계정이 없으면 추측하지 말고 ""로.
11. financial_info 외의 다른 필드는 절대 포함하지 마세요.
12. 반드시 유효한 JSON 객체만 출력하세요. 마크다운 펜스, 설명, 주석 모두 금지.

[추가 안전장치]
- 문서에 표 형태 재무 데이터가 전혀 없으면 { "financial_info": [] } 를 반환하세요.
- 1~2개 항목만 단편적으로 보이는 경우(불완전 표)도 financial_info: [] 를 반환하세요.
            `.trim();

            // 두 호출 병렬 실행
            const [generalResp, financialResp] = await Promise.all([
                addAiResponse(generalPrompt, contextText),
                addAiResponse(financialPrompt, contextText)
            ]);
            const [generalData, financialData] = await Promise.all([
                generalResp.json(),
                financialResp.json()
            ]);

            // 공통 JSON 파서
            const parseJsonFromAi = (data) => {
                const resultText = data.answer || data.text || data.response || "";
                let jsonString = '';
                const markdownMatch = resultText.match(/```json\n?([\s\S]*?)\n?```/);
                if (markdownMatch) {
                    jsonString = markdownMatch[1].trim();
                } else {
                    const curlyMatch = resultText.match(/\{[\s\S]*\}/);
                    if (curlyMatch) jsonString = curlyMatch[0].trim();
                }
                if (!jsonString) {
                    console.error('❌ AI 응답에서 JSON을 찾을 수 없습니다. 원본:', resultText);
                    return null;
                }
                try {
                    return JSON.parse(jsonString);
                } catch (pErr) {
                    try {
                        return JSON.parse(tryRepairJson(jsonString));
                    } catch (rErr) {
                        console.error('❌ JSON 복구 및 파싱 실패. 문자열:', jsonString);
                        return null;
                    }
                }
            };

            const generalJson = parseJsonFromAi(generalData);
            const financialJson = parseJsonFromAi(financialData);

            if (!generalJson && !financialJson) {
                throw new Error('AI로부터 유효한 JSON 형식을 받지 못했습니다. 콘솔 로그를 확인해주세요.');
            }

            // 병합: 재무정보는 financialJson, 나머지는 generalJson
            const jsonData = Object.assign({}, generalJson || {});
            if (financialJson && Array.isArray(financialJson.financial_info)) {
                jsonData.financial_info = financialJson.financial_info;
            }

            // [방어 코드] 일부 모델이 텍스트 필드를 배열로 반환하는 경우 \n으로 join
            ['summary', 'key_products', 'financial_analysis', 'manager_memo'].forEach(f => {
                if (Array.isArray(jsonData[f])) jsonData[f] = jsonData[f].join('\n');
            });

            // 데이터 UI 매핑
            if (jsonData.name) $('#notebook-title-editor').text(jsonData.name);
            
            if (jsonData.industry) {
                const industries = ["AI", "IT·정보통신", "SaaS·솔루션", "게임", "공공·국방", "관광·레저", "교육·에듀테크", "금융·핀테크", "농·임·어업", "라이프스타일", "모빌리티", "문화예술·콘텐츠", "바이오·헬스케어", "부동산", "뷰티·패션", "에너지·환경", "외식업·소상공인", "우주·항공", "유통·물류", "제조·건설", "플랫폼·커뮤니티"];
                if (industries.includes(jsonData.industry)) {
                    $('#industry').val(jsonData.industry).trigger('change');
                } else {
                    $('#industry').val('기타').trigger('change');
                    $('#industry-other').val(jsonData.industry);
                }
            }

            if (jsonData.ceo_name) $('#ceo-name').val(jsonData.ceo_name);
            if (jsonData.email) $('#company-email').val(jsonData.email);
            if (jsonData.establishment_date && jsonData.establishment_date !== '-') $('#establishment-date').val(jsonData.establishment_date);
            if (jsonData.address) $('#company-address').val(jsonData.address);
            if (jsonData.summary) $('#summary').val(jsonData.summary);
            if (jsonData.key_products) $('#key-products').val(jsonData.key_products);
            if (jsonData.financial_analysis) $('#financial-analysis').val(jsonData.financial_analysis);
            if (jsonData.manager_memo) $('#manager-memo').val(jsonData.manager_memo);

            // 재무 정보 (전치 테이블 갱신)
            if (jsonData.financial_info && Array.isArray(jsonData.financial_info) && jsonData.financial_info.length > 0) {
                const existingWire = collectFinancialData('financial-table-container');
                const merged = mergeFinancialData(existingWire, jsonData.financial_info, 'companies');
                renderFinancialTable(merged, 'financial-table-container', 'companies');
            }

            // 투자 정보
            if (jsonData.investment_info && Array.isArray(jsonData.investment_info) && jsonData.investment_info.length > 0) {
                $('#investment-rows').empty();
                jsonData.investment_info.forEach(i => {
                    createInvestmentRow(i.year, i.stage, i.valuation, i.amount, i.investor);
                });
            }

            // 숫자 포맷팅 강제 트리거
            $('.format-number').trigger('input');
            autoResizeAllTextareas();

            aiSucceeded = true;
            showToast('AI 자동 입력이 완료되었습니다.', { icon: 'check_circle', iconColor: '#22c55e' });

        } catch (err) {
            console.error('AI Auto-fill Error:', err);
            const errMsg = err.message || '';
            let toastMsg;
            if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
                markModelAsExceeded(getCurrentModelId());
                toastMsg = 'AI 요청 한도를 초과했습니다. 다른 모델을 선택해 주세요.';
            } else if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
                toastMsg = 'AI 서비스 접속자가 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요.';
            } else {
                toastMsg = '분석 중 오류가 발생했습니다: ' + (errMsg || '알 수 없는 형식');
            }
            showToast(toastMsg, { icon: 'error', iconColor: '#ef4444', duration: 4500 });
        } finally {
            ux.end(aiSucceeded);
        }
    });

    $('#btn-delete-company').on('click', async function() {
        if (!confirm('정말로 이 기업 정보를 삭제하시겠습니까?')) return;
        showLoader();
        try {
            const { error } = await _supabase.from('companies').update({ deleted_at: new Date().toISOString() }).eq('id', companyId);
            if (error) throw error;
            alert('삭제되었습니다.');
            location.href = returnUrl;
        } catch (err) {
            alert('삭제 중 오류가 발생했습니다.');
        } finally {
            hideLoader();
        }
    });

    // ==========================================
    // 채팅 로직
    // ==========================================
    function addMessage(text, sender, animate = true) {
        $welcomeScreen.hide();
        const isAi = sender === 'ai';
        const msgHtml = `
            <div class="message ${sender}">
                <div class="message-avatar">
                    <span class="material-symbols-outlined" style="font-size: 18px;">${isAi ? 'smart_toy' : 'person'}</span>
                </div>
                <div class="message-content">${escapeForDisplay(text)}</div>
            </div>
        `;
        $chatMessages.append(msgHtml);
        
        if (animate) {
            setTimeout(() => {
                $chatMessages.scrollTop($chatMessages[0].scrollHeight);
            }, 50);
        }
    }

    async function sendMessage() {
        const text = $chatInput.val().trim();
        if (!text) return;
        $chatInput.val('').css('height', 'auto');
        addMessage(text, 'user');
        
        // AI 타이핑 표시기 추가
        const $typingMsg = $(`
            <div class="message ai typing-indicator">
                <div class="message-avatar">
                    <span class="material-symbols-outlined" style="font-size: 18px;">smart_toy</span>
                </div>
                <div class="message-content">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>
        `);
        $chatMessages.append($typingMsg);
        setTimeout(() => {
            $chatMessages.scrollTop($chatMessages[0].scrollHeight);
        }, 50);

        try {
            let ragContext = "";
            if (!isNew && companyId) {
                try {
                    ragContext = await searchVectorDB(text, companyId) || "";
                } catch (vecErr) {
                    console.warn('Vector search failed (non-fatal):', vecErr);
                }
            }

            // UI 데이터(재무/투자)를 수집 후 순수 함수로 텍스트 변환
            // 재무는 wire 포맷({years, items})을 그대로 buildFinancialString에 전달하여
            // 사용자가 라벨을 "영업손실" 등으로 수정한 경우에도 그대로 반영되게 함
            const finData = collectFinancialData('financial-table-container');

            const investmentRows = [];
            $('.investment-row').each(function() {
                investmentRows.push({
                    year:      $(this).find('.inv-year').val(),
                    stage:     $(this).find('.inv-stage').val(),
                    valuation: $(this).find('.inv-valuation').val(),
                    amount:    $(this).find('.inv-amount').val(),
                    investor:  $(this).find('.inv-investor').val(),
                });
            });

            const context = buildChatContext({
                name:             $notebookTitleText.text(),
                industry:         $industryText.val(),
                summary:          $summaryText.val(),
                financialStr:     buildFinancialString(finData),
                investmentStr:    buildInvestmentString(investmentRows),
                financialAnalysis: $('#financial-analysis').val(),
                managerMemo:      $('#manager-memo').val(),
                ragContext,
            });
            

            const response = await addAiResponse(text, context);
            const data = await response.json();

            
            const answer = data.answer || data.text || data.response || '죄송합니다. 답변을 생성하지 못했습니다.';
            
            $typingMsg.remove();
            addMessage(answer, 'ai');
            
            conversationHistory.push({ role: 'user', content: text });
            conversationHistory.push({ role: 'assistant', content: answer });

            if (!isNew && companyId) {
                await _supabase.from('companies').update({ history: conversationHistory }).eq('id', companyId);
            }
        } catch (err) {
            console.error('❌ AI 채팅 오류:', err);
            $typingMsg.remove();
            const errMsg = err.message || '';
            if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
                markModelAsExceeded(getCurrentModelId());
                addMessage('⚠️ 선택하신 AI 모델의 요청 한도가 초과되었습니다. 다른 모델을 선택하여 다시 질문해 주세요.', 'ai');
            } else if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand')) {
                addMessage('⚠️ AI 서비스 접속자가 많아 지연되고 있습니다. 잠시 후 다시 시도해 주세요.', 'ai');
            } else {
                addMessage(`오류가 발생했습니다: ${errMsg || '알 수 없는 오류'}`, 'ai');
            }
        }
    }

    // [New] 잘린 JSON 복구 함수
    $('#send-btn').on('click', sendMessage);
    $chatInput.on('keypress', e => { if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    $('#clear-history-btn').on('click', async function() {
        if (!confirm('대화 기록을 모두 삭제하시겠습니까?')) return;
        conversationHistory = [];
        $chatMessages.find('.message').remove();
        $welcomeScreen.show();
        
        if (!isNew && companyId) {
            await _supabase.from('companies').update({ history: [] }).eq('id', companyId);
        }
    });

    $(document).on('click', '.prompt-chip', function() {
        const text = $(this).attr('data-prompt') || $(this).text();
        $chatInput.val(text);
        sendMessage();
    });

    // ==========================================
    // 파일 업로드 및 관리
    // ==========================================
    let pendingFiles = [];



    $(document).on('click', '.delete-file', async function() {
        const id = $(this).data('id');
        if (!confirm('파일을 연결 해제하시겠습니까?')) return;
        try {
            await _supabase.from('files').delete().eq('id', id);
            $(this).closest('li').remove();
        } catch (e) { alert('파일 삭제 실패'); }
    });

    $(document).on('click', '.btn-reextract', async function() {
        const id = $(this).data('id');
        const fileMeta = availableFiles.find(f => String(f.id) === String(id));
        if (!fileMeta) return;
        const $item = $(this).closest('li');
        const { reExtractAndUpdateFile } = await import('./file_render_utils.js');
        const result = await reExtractAndUpdateFile($item, fileMeta, _supabase, '#1A73E8');
        if (result.success) {
            fileMeta.parsedtext = result.text;
            fileMeta.parsedText = result.text;
        }
    });

    $('#add-source-training').on('click', () => { currentSourceType = 'training'; $('#file-upload').click(); });
    $('#add-source-non-training').on('click', () => { currentSourceType = 'non-training'; $('#file-upload').click(); });

    async function handleFileUpload(files) {
        if (!files || !files.length) return;

        const total = files.length;
        let successCount = 0;
        let failCount = 0;
        let processed = 0;

        const $fileCard = $('#training-drop-zone');
        const overlay = showPanelOverlay($fileCard[0], {
            label: total > 1 ? `파일 분석 중... (0/${total})` : '파일 분석 중...'
        });

        try {
            for (const file of files) {
                processed++;
                if (total > 1) overlay.update(`파일 분석 중... (${processed}/${total})`);

                if (!(await filetypecheck(file))) {
                    // filetypecheck 내부에서 거부 토스트가 이미 표시됨
                    failCount++;
                    continue;
                }

                const $tempItem = addFileToSourceList(file.name, 'pending-' + Date.now(), null, true, false, null, 'loading');

                try {
                    const uploadResult = await fileUpload(file, user_id, isNew ? null : companyId);
                    const uploadedFile = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;

                    if (uploadedFile && uploadedFile.storage_path) {
                        const _pt = uploadedFile.parsedtext || uploadedFile.parsedText;
                        const isSearchable = _pt && !_pt.startsWith('[텍스트 미추출');
                        const finalStatus = isSearchable ? 'reflected' : 'failed';

                        const badgeClass = finalStatus === 'reflected' ? 'badge-ai-reflected' : 'badge-ai-failed';
                        const badgeText = finalStatus === 'reflected' ? 'AI 반영됨' : 'AI 미반영';
                        const badgeTitle = finalStatus === 'reflected' ? 'AI 에이전트가 이 문서의 내용을 읽고 답변에 활용할 수 있습니다.' : '이미지 위주의 문서이거나 텍스트가 부족하여 AI 검색이 제한됩니다.';

                        const { openSignedFile } = await import('./file_render_utils.js');
                        $tempItem.find('.file-link').attr('href', '#').off('click').on('click', openSignedFile(uploadedFile.storage_path));
                        $tempItem.find('.ai-status-badge').removeClass('badge-ai-loading').addClass(badgeClass).text(badgeText).attr('title', badgeTitle);
                        $tempItem.find('.delete-file').attr('data-id', uploadedFile.id);

                        if (isNew) {
                            pendingFiles.push({ id: uploadedFile.id });
                        } else if (uploadedFile.id) {
                            await _supabase.from('files')
                                .update({ entity_id: companyId, entity_type: 'company' })
                                .eq('id', uploadedFile.id);
                            // 로컬 객체에도 동기화 (AI 자동입력 필터 f.entity_id === companyId가 잡도록)
                            uploadedFile.entity_id = companyId;
                            uploadedFile.entity_type = 'company';
                        }
                        availableFiles.push(uploadedFile);
                        successCount++;
                    } else {
                        console.error('Upload failed: invalid response', uploadResult);
                        $tempItem.remove();
                        failCount++;
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
            // 묶음 완료 토스트 (개별 실패 토스트와 중복되지 않도록 성공이 1건 이상일 때만)
            if (successCount > 0) {
                const msg = failCount > 0
                    ? `${successCount}개 업로드 완료 · ${failCount}개 실패`
                    : `${successCount}개 파일 업로드 완료`;
                overlay.hide({ status: 'success', toast: msg });
            } else {
                overlay.hide();
            }
        }
    }

    $('#file-upload').on('change', function() {
        handleFileUpload(this.files);
        this.value = '';
    });

    // 드래그 앤 드롭 이벤트 핸들러 추가
    const $dropZone = $('#training-drop-zone');

    $dropZone.on('dragover', function(e) {
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

    $dropZone.on('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('drag-over');

        const files = e.originalEvent.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files);
        }
    });

    // ==========================================
    // 초기 실행
    // ==========================================
    loadCompanyData();
    loadAvailableFiles();

    // ==========================================
    // 읽기 전용/리포트 모드 처리 (16차 전문 리포트 UI)
    // ==========================================
    function applyReadOnlyMode() {
        applyReportMode({
            reportTitle: '기업 정보 - DealChat',
            titleSelector: '#notebook-title-editor',
            textareaIds: ['summary', 'key-products', 'financial-analysis', 'manager-memo'],
            inputIds: ['notebook-title-editor'],
            afterApply: () => {
                reformatReportTable($('#investment-rows'), '.investment-row', [
                    { header: '년도',      selector: '.inv-year',       flex: 1,   align: 'center' },
                    { header: '단계',      selector: '.inv-stage',      flex: 1.5, align: 'center' },
                    { header: '벨류(원)',   selector: '.inv-valuation',  flex: 2,   align: 'right', format: 'number' },
                    { header: '금액(원)',   selector: '.inv-amount',     flex: 2,   align: 'right', format: 'number' },
                    { header: '투자자',    selector: '.inv-investor',   flex: 2.5, align: 'center' }
                ]);
                reformatFinancialTableTransposed('financial-table-container');
                injectReportSectionIcons({
                    'notebook-title-editor': 'business',
                    'industry': 'category',
                    'ceo-name': 'person',
                    'company-email': 'mail',
                    'establishment-date': 'calendar_month',
                    'company-address': 'location_on',
                    'mgmt-status-group': 'account_tree',
                    'summary': 'description',
                    'key-products': 'inventory_2',
                    'investment-section': 'payments',
                    'financial-section': 'analytics',
                    'financial-analysis': 'query_stats',
                    'manager-memo': 'chat_bubble'
                });
            }
        });
    }





    // 초기 데이터 로드 시작
});
