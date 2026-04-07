import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, showLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';

// 프로필 모달 스크립트 로드
const script = document.createElement('script');
script.src = '../js/profile_modal.js';
document.head.appendChild(script);

// 수파베이스 클라이언트 초기화 통합
const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;
const SUPABASE_STORAGE_URL = `${window.config.supabase.url}/storage/v1/object/public/uploads/`;

$(document).ready(function () {
    // ==========================================
    // 인증 및 초기 설정
    // ==========================================
    let userData = null;
    try {
        userData = JSON.parse(localStorage.getItem('dealchat_users'));
    } catch (e) {}

    if (!userData || !userData.isLoggedIn) {
        checkAuth();
        return;
    }

    const user_id = userData.id;

    updateHeaderProfile(userData);
    initUserMenu();

    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    const fromSource = urlParams.get('from');
    let isNew = companyId === 'new';

    let currentCompanyData = null;
    let availableFiles = [];
    let conversationHistory = [];
    let availableReportTypes = [];
    let currentUploadIsTraining = true;
    let currentSourceType = 'training';
    let myCompanies = []; // 내 기업 목록 (자동완성용)

    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    const $summaryText = $('#summary');
    const $industryText = $('#industry');
    const $notebookTitleText = $('#notebook-title-editor');

    // ==========================================
    // 데이터 로딩
    // ==========================================
    // [New] 내 기업 목록 로드 (자동완성용)
    async function loadMyCompanies() {
        if (!isNew) return; // 신규 작성 시에만 자동완성 필요
        try {
            const { data, error } = await _supabase
                .from('companies')
                .select('*')
                .eq('user_id', user_id)
                .is('deleted_at', null);

            if (data) {
                myCompanies = data;
                console.log('내 기업 목록 로드 완료:', myCompanies.length, '개');
            }
        } catch (err) {
            console.error('loadMyCompanies error:', err);
        }
    }

    // [New] 기업 정보 필드 채우기
    function fillCompanyFields(company) {
        if (!company) return;

        $('#notebook-title-editor').text(company.name || '');
        $('#industry').val(company.industry || '선택해주세요').trigger('change');
        if (company.industry && company.industry.startsWith('기타: ')) {
            $('#industry-other').val(company.industry.replace('기타: ', ''));
        }

        $('#ceo-name').val(company.ceo_name || '');
        $('#company-email').val(company.email || '');
        $('#establishment-date').val(company.establishment_date || '');
        $('#company-address').val(company.address || '');
        $('#summary').val(company.summary || '');
        $('#financial-analysis').val(company.financial_analysis || '');
        $('#manager-memo').val(company.manager_memo || '');

        if (company.mgmt_status) setMgmtStatusChip(company.mgmt_status);

        // 재무 정보
        $('#financial-rows').empty();
        if (company.financial_info && Array.isArray(company.financial_info)) {
            company.financial_info.forEach(f => {
                createFinancialRow(f.year, f.revenue, f.profit, f.net_profit);
            });
        }
        if ($('#financial-rows').children().length === 0) createFinancialRow();

        // 투자 정보
        $('#investment-rows').empty();
        if (company.investment_info && Array.isArray(company.investment_info)) {
            company.investment_info.forEach(i => {
                createInvestmentRow(i.year, i.stage, i.valuation, i.amount, i.investor);
            });
        }
        if ($('#investment-rows').children().length === 0) createInvestmentRow();

        autoResizeAllTextareas();
        $('#company-suggestions').hide();
    }

    async function loadCompanyData() {
        try {
            console.log('데이터 로딩 시작 (ID:', companyId, ')');
            
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
                setMgmtStatusChip('발굴 기업');
                
                // 신규 작성 시 현재 사용자 정보를 작성자(공유) 및 열람자로 표시
                const currentUser = userMap[user_id] || DEFAULT_MANAGER;
                renderUserCard($('#memo-author-card'), currentUser);
                
                $('#memo-update-date').text(`작성 일시: ${new Date().toLocaleDateString('ko-KR')}`);
                
                hideLoader();
                return;
            }

            // 기업 정보 로드
            const { data: company, error: cError } = await _supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
            if (cError) throw cError;
            if (!company) {
                alert('기업 정보를 찾을 수 없습니다.');
                location.href = './my_companies.html';
                return;
            }

            currentCompanyData = company;
            
            // UI 업데이트
            $notebookTitleText.text(company.name || '제목 없음');
            document.title = (company.name || '기업') + ' - DealBook';
            
            $summaryText.val(company.summary || '');
            $industryText.val(company.industry || '기타').trigger('change');
            if (company.industry && company.industry.startsWith('기타: ')) {
                $('#industry-other').val(company.industry.replace('기타: ', ''));
            }

            $('#ceo-name').val(company.ceo_name || '');
            $('#company-email').val(company.email || '');
            $('#establishment-date').val(company.establishment_date || '');
            $('#company-address').val(company.address || '');
            $('#financial-analysis').val(company.financial_analysis || '');
            $('#manager-memo').val(company.manager_memo || '');

            // 진행 현황 버튼 설정
            const status = company.mgmt_status || '대기';
            setMgmtStatusChip(status);

            // 재무 정보 행 생성
            $('#financial-rows').empty();
            if (company.financial_info && Array.isArray(company.financial_info)) {
                company.financial_info.forEach(f => {
                    createFinancialRow(f.year, f.revenue, f.profit, f.net_profit);
                });
            }
            if ($('#financial-rows').children().length === 0) createFinancialRow();

            // 투자 정보 행 생성
            $('#investment-rows').empty();
            if (company.investment_info && Array.isArray(company.investment_info)) {
                company.investment_info.forEach(i => {
                    createInvestmentRow(i.year, i.stage, i.valuation, i.amount, i.investor);
                });
            }
            if ($('#investment-rows').children().length === 0) createInvestmentRow();

            // 작성자/열람자 정보 반영
            const author = userMap[company.user_id] || DEFAULT_MANAGER;
            const viewer = userMap[user_id] || DEFAULT_MANAGER;
            
            renderUserCard($('#memo-author-card'), author);

            if (company.updated_at || company.created_at) {
                const date = new Date(company.updated_at || company.created_at);
                $('#memo-update-date').text(`최종 업데이트: ${date.toLocaleDateString('ko-KR')} ${date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
            }

            // 채팅 기록 로드
            if (company.history && Array.isArray(company.history)) {
                conversationHistory = company.history;
                $chatMessages.empty();
                $welcomeScreen.hide();
                conversationHistory.forEach(msg => {
                    addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                });
            }

            autoResizeAllTextareas();
            
            // 공유/조회 모드 처리
            const isOwner = company.user_id && String(company.user_id) === String(user_id);
            if (fromSource === 'totalstartup' || fromSource === 'total_companies' || fromSource === 'shared' || (!isNew && !isOwner)) {
                applyReadOnlyMode();
            }

        } catch (err) {
            console.error('Data load error:', err);
            alert('데이터를 불러오는 중 오류가 발생했습니다.');
        } finally {
            hideLoader();
        }
    }

    async function loadAvailableFiles() {
        if (isNew) return; // 신규 작성 시에는 개별 파일 로드 생략
        try {
            // 전체 공유 파일 + 내 파일
            const { data, error } = await _supabase
                .from('files')
                .select('*')
                .or(`user_id.eq.${user_id},entity_id.eq.${companyId}`);
            
            if (error) throw error;
            availableFiles = data || [];
            
            // 현재 기업에 연결된 파일들 필터링하여 리스트 렌더링
            renderCompanyFiles();
        } catch (err) {
            console.error('File load error:', err);
        }
    }

    function renderCompanyFiles() {
        $('#source-list-training').empty();
        $('#source-list-finance').empty();
        $('#source-list-non-training').empty();

        const companyFiles = availableFiles.filter(f => f.entity_id === companyId);
        
        companyFiles.forEach(file => {
            const isTraining = file.source_type === 'training' || file.source_type === 'finance';
            const isFinance = file.source_type === 'finance';
            addFileToSourceList(file.file_name, file.id, file.storage_path, isTraining, isFinance);
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

    // [New] 기업명 입력 이벤트 (자동 완성)
    $('#notebook-title-editor').on('input focus', function() {
        if (!isNew) return; // 신규 작성 시에만 제안 표시

        const query = $(this).text().trim().toLowerCase();
        const $suggestions = $('#company-suggestions');

        if (!query) {
            $suggestions.hide();
            return;
        }

        const filtered = myCompanies.filter(c => (c.name || "").toLowerCase().includes(query));

        $suggestions.empty().show();
        
        // "직접 입력" 옵션 상단 배치
        const $directItem = $(`<div style="padding: 10px 16px; cursor: pointer; border-bottom: 2px solid #f1f5f9; font-size: 13px; color: #6366f1; font-weight: 600; background: #f8fafc;">
                                <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">edit</span> 직접 입력
                             </div>`);
        $directItem.on('click', () => { $suggestions.hide(); });
        $suggestions.append($directItem);

        if (filtered.length === 0) {
            if (!query) $suggestions.hide();
            return;
        }

        filtered.forEach(c => {
            const $item = $(`<div style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; transition: background 0.2s;">
                                <div style="font-weight: 700; color: #1e293b;">${c.name}</div>
                                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${c.industry || '-'} / ${c.ceo_name || '-'}</div>
                             </div>`);
            
            $item.on('mouseenter', function() { $(this).css('background', '#f1f5f9'); });
            $item.on('mouseleave', function() { $(this).css('background', 'white'); });
            $item.on('click', () => {
                fillCompanyFields(c);
            });
            $suggestions.append($item);
        });
    });

    // 제안창 외부 클릭 시 닫기
    $(document).on('click', function(e) {
        if (!$(e.target).closest('#notebook-title-editor, #company-suggestions').length) {
            $('#company-suggestions').hide();
        }
    });

    function autoResizeTextarea($el) {
        if (!$el.length) return;
        $el.css('height', 'auto');
        $el.css('height', $el[0].scrollHeight + 'px');
    }

    function autoResizeAllTextareas() {
        autoResizeTextarea($summaryText);
        autoResizeTextarea($('#financial-analysis'));
        autoResizeTextarea($('#manager-memo'));
    }

    // 재무 정보 행 추가
    function createFinancialRow(year = '', revenue = '', profit = '', net = '') {
        const rowId = `fin-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const rowHtml = `
            <div class="financial-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; padding: 0 30px 0 12px; box-sizing: border-box; width: 100%;">
                <input type="text" class="fin-year" value="${year}" placeholder="연도"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: center; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-revenue format-number" value="${revenue}" placeholder="매출액"
                    style="flex: 2; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-profit format-number" value="${profit}" placeholder="영업이익"
                    style="flex: 2; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-net format-number" value="${net}" placeholder="순이익"
                    style="flex: 2; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #ef4444; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -24px;">
                    <span class="material-symbols-outlined" style="font-size: 18px; font-weight: bold;">remove</span>
                </button>
            </div>
        `;
        $('#financial-rows').append(rowHtml);
    }

    // 투자 정보 행 추가
    function createInvestmentRow(year = '', stage = '', valuation = '', amount = '', investor = '') {
        const stages = ['Seed', 'Pre-A', 'Series A', 'Series B', 'Series C 이상', 'M&A', 'Pre-IPO', 'IPO'];
        let stageOptions = '<option value="">단계 선택</option>';
        stages.forEach(s => {
            stageOptions += `<option value="${s}" ${stage === s ? 'selected' : ''}>${s}</option>`;
        });

        const rowId = `inv-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const rowHtml = `
            <div class="investment-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; padding: 0 30px 0 12px; box-sizing: border-box; width: 100%;">
                <input type="text" class="inv-year" value="${year}" placeholder="연도"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: center; background: #ffffff; box-sizing: border-box;">
                <select class="inv-stage"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; background: #ffffff; box-sizing: border-box;">${stageOptions}</select>
                <input type="text" class="inv-valuation format-number" value="${valuation}" placeholder="밸류"
                    style="flex: 2; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="inv-amount format-number" value="${amount}" placeholder="금액"
                    style="flex: 2; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="inv-investor" value="${investor}" placeholder="투자자"
                    style="flex: 2.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: left; background: #ffffff; box-sizing: border-box;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #ef4444; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -24px;">
                    <span class="material-symbols-outlined" style="font-size: 18px; font-weight: bold;">remove</span>
                </button>
            </div>
        `;
        $('#investment-rows').append(rowHtml);
    }

    $(document).on('click', '.btn-remove-row', function() { $(this).parent().remove(); });
    $('#add-financial-btn').on('click', () => createFinancialRow());
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
        if (!name || name === '제목 없음') { alert('기업명을 입력해주세요.'); return; }

        const industryBase = $industryText.val();
        const industry = industryBase === '기타' ? `기타: ${$('#industry-other').val()}` : industryBase;
        
        let status = $('.btn-status-chip.active').data('value');
        if (status === '기타') {
            const otherVal = $('#mgmt-status-other').val().trim();
            status = otherVal ? `기타: ${otherVal}` : '기타';
        }

        // 재무 정보 수집
        const financial_info = [];
        $('.financial-row').each(function() {
            financial_info.push({
                year: $(this).find('.fin-year').val(),
                revenue: $(this).find('.fin-revenue').val(),
                profit: $(this).find('.fin-profit').val(),
                net_profit: $(this).find('.fin-net').val()
            });
        });

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
            establishment_date: $('#establishment-date').val() || null,
            address: $('#company-address').val(),
            financial_info: financial_info,
            investment_info: investment_info,
            financial_analysis: $('#financial-analysis').val(),
            manager_memo: $('#manager-memo').val(),
            is_draft: isDraft,
            user_id: user_id,
            updated_at: new Date().toISOString()
        };

        showLoader();
        try {
            let result;
            if (isNew) {
                result = await _supabase.from('companies').insert(payload).select().single();
            } else {
                result = await _supabase.from('companies').update(payload).eq('id', companyId).select().single();
            }

            if (result.error) throw result.error;
            
            alert(isDraft ? '비공개로 저장되었습니다.' : '저장되었습니다.');
            location.href = './my_companies.html';
        } catch (err) {
            console.error('Save error:', err);
            alert('저장 중 오류가 발생했습니다.');
        } finally {
            hideLoader();
        }
    }

    $('#btn-save').on('click', () => saveCompany(false));
    $('#btn-draft').on('click', () => saveCompany(true));

    $('#btn-delete-company').on('click', async function() {
        if (!confirm('정말로 이 기업 정보를 삭제하시겠습니까?')) return;
        showLoader();
        try {
            const { error } = await _supabase.from('companies').update({ deleted_at: new Date().toISOString() }).eq('id', companyId);
            if (error) throw error;
            alert('삭제되었습니다.');
            location.href = './my_companies.html';
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
            <div class="message ${sender} mb-3 d-flex ${isAi ? '' : 'flex-row-reverse'}">
                <div class="avatar bg-${isAi ? 'light' : 'primary'} text-${isAi ? 'dark' : 'white'} rounded-circle d-flex align-items-center justify-content-center" style="width: 32px; height: 32px;">
                    <span class="material-symbols-outlined">${isAi ? 'smart_toy' : 'person'}</span>
                </div>
                <div class="message-content mx-2 p-2 rounded bg-light" style="max-width: 80%; white-space: pre-wrap;">${text}</div>
            </div>
        `;
        $chatMessages.append(msgHtml);
        if (animate) $chatMessages.scrollTop($chatMessages[0].scrollHeight);
    }

    async function sendMessage() {
        const text = $chatInput.val().trim();
        if (!text) return;
        $chatInput.val('').css('height', 'auto');
        addMessage(text, 'user');
        
        const $aiMsg = $('<div class="message ai mb-2">답변 생성 중...</div>');
        $chatMessages.append($aiMsg);

        try {
            let ragContext = "";
            if (!isNew) {
                ragContext = await searchVectorDB(text, companyId);
            }

            const context = `기업명: ${$notebookTitleText.text()}\n분야: ${$industryText.val()}\n요약: ${$summaryText.val()}\n재무분석: ${$('#financial-analysis').val()}\n참고문서:\n${ragContext}`;
            
            const response = await addAiResponse(text, context);
            const data = await response.json();
            const answer = data.answer || '죄송합니다. 답변을 생성하지 못했습니다.';
            
            $aiMsg.remove();
            addMessage(answer, 'ai');
            
            conversationHistory.push({ role: 'user', content: text });
            conversationHistory.push({ role: 'assistant', content: answer });

            if (!isNew) {
                await _supabase.from('companies').update({ history: conversationHistory }).eq('id', companyId);
            }
        } catch (err) {
            $aiMsg.text('오류가 발생했습니다.');
        }
    }

    $('#send-btn').on('click', sendMessage);
    $chatInput.on('keypress', e => { if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    // ==========================================
    // 파일 업로드 및 관리
    // ==========================================
    function addFileToSourceList(name, id, location, isTraining, isFinance) {
        let target = isFinance ? '#source-list-finance' : (isTraining ? '#source-list-training' : '#source-list-non-training');
        const fileUrl = location ? (location.startsWith('http') ? location : (SUPABASE_STORAGE_URL + location)) : '#';
        
        const item = $(`
            <li class="list-group-item d-flex align-items-center justify-content-between py-1 px-2 border-0 bg-transparent">
                <div class="d-flex align-items-center">
                    <span class="material-symbols-outlined me-2" style="font-size: 18px;">description</span>
                    <a href="${fileUrl}" target="_blank" class="text-decoration-none text-dark small text-truncate" style="max-width: 150px;">${name}</a>
                </div>
                <button class="btn btn-link text-danger p-0 delete-file" data-id="${id}"><span class="material-symbols-outlined" style="font-size: 16px;">close</span></button>
            </li>
        `);
        $(target).append(item);
    }

    $(document).on('click', '.delete-file', async function() {
        const id = $(this).data('id');
        if (!confirm('파일을 연결 해제하시겠습니까?')) return;
        try {
            await _supabase.from('files').delete().eq('id', id);
            $(this).closest('li').remove();
        } catch (e) { alert('파일 삭제 실패'); }
    });

    $('#add-source-training').on('click', () => { currentSourceType = 'training'; $('#file-upload').click(); });
    $('#add-source-finance').on('click', () => { currentSourceType = 'finance'; $('#file-upload').click(); });
    $('#add-source-non-training').on('click', () => { currentSourceType = 'non-training'; $('#file-upload').click(); });

    $('#file-upload').on('change', async function() {
        const files = this.files;
        if (!files.length) return;
        for (const file of files) {
            if (!filetypecheck(file)) continue;
            try {
                const uploadResult = await fileUpload(file, user_id, SUPABASE_ENDPOINT);
                if (uploadResult && uploadResult.key) {
                    const isTraining = currentSourceType === 'training' || currentSourceType === 'finance';
                    const isFinance = currentSourceType === 'finance';
                    
                    const { data, error } = await _supabase.from('files').insert({
                        entity_id: companyId,
                        entity_type: 'company',
                        storage_path: uploadResult.key,
                        file_name: file.name,
                        file_type: file.type.split('/')[1] || 'bin',
                        user_id: user_id,
                        source_type: currentSourceType
                    }).select().single();
                    
                    if (data) addFileToSourceList(file.name, data.id, data.storage_path, isTraining, isFinance);
                }
            } catch (err) { console.error('Upload Error:', err); }
        }
        this.value = '';
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
        console.log('Applying Professional Company Report Mode (Synced with Buyers - Blue Theme)');
        const primaryColor = '#1A73E8'; // Company Blue

        // 1. 전용 CSS 주입 (18차: 기존 스타일 복구 + 요청된 너비/테이블만 적용)
        const reportStyles = `
            :root {
                --report-primary: ${primaryColor};
                --report-bg: #ffffff;
                --report-text: #475569;
                --report-text-dark: #1e293b;
                --report-border: #e2e8f0;
                --report-table-header: #f8fafc;
            }

            body { 
                background-color: #f8fafc !important; 
                overflow-y: auto !important; 
                height: auto !important; 
            }

            .app-container { 
                background-color: #f8fafc !important; 
                display: block !important; 
                height: auto !important;
                padding: 60px 0 !important;
            }
            
            /* 리포트 카드 및 하단 버튼 규격 통합 관리 */
            .sidebar, #report-share-container {
                width: 900px !important;
                max-width: 95% !important;
                margin-left: auto !important;
                margin-right: auto !important;
                display: block !important;
                box-sizing: border-box !important;
            }

            .sidebar {
                background-color: var(--report-bg) !important;
                border: 1px solid var(--report-border) !important;
                box-shadow: 0 12px 48px rgba(0, 0, 0, 0.08) !important;
                height: auto !important;
                overflow: visible !important;
                border-radius: 20px !important;
                position: relative !important;
                z-index: 10 !important;
                flex: none !important;
            }

            /* 헤더 배너 */
            .sidebar .panel-header {
                background-color: var(--report-primary) !important;
                color: #ffffff !important;
                border-top-left-radius: 19px !important;
                border-top-right-radius: 19px !important;
                border-bottom: none !important;
                height: 65px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border: none !important;
                padding: 0 20px !important;
            }
            .sidebar .panel-header h2 { color: #ffffff !important; font-size: 16px !important; font-weight: 700 !important; }
            .sidebar .panel-header span:not(#sidebar-header-title) { display: none !important; }
            #sidebar-header-title { color: #ffffff !important; font-size: 16px !important; }
            .btn-icon-only { color: #ffffff !important; }

            /* 본문 영역 */
            .sidebar-nav {
                padding: 10px 40px 10px 40px !important;
                overflow-y: visible !important;
                max-height: none !important;
                height: auto !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 32px !important;
            }

            .sidebar-nav > div {
                margin-bottom: 0 !important;
            }

            /* 테이블 반응형 컨테이너 */
            .report-table-wrapper {
                width: 100% !important;
                overflow-x: auto !important;
                -webkit-overflow-scrolling: touch !important;
                border-radius: 0 !important;
                border: 1px solid var(--report-border) !important;
                margin-bottom: 8px !important;
            }
            .report-table-header {
                border-radius: 0 !important;
            }
            .report-table-wrapper .report-table-header,
            .report-table-wrapper .report-table-row {
                min-width: 600px !important; /* 모바일에서 겹침 방지 및 헤더-데이터 동기화 */
            }
            #investment-rows, #financial-rows {
                border: none !important; /* 상위 wrapper에서 처리 */
            }

            /* 모바일 대응 (반응형 최적화 - Edge to Edge) */
            @media (max-width: 768px) {
                .app-container {
                    padding: 0 !important;
                    background-color: #ffffff !important;
                }
                .sidebar {
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                    margin: 0 !important;
                    border-radius: 0 !important;
                    border: none !important;
                    box-shadow: none !important;
                    left: 0 !important;
                    position: relative !important;
                }
                .sidebar-nav {
                    padding: 24px 16px 40px 16px !important;
                    gap: 24px !important;
                    width: 100% !important;
                    box-sizing: border-box !important;
                }
                .sidebar .panel-header {
                    width: 100% !important;
                    min-width: 100% !important;
                    height: 55px !important;
                    border-radius: 0 !important;
                    margin: 0 !important;
                    left: 0 !important;
                    position: relative !important;
                }
                .sidebar .panel-header h2, #sidebar-header-title {
                    font-size: 15px !important;
                    width: 100% !important;
                    text-align: center !important;
                }
                .report-text-content {
                    margin-bottom: 12px !important;
                    font-size: 14px !important;
                    line-height: 1.6 !important;
                }
                
                /* 관리현황 정예화: 선택된 항목만 표시 */
                .btn-status-chip:not(.active) {
                    display: none !important;
                }
                .btn-status-chip.active {
                    margin: 0 !important;
                    padding: 8px 16px !important;
                    pointer-events: none !important;
                }

                /* 모든 피드 1단(Full Width) 고정 */
                .sidebar-nav > div[style*="display: flex"] {
                    flex-direction: column !important;
                    gap: 20px !important;
                }
                .sidebar-nav > div[style*="display: flex"] > div {
                    width: 100% !important;
                }

                /* 푸터(작성자 정보 + 업데이트) 모바일 중앙 정렬 & 스태킹 */
                #memo-user-info-section {
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: center !important;
                    text-align: center !important;
                    gap: 16px !important;
                    padding: 30px 16px !important;
                    margin-top: 20px !important;
                }
                
                /* 최종 업데이트 일시 위치 조정 (작성자 아래로) */
                #memo-update-date {
                    order: 10 !important;
                    text-align: center !important;
                    width: 100% !important;
                }
            }

            /* 버튼 호버 효과 */
            #btn-report-share-url {
                transition: all 0.2s ease-in-out !important;
            }
            #btn-report-share-url:hover {
                background-color: var(--primary-color) !important;
                color: #ffffff !important;
                border-color: var(--primary-color) !important;
                box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3) !important;
            }
            #btn-report-share-url:active {
                transform: scale(0.98) !important;
            }

            /* 에디터 문구 제거 */
            .sidebar-nav > div:first-child > p {
                display: none !important;
            }

            /* 입력 요소 비활성화 스킨 */
            input:disabled, select:disabled {
                border: none !important;
                background-color: transparent !important;
                color: var(--report-text) !important;
                opacity: 1 !important;
                -webkit-text-fill-color: var(--report-text) !important;
                cursor: default !important;
                padding-left: 0 !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                height: 42px !important;
            }
            textarea:disabled {
                display: none !important;
            }

            /* 테이블 정렬 및 가로세로 구분 보강 (17차 준수) */
            .report-table-row {
                display: flex !important;
                gap: 0 !important;
                border-bottom: 1px solid #f1f5f9 !important;
                padding: 0 !important;
                align-items: stretch !important;
            }
            .report-table-cell {
                padding: 12px 10px !important;
                font-size: 13.5px !important;
                color: var(--report-text) !important;
                border-right: 1px solid var(--report-border) !important; /* 보더 색상 통일 (#e2e8f0) */
                display: flex !important;
                align-items: center !important;
                line-height: 1.4 !important;
                box-sizing: border-box !important;
            }
            .report-table-row .report-table-cell:last-child {
                border-right: none !important;
            }
            .report-table-header {
                background: var(--report-table-header) !important;
                border-top: 1.5px solid var(--report-primary) !important;
                border-bottom: 1.5px solid var(--report-primary) !important;
                font-weight: 700 !important;
                color: var(--report-primary) !important;
            }
            .report-table-header .report-table-cell {
                border-right: 1px solid var(--report-border) !important;
                color: var(--report-primary) !important;
                justify-content: center !important;
                text-align: center !important;
                height: 45px !important;
            }
            /* 헤더 마지막 셀 보더 제거 강제 적용 */
            .report-table-header .report-table-cell:last-child {
                border-right: none !important;
            }
            .cell-center { justify-content: center !important; text-align: center !important; }
            .cell-right { justify-content: flex-end !important; text-align: right !important; padding-right: 15px !important; }
            .cell-left { justify-content: flex-start !important; text-align: left !important; padding-left: 15px !important; }

            /* 입력 요소 비활성화 스킨 */
            input:disabled, select:disabled {
                border: none !important;
                background-color: transparent !important;
                color: var(--report-text) !important;
                opacity: 1 !important;
                -webkit-text-fill-color: var(--report-text) !important;
                cursor: default !important;
                padding-left: 0 !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                height: 42px !important;
            }
            textarea:disabled { display: none !important; }

            /* 기업명 스타일 (산업 필드와 동기화) */
            #notebook-title-editor { 
                cursor: default !important;
                border: none !important;
                padding: 0 !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                color: var(--report-text) !important;
            }
            /* 기업명 래퍼 투명화 */
            .sidebar-nav div:has(> #notebook-title-editor) {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                height: 42px !important;
                display: flex !important;
                align-items: center !important;
            }

            /* 관리현황 컨테이너 투명화 */
            #mgmt-status-group {
                background: transparent !important;
                border: none !important;
                padding: 4px 0 !important;
                gap: 10px !important;
            }

            /* 라벨 강조 (Blue) */
            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-weight: 600 !important;
                font-size: 13px !important;
                margin-bottom: 6px !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }

            /* textarea 대신 div 변환 텍스트 (투명으로 복구) */
            .report-text-content {
                background: transparent;
                border: none;
                padding: 0;
                font-size: 14px;
                color: var(--report-text);
                line-height: 1.6;
                white-space: pre-wrap;
                word-break: break-word;
                margin-bottom: 24px;
            }

            /* 작성자 카드 강조 (전문 리포트용) */
            #memo-user-info-section {
                margin-bottom: 0 !important;
            }
            .user-profile-card-oval {
                padding: 4px 12px 4px 4px !important;
                border-radius: 30px !important;
                transition: all 0.2s !important;
                cursor: pointer !important;
            }
            .user-profile-card-oval:hover {
                background: var(--report-primary) !important;
                border-color: var(--report-primary) !important;
                transform: translateY(-1px) !important;
                box-shadow: 0 6px 16px rgba(26, 115, 232, 0.25) !important;
            }
            .user-profile-card-oval:hover span {
                color: #ffffff !important;
            }
            .user-profile-card-oval:hover img {
                border-color: rgba(255,255,255,0.4) !important;
            }

            /* 칩 상태 비활성화 */
            .btn-status-chip.active {
                background: var(--report-primary) !important;
                color: white !important;
                border-color: var(--report-primary) !important;
                box-shadow: 0 4px 10px rgba(26, 115, 232, 0.25) !important;
            }

            /* 불필요한 에디터 요소 숨기기 */
            .main-content, #guide-panel, .right-panel, .panel-resize-handle,
            #ai-auto-fill-btn, .top-actions button,
            #btn-save, #btn-draft, #btn-delete-company,
            #add-financial-btn, #add-investment-btn,
            .btn-remove-row, .delete-file, .btn-icon-only:not([onclick*="location.href"]),
            #investment-section div[style*="background: #f1f5f9"],
            #financial-section div[style*="background: #f1f5f9"],
            .investment-row, .financial-row,
            .sidebar > div:last-child {
                display: none !important;
            }

            /* 워터마크 */
            #report-watermark {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 100px; font-weight: 900; color: var(--report-primary); opacity: 0.03;
                pointer-events: none; z-index: 9999; letter-spacing: 12px;
            }

            /* 공유 토스트 알림 */
            #share-toast {
                display: none;
                position: fixed;
                bottom: 40px;
                left: 50%;
                transform: translateX(-50%);
                background-color: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 15px;
                font-weight: 500;
                z-index: 10000;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                align-items: center;
                gap: 8px;
            }
            #share-toast .material-symbols-outlined {
                font-size: 20px;
                color: #10b981; /* Green checkmark */
            }
            
            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;

        if (!$('#report-mode-css').length) {
            $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        }
        
        // 2. 워터마크 추가
        if (!$('#report-watermark').length) {
            $('<div id="report-watermark">DealChat</div>').appendTo('body');
        }

        // 3. 테이블 정밀 보정 (17차 유지)
        reformatReportTables();

        // 4. 필드 레이블에 아이콘 주입
        injectReportIcons();

        // 5. 기능 제한 및 텍스트 변환
        $('#notebook-title-editor').attr('contenteditable', 'false');
        $('#notebook-title-editor').parent().css({ 'background': 'transparent', 'border': 'none', 'padding': '0', 'height': '42px', 'display': 'flex', 'align-items': 'center' });
        $('input, select, textarea').prop('disabled', true);

        // textarea -> div 변환
        ['#summary', '#financial-analysis', '#manager-memo'].forEach(function(sel) {
            const $ta = $(sel);
            if (!$ta.length) return;
            const content = $ta.val() || '';
            let $div = $ta.next('.report-text-content');
            if (!$div.length) {
                $div = $('<div class="report-text-content">');
                $ta.after($div).hide();
            }
            $div.text(content);
        });

        // 산업 분야 텍스트화
        const $indSelect = $('#industry');
        const $indOther = $('#industry-other');
        let industryText = $indSelect.val() === '기타' ? $indOther.val().trim() : $indSelect.find('option:selected').text();
        if (!industryText || industryText === '선택해주세요') industryText = '-';

        let $indDiv = $indSelect.next('.report-text-content-industry');
        if (!$indDiv.length) {
            $indDiv = $('<div class="report-text-content-industry report-text-content" style="background: transparent; border: none; padding: 0; margin-bottom: 0;">');
            $indSelect.after($indDiv);
        }
        $indDiv.text(industryText).css({ 'margin-top': '0', 'height': '42px', 'display': 'flex', 'align-items': 'center' });
        $indSelect.hide();
        $indOther.hide();

            // (삭제됨: 기업 정보 URL 공유하기 버튼 로직)

            // (삭제됨: URL 복사 이벤트 핸들러)

        $('#sidebar-header-title').text('기업 정보');
        document.title = (currentCompanyData?.name || '기업') + ' 리포트 - DealChat';
    }

    function injectReportIcons() {
        const sections = [
            { id: 'mgmt-status-group', label: '진행 상황', icon: 'account_tree' },
            { id: 'summary', parent: true, label: '상세 소개 및 요약', icon: 'description' },
            { id: 'investment-section', label: '투자 정보', icon: 'payments' },
            { id: 'financial-section', label: '재무 정보', icon: 'analytics' },
            { id: 'financial-analysis', parent: true, label: '재무 분석', icon: 'query_stats' },
            { id: 'manager-memo', parent: true, label: '담당자 의견', icon: 'chat_bubble' }
        ];

        sections.forEach(sec => {
            let $p;
            const $el = $(`#${sec.id}`);
            if (!$el.length) return;

            // 라벨(p태그) 찾기: 바로 앞 형제거나, 부모의 형제거나, 부모 안의 첫번째 p거나
            $p = $el.prev('p');
            if (!$p.length) $p = $el.parent().prev('p');
            if (!$p.length) $p = $el.closest('div').find('p').first();
            if (!$p.length && sec.parent) $p = $el.closest('div').parent().find('p').first();

            if ($p.length) {
                $p.find('span.material-symbols-outlined').remove(); // 중복 방지
                $p.prepend(`<span class="material-symbols-outlined" style="font-size: 18px;">${sec.icon}</span>`);
            }
        });
    }

    // 테이블 레이아웃 정교화
    function reformatReportTables() {
        // 투자 정보 테이블
        const $invRows = $('#investment-rows');
        if ($invRows.length && !$invRows.parent('.report-table-wrapper').length) {
            // 1. 데이터 먼저 수집
            const invData = [];
            $invRows.find('.investment-row').each(function() {
                const stageText = $(this).find('.inv-stage option:selected').text();
                invData.push({
                    year:      $(this).find('.inv-year').val() || '-',
                    stage:     (stageText === '단계 선택' || !stageText) ? '-' : stageText,
                    valuation: $(this).find('.inv-valuation').val() || '-',
                    amount:    $(this).find('.inv-amount').val() || '-',
                    investor:  $(this).find('.inv-investor').val() || '-'
                });
            });

            // 2. 헤더 생성 및 래퍼 구성
            const headerHtml = `
                <div class="report-table-row report-table-header">
                    <div class="report-table-cell" style="flex: 1;">년도</div>
                    <div class="report-table-cell" style="flex: 1.5;">단계</div>
                    <div class="report-table-cell" style="flex: 2;">벨류(원)</div>
                    <div class="report-table-cell" style="flex: 2;">금액(원)</div>
                    <div class="report-table-cell" style="flex: 2.5;">투자자</div>
                </div>
            `;
            $invRows.before(headerHtml);
            const $invHeader = $invRows.prev('.report-table-header');
            const $invWrapper = $('<div class="report-table-wrapper">');
            $invHeader.before($invWrapper);
            $invWrapper.append($invHeader).append($invRows);

            // 3. 컨테이너 내용을 div 행으로 완전 교체
            let invRowsHtml = '';
            invData.forEach(function(d) {
                invRowsHtml += `
                    <div class="report-table-row">
                        <div class="report-table-cell cell-center" style="flex: 1;">${d.year}</div>
                        <div class="report-table-cell cell-center" style="flex: 1.5;">${d.stage}</div>
                        <div class="report-table-cell cell-right"  style="flex: 2;">${d.valuation}</div>
                        <div class="report-table-cell cell-right"  style="flex: 2;">${d.amount}</div>
                        <div class="report-table-cell cell-center"  style="flex: 2.5;">${d.investor}</div>
                    </div>
                `;
            });
            $invRows.html(invRowsHtml);
        }

        // 재무 정보 테이블
        const $finRows = $('#financial-rows');
        if ($finRows.length && !$finRows.parent('.report-table-wrapper').length) {
            // 1. 데이터 먼저 수집
            const finData = [];
            $finRows.find('.financial-row').each(function() {
                finData.push({
                    year:    $(this).find('.fin-year').val() || '-',
                    revenue: $(this).find('.fin-revenue').val() || '-',
                    profit:  $(this).find('.fin-profit').val() || '-',
                    net:     $(this).find('.fin-net').val() || '-'
                });
            });

            // 2. 헤더 생성 및 래퍼 구성
            const headerHtml = `
                <div class="report-table-row report-table-header">
                    <div class="report-table-cell" style="flex: 1;">년도</div>
                    <div class="report-table-cell" style="flex: 2;">매출액(원)</div>
                    <div class="report-table-cell" style="flex: 2;">영업이익(원)</div>
                    <div class="report-table-cell" style="flex: 2;">당기순익(원)</div>
                </div>
            `;
            $finRows.before(headerHtml);
            const $finHeader = $finRows.prev('.report-table-header');
            const $finWrapper = $('<div class="report-table-wrapper">');
            $finHeader.before($finWrapper);
            $finWrapper.append($finHeader).append($finRows);

            // 3. 컨테이너 내용을 div 행으로 완전 교체
            let finRowsHtml = '';
            finData.forEach(function(d) {
                finRowsHtml += `
                    <div class="report-table-row">
                        <div class="report-table-cell cell-center" style="flex: 1;">${d.year}</div>
                        <div class="report-table-cell cell-right"  style="flex: 2;">${d.revenue}</div>
                        <div class="report-table-cell cell-right"  style="flex: 2;">${d.profit}</div>
                        <div class="report-table-cell cell-right"  style="flex: 2;">${d.net}</div>
                    </div>
                `;
            });
            $finRows.html(finRowsHtml);
        }
    }

    // 초기 데이터 로드 시작
    loadMyCompanies();
});
