import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import * as sharingUtils from './sharing_utils.js';

// 프로필 모달 스크립트 로드
const script = document.createElement('script');
script.src = '../js/profile_modal.js';
document.head.appendChild(script);
import { APIcall } from './APIcallFunction.js';

// 수파베이스 클라이언트 초기화 통합
const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;
let currentBuyerData = null;
let userOwnedCompanies = []; // 본인 소유 기업 목록 (추천용)

$(document).ready(function () {
    const urlParams = new URLSearchParams(window.location.search);
    const buyerId = urlParams.get('id');
    const fromSource = urlParams.get('from');

    let userData = null;
    try {
        userData = JSON.parse(localStorage.getItem('dealchat_users'));
    } catch (e) {}

    // 비회원 & 외부 공유 링크인 경우 예외 허용
    if (!userData || !userData.isLoggedIn) {
        if (fromSource === 'shared' && buyerId) {
            console.log('Non-member accessing shared buyer report');
        } else {
            checkAuth(); // 로그인 페이지로 리다이렉트
            return;
        }
    } else {
        updateHeaderProfile(userData);
        initUserMenu();
    }

    const currentuser_id = userData ? userData.id : null;

    // 초기 설정
    if (buyerId && buyerId !== 'new') {
        // NDA 체크 (보고서 모드일 때만)
        if (fromSource === 'totalbuyer' || fromSource === 'total_buyers' || fromSource === 'shared') {
            loadBuyerData(buyerId, true); // true means check NDA
        } else {
            loadBuyerData(buyerId, false);
        }
    } else {
        // 새 바이어 등록
        $('#buyer-name-editor').attr('placeholder', '바이어명 (신규)');
        
        // 작성자 본인 정보 초기 설정 (로그인한 경우만)
        if (userData) {
            $('#memo-author-name').text(userData.name || '');
            $('#memo-author-company').text(userData.company || 'DealChat');
            $('#memo-author-affiliation').text(userData.department || userData.affiliation || '-');
            $('#memo-author-email').text(userData.email || '');
            $('#memo-author-avatar').attr('src', resolveAvatarUrl(userData.avatar || userData.avatar_url, 1));

            // 작성자 정보 클릭 연동 — 이메일 복사
            $('#memo-author-info-box').css('cursor', 'pointer').off('click').on('click', function() {
                const email = userData.email;
                if (email) {
                    navigator.clipboard.writeText(email).then(() => {
                        const $toast = $('#share-toast');
                        if ($toast.length) {
                            $toast.find('span').text('check_circle');
                            $toast.contents().last()[0].textContent = ' 담당자 이메일이 복사되었습니다.';
                            $toast.css('display', 'flex').hide().fadeIn(200).delay(2000).fadeOut(400);
                        } else {
                            alert('담당자 이메일이 복사되었습니다: ' + email);
                        }
                    }).catch(err => console.error('Email copy failed:', err));
                }
            });
            $('#memo-author-info-box').attr('title', '작성자의 이메일을 복사합니다.');
            $('#memo-author-name').css('color', '#000000').css('font-weight', '700');
        }

        switchMode('edit');
        setBuyerStatusChip('대기');
    }

    // ==========================================
    // [New] 기업명 추천 드롭다운 로직 (이전 제작됨)
    // ==========================================

    /**
     * 사용자가 '내 기업(my_companies)'에 등록한 데이터를 가져옵니다.
     */
    function loadUserCompanies() {
        console.log('입력 추천용 내 기업 목록 불러오는 중... (ID:', currentuser_id, ')');
        APIcall({ 
            action: 'get', 
            table: 'companies', 
            user_id: currentuser_id 
        }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(r => r.json())
        .then(data => {
            if (data && !data.error) {
                userOwnedCompanies = Array.isArray(data) ? data : [];
                console.log('내 추천용 기업 목록 로드 완료:', userOwnedCompanies.length, '개');
            } else {
                console.warn('내 기업 목록 로드 실패:', data?.error || 'Unknown Error');
                userOwnedCompanies = [];
            }
        })
        .catch(err => {
            console.error('내 기업 목록 API 호출 에러:', err);
            userOwnedCompanies = [];
        });
    }

    // 페이지 로드 시 즉시 데이터 확보
    loadUserCompanies();

    /**
     * 기업 선택 시 해당 기업의 주요 정보를 바이어 필드에 자동 매핑합니다.
     */
    function selectCompanyForBuyer(company) {
        if (!company) return;
        
        // 1. 기업명 입력
        const cName = company.name || company.company_name || company.companyName || "";
        $('#buyer-name-editor').text(cName);
        
        // 2. 산업군(industry)
        if (company.industry) {
            $('#buyer-industry').val(company.industry);
            if (company.industry === '기타') $('#buyer-industry-etc').show();
            else $('#buyer-industry-etc').hide();
        }

        // 3. 담당자/이메일 (ceo_name, email 등)
        $('#buyer-manager').val(company.ceo_name || company.ceoName || "");
        $('#buyer-email').val(company.email || company.companyEmail || "");

        // 4. 회사 요약 및 메모 (summary, manager_memo 등)
        let mainSummary = company.summary || "";
        if (mainSummary.includes('[상세 정보]')) {
            mainSummary = mainSummary.split('[상세 정보]')[0].trim();
        }
        $('#buyer-summary').val(mainSummary);
        $('#buyer-memo').val(company.manager_memo || company.managerMemo || "");

        // 제목 업데이트
        document.title = `${cName} - 바이어 정보`;
        $('#sidebar-header-title').text(cName);

        $('#buyer-company-suggestions').hide().empty();
    }

    // 이름 입력란 이벤트 핸들러
    $('#buyer-name-editor').on('input focus', function() {
        const $this = $(this);
        const name = $this.text().trim();
        const $sList = $('#buyer-company-suggestions');

        // 제목 동기화
        const titleName = name || '바이어 정보';
        document.title = `${titleName} - DealChat`;
        $('#sidebar-header-title').text(titleName);

        if (!name) { 
            $sList.hide().empty(); 
            return; 
        }

        const query = name.toLowerCase();
        // 내가 올린 기업들 중 쿼리가 이름에 포함된 기업만 필터링
        const matches = userOwnedCompanies.filter(c => {
            const compName = (c.name || c.company_name || c.companyName || "").toLowerCase();
            return compName.includes(query);
        });

        if (matches.length === 0) {
            $sList.hide().empty();
            return;
        }

        // 목록 생성 및 노출
        $sList.empty();
        matches.forEach(c => {
            const cName = c.name || c.company_name || c.companyName || "";
            const cInd = c.industry || "기타";
            const $item = $(`
                <div class="suggestion-item" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f8fafc; transition: background 0.2s;">
                    <div style="font-weight: 700; color: #1e293b; font-size: 13.5px;">${cName}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${cInd}</div>
                </div>
            `);
            $item.on('mouseenter', function() { $(this).css('background', '#f1f5f9'); });
            $item.on('mouseleave', function() { $(this).css('background', 'white'); });
            $item.on('mousedown', (e) => { 
                e.preventDefault(); // focus 유실 방지
                selectCompanyForBuyer(c); 
            });
            $sList.append($item);
        });
        $sList.show();
    });

    // 외부 클릭 시 닫기
    $(document).on('mousedown', function(e) {
        if (!$(e.target).closest('#buyer-name-editor, #buyer-company-suggestions').length) {
            $('#buyer-company-suggestions').hide();
        }
    });

    // [New End]

    function switchMode(mode) {
        if (mode === 'read') {
            applyBuyerReadOnlyMode();
        } else {
            // 편집 모드는 기본 3창 패널 레이아웃 유지
            $('#report-mode-css').remove();
            $('#report-watermark').remove();
            $('body').css('overflow', 'hidden');
            $('.sidebar').show();
            $('.main-content').show();
            $('.right-panel').show();
            $('input, select, textarea').prop('disabled', false);
            $('#buyer-name-editor').attr('contenteditable', 'true');
        }
    }

    // ==========================================
    // UI 헬퍼 함수 (Companies와 설계 통일)
    // ==========================================
    function setBuyerStatusChip(value) {
        $('.btn-status-chip').removeClass('active');
        if (!value) return;
        
        const targetValue = value.replace(/\s+/g, '');
        $('.btn-status-chip').each(function() {
            const chipValue = ($(this).data('value') || "").replace(/\s+/g, '');
            if (chipValue === targetValue) {
                $(this).addClass('active');
            }
        });
        $('#buyer-status').val(value);
    }

    $(document).on('click', '.btn-status-chip', function() {
        if ($('#report-mode-css').length) return; // 읽기 모드에선 작동 금지
        setBuyerStatusChip($(this).data('value'));
    });

    // 데이터 로드
    async function loadBuyerData(id, checkNda = false) {
        if (typeof showLoader === 'function') showLoader();
        try {
            // [1] NDA 체결 여부 확인
            let isSigned = false;
            if (userData && userData.isLoggedIn) {
                // 1. Supabase에서 서명 이력이 있는지 확인
                const { data: ndaData } = await _supabase
                    .from('nda_logs')
                    .select('id')
                    .eq('user_id', userData.id)
                    .eq('item_id', id)
                    .maybeSingle();

                // 2. 로컬 스토리지에서 서명 이력이 있는지 확인 (비회원 폴백)
                const localSigned = getSignedNdas();
                isSigned = !!ndaData || localSigned.includes(String(id));
            }

            // [2] 데이터 조회
            const { data: item, error } = await _supabase
                .from('buyers')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (error || !item) {
                alert('바이어 정보를 찾을 수 없거나 접근 권한이 없습니다.');
                location.href = './my_buyers.html';
                return;
            }

            const isOwner = userData && String(item.user_id) === String(userData.id);
            const ndaRequired = !isOwner && !isSigned;

            if (ndaRequired) {
                showNdaGate(id, item.company_name || '비공개 바이어');
            } else {
                currentBuyerData = item;
                bindBuyerData(item);
                // 열람 이력 업데이트 (회원인 경우만)
                if (userData && !isOwner && isSigned) {
                    await _supabase.from('nda_logs').update({ updated_at: new Date().toISOString() }).match({ user_id: userData.id, item_id: id });
                }

                if (fromSource === 'totalbuyer' || fromSource === 'total_buyers' || fromSource === 'shared' || !isOwner) {
                    switchMode('read');
                } else {
                    switchMode('edit');
                }
            }
        } catch (err) {
            console.error("Load buyer error:", err);
            alert('데이터 로드 중 오류가 발생했습니다.');
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }
    }

    function bindBuyerData(item) {
        // 데이터 바인딩
        $('#buyer-name-editor').text(item.company_name || item.companyName || '');
        $('#buyer-manager').val(item.manager_name || item.manager || '');
        $('#buyer-email').val(item.email || '');
        $('#buyer-industry').val(item.interest_industry || item.industry || '선택해주세요');
        $('#buyer-investment').val(item.available_funds || item.investment_amount || '');
        $('#buyer-status').val(item.status || '대기');
        $('#buyer-summary').val(item.summary || '');
        $('#buyer-interest-summary').val(item.interest_summary || '');
        $('#buyer-memo').val(item.memo || item.manager_memo || item.etc || '');

        // 상태 칩
        $('.btn-status-chip').removeClass('active');
        $(`.btn-status-chip[data-value="${item.status || '대기'}"]`).addClass('active');

        // 작성자 정보 및 날짜 로드
        const authorId = item.user_id;
        if (authorId) {
            fetchAuthorInfo(authorId);
        } else if (userData) {
            // user_id 없을 때 현재 로그인 사용자로 폴백
            $('#memo-author-name').text(userData.name || DEFAULT_MANAGER.name);
            $('#memo-author-company').text(userData.company || 'DealChat');
            $('#memo-author-affiliation').text(userData.department || userData.affiliation || '-');
            $('#memo-author-email').text(userData.email || '');
            $('#memo-author-avatar').attr('src', resolveAvatarUrl(userData.avatar || userData.avatar_url, 1));
            $('#memo-author-name').css('color', '#000000').css('font-weight', '700');
        }
        
        if (item.updated_at) {
            const date = new Date(item.updated_at);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? '오후' : '오전';
            const hours12 = hours % 12 || 12;
            $('#memo-update-date').text(`최종 수정: ${year}. ${month}. ${day}. ${ampm} ${hours12}:${minutes}`);
        }
    }

    async function fetchAuthorInfo(uId) {
        if (!uId) return;
        try {
            const { data, error } = await _supabase.from('users').select('*').eq('id', uId).maybeSingle();
            const author = data || DEFAULT_MANAGER;
            if (author) {
                $('#memo-author-name').text(author.name || DEFAULT_MANAGER.name);
                $('#memo-author-company').text(author.company || author.company_name || 'DealChat');
                $('#memo-author-affiliation').text(author.department || author.affiliation || '-');
                $('#memo-author-email').text(author.email || '');
                $('#memo-author-avatar').attr('src', resolveAvatarUrl(author.avatar_url || author.avatar, 1));
                
                // 작성자 정보 클릭 연동 — 이메일 복사
                $('#memo-author-info-box').css('cursor', 'pointer').off('click').on('click', function() {
                    const email = author.email;
                    if (email) {
                        navigator.clipboard.writeText(email).then(() => {
                            const $toast = $('#share-toast');
                            if ($toast.length) {
                                $toast.find('span').text('check_circle');
                                $toast.contents().last()[0].textContent = ' 담당자 이메일이 복사되었습니다.';
                                $toast.css('display', 'flex').hide().fadeIn(200).delay(2000).fadeOut(400);
                            } else {
                                alert('담당자 이메일이 복사되었습니다: ' + email);
                            }
                        }).catch(err => console.error('Email copy failed:', err));
                    }
                });
                $('#memo-author-info-box').attr('title', '작성자의 이메일을 복사합니다.');
                $('#memo-author-name').css('color', '#000000').css('font-weight', '700');
            }
        } catch (e) {
            console.error("Author fetch error:", e);
        }
    }

    // 산업 선택 변경 (기타 선택 시 입력창 노출)
    $('#buyer-industry').on('change', function() {
        if ($(this).val() === '기타') {
            $('#buyer-industry-etc').show().focus();
        } else {
            $('#buyer-industry-etc').hide();
        }
    });

    // 저장 (전체 공개)
    $('#btn-save-buyer').on('click', () => saveBuyerData('public'));
    $('#btn-draft-buyer').on('click', () => saveBuyerData('private'));

    // 삭제하기
    $('#btn-delete-buyer').on('click', async function() {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        
        if (buyerId === 'new') {
            location.href = './my_buyers.html';
            return;
        }

        if (typeof showLoader === 'function') showLoader();
        try {
            const { error } = await _supabase.from('buyers').delete().eq('id', buyerId);
            if (error) throw error;
            alert('삭제되었습니다.');
            location.href = './my_buyers.html';
        } catch (err) {
            console.error("Delete buyer error:", err);
            alert('삭제 중 오류가 발생했습니다.');
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }
    });

    async function saveBuyerData(shareType) {
        const name = $('#buyer-name-editor').text().trim();
        if (!name || name === '바이어명' || name === '바이어명 (신규)') {
            alert('바이어명을 입력해주세요.');
            return;
        }

        const industryVal = $('#buyer-industry').val();
        const industryFinal = (industryVal === '기타' && $('#buyer-industry-etc').val().trim()) 
                               ? $('#buyer-industry-etc').val().trim() 
                               : industryVal;

        const payload = {
            company_name: name, 
            interest_industry: industryFinal,
            status: $('#buyer-status').val() || '대기',
            summary: $('#buyer-summary').val(),
            interest_summary: $('#buyer-interest-summary').val(),
            manager_name: $('#buyer-manager').val(),
            email: $('#buyer-email').val(),
            available_funds: parseFloat($('#buyer-investment').val().replace(/,/g, '')) || null,
            memo: $('#buyer-memo').val() || "", 
            user_id: userData?.id || null,
            is_draft: shareType === 'private'
        };

        if (buyerId === 'new') {
            payload.created_at = new Date().toISOString();
        }

        console.log('Saving buyer data (Payload):', payload);

        if (typeof showLoader === 'function') showLoader();
        try {
            let result;
            if (buyerId === 'new') {
                result = await _supabase.from('buyers').insert(payload).select().single();
            } else {
                result = await _supabase.from('buyers').update(payload).eq('id', buyerId).select().single();
            }

            if (result.error) {
                console.error("Supabase API Error:", result.error);
                throw result.error;
            }
            
            alert(shareType === 'private' ? '비공개로 저장되었습니다.' : '저장되었습니다.');
            location.href = './my_buyers.html';
        } catch (err) {
            console.error("Full Save Error Object:", err);
            alert('저장 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }
    }

    // 전문 리포트 모드 (Companies 디자인과 완전 동기화)
    function applyBuyerReadOnlyMode() {
        console.log('Applying Professional Buyer Report Mode (Mobile Optimized - Teal Theme)');
        const primaryColor = '#0d9488'; // Buyer Teal

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
                box-shadow: 0 12px 48px rgba(13, 148, 136, 0.08) !important;
                height: auto !important;
                overflow: visible !important;
                border-radius: 20px !important;
                position: relative !important;
                z-index: 10 !important;
                flex: none !important;
                transition: none !important;
            }

            #report-share-container {
                margin-top: 24px !important;
                margin-bottom: 60px !important;
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
                padding: 10px 40px 40px 40px !important;
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

                /* 선택된 상태 칩만 표시 */
                .btn-status-chip:not(.active) { display: none !important; }
                .btn-status-chip.active { margin: 0 !important; padding: 8px 16px !important; pointer-events: none !important; }

                /* 모든 섹션 1단 고정 */
                .sidebar-nav > div[style*="display: flex"] { flex-direction: column !important; gap: 20px !important; }
                .sidebar-nav > div[style*="display: flex"] > div { width: 100% !important; }

                /* 푸터 모바일 중앙 정렬 */
                #memo-author-info {
                    flex-direction: column !important;
                    align-items: center !important;
                    text-align: center !important;
                    gap: 16px !important;
                    padding-bottom: 20px !important;
                }
                #memo-update-date { order: 2 !important; margin-top: 8px !important; }
            }

            /* 라벨 스타일 */
            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-weight: 600 !important;
                font-size: 13px !important;
                margin-bottom: 6px !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }

            /* 텍스트 내용 스타일 */
            .report-text-content {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                font-size: 14px !important;
                color: var(--report-text) !important;
                line-height: 1.6 !important;
                white-space: pre-wrap !important;
                word-break: break-word !important;
                margin-bottom: 0 !important;
            }

            /* 비활성화 요소 스킨 */
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

            /* 기업명 스타일 (sellers 동기화) */
            #buyer-name-editor {
                cursor: default !important;
                border: none !important;
                padding: 0 !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                color: var(--report-text) !important;
            }

            /* 기업명 래퍼 투명화 */
            .sidebar-nav div:has(> #buyer-name-editor) {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                height: 42px !important;
                display: flex !important;
                align-items: center !important;
            }

            /* 진행현황 컨테이너 투명화 */
            #status-chip-group {
                background: transparent !important;
                border: none !important;
                padding: 4px 0 !important;
                gap: 10px !important;
            }

            /* 칩 상태 비활성화 */
            .btn-status-chip.active {
                background: var(--report-primary) !important;
                color: white !important;
                border-color: var(--report-primary) !important;
                box-shadow: 0 4px 10px rgba(13, 148, 136, 0.25) !important;
            }

            /* 워터마크 */
            #report-watermark {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 100px; font-weight: 900; color: var(--report-primary); opacity: 0.03;
                pointer-events: none; z-index: 9999; letter-spacing: 12px;
            }

            /* 공유 토스트 알림 */
            #share-toast {
                display: none; position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
                background-color: rgba(0, 0, 0, 0.8); color: #fff; padding: 12px 24px; border-radius: 8px;
                font-size: 15px; font-weight: 500; z-index: 10000; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                align-items: center; gap: 8px;
            }
            #share-toast .material-symbols-outlined { font-size: 20px; color: #10b981; }

            /* 불필요한 에디터 요소 숨기기 */
            .main-content, #guide-panel, .right-panel, .panel-resize-handle,
            #ai-auto-fill-btn, #btn-save-buyer, #btn-draft-buyer, #btn-delete-buyer,
            .btn-icon-only:not([onclick*="location.href"]),
            #buyer-industry-etc,
            .sidebar > div:last-child {
                display: none !important;
            }

            /* AI 자동입력: 컨테이너 div는 유지(flex gap 확보), 내부 요소만 숨기기 */
            .sidebar-nav > div:first-child > p {
                display: none !important;
            }

            /* 하단 작성자 카드 — 기업 레퍼런스 스타일 동기화 */
            #memo-author-info {
                border-top: 1px solid #f1f5f9 !important;
                margin-top: 32px !important;
                padding-top: 24px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
            }
            #memo-author-info-box {
                padding: 4px 12px 4px 4px !important;
                border-radius: 30px !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important;
                transition: all 0.2s !important;
                cursor: pointer !important;
            }
            #memo-author-info-box:hover {
                background: var(--report-primary) !important;
                border-color: var(--report-primary) !important;
                transform: translateY(-1px) !important;
                box-shadow: 0 6px 16px rgba(13, 148, 136, 0.25) !important;
            }
            #memo-author-info-box:hover span {
                color: #ffffff !important;
            }
            #memo-author-info-box:hover img {
                border-color: rgba(255,255,255,0.4) !important;
            }
            #memo-author-avatar {
                width: 36px !important;
                height: 36px !important;
            }
            #memo-update-date {
                margin-top: 0 !important;
            }

            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;


        if (!$('#report-mode-css').length) $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        if (!$('#report-watermark').length) $('<div id="report-watermark">DealChat</div>').appendTo('body');
        if (!$('#share-toast').length) $('<div id="share-toast"><span class="material-symbols-outlined">check_circle</span> 클립보드에 복사 완료!</div>').appendTo('body');

        // 필드 아이콘 주입
        injectBuyerReportIcons();

        // 텍스트 변환
        ['#buyer-summary', '#buyer-interest-summary', '#buyer-memo'].forEach(sel => {
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

        // 기업명/산업/투자금액 필드
        $('#buyer-name-editor').attr('contenteditable', 'false');
        $('#buyer-name-editor').parent().css({ 'background': 'transparent', 'border': 'none', 'padding': '0', 'height': '42px', 'display': 'flex', 'align-items': 'center', 'box-shadow': 'none' });

        const $indSelect = $('#buyer-industry');
        let industryText = $indSelect.val() === '기타' ? $('#buyer-industry-etc').val() : $indSelect.find('option:selected').text();
        if (!industryText || industryText === '선택해주세요') industryText = '-';
        if (!$indSelect.next('.report-text-field').length) $('<div class="report-text-field" style="font-size:14.5px; color:var(--report-text); font-weight:500; height:42px; display:flex; align-items:center;">').insertAfter($indSelect).text(industryText);
        $indSelect.hide();

        const $invInput = $('#buyer-investment');
        if (!$invInput.next('.report-text-field').length) {
            const val = $invInput.val() ? `${$invInput.val()} 억원` : '-';
            $('<div class="report-text-field" style="font-size:14.5px; color:var(--report-text); font-weight:500; height:42px; display:flex; align-items:center;">').insertAfter($invInput).text(val);
        }
        $invInput.hide();

        // 관리현황 투명화
        $('#status-chip-group').css({ 'background': 'transparent', 'border': 'none', 'padding': '4px 0' });

        // 편집 요소 비활성화 (sellers 동기화)
        $('input:not(#nda-modal *), select:not(#nda-modal *), textarea:not(#nda-modal *)').prop('disabled', true);

        $('#sidebar-header-title').text('바이어 정보');
        document.title = (currentBuyerData?.company_name || '바이어') + ' 리포트 - DealChat';
    }


    function injectBuyerReportIcons() {
        // 섹션 단위 라벨에만 아이콘 주입 (기업 레퍼런스와 동일)
        // 필드 단위(기업명, 산업, 담당자, 가용자금 등)는 아이콘 미사용
        const sections = [
            { id: 'status-chip-group',       icon: 'account_tree' },
            { id: 'buyer-summary',           icon: 'description'  },
            { id: 'buyer-interest-summary',  icon: 'ads_click'    },
            { id: 'buyer-memo',              icon: 'chat_bubble'  }
        ];

        sections.forEach(sec => {
            const $el = $(`#${sec.id}`);
            if (!$el.length) return;
            let $p = $el.prev('p');
            if (!$p.length) $p = $el.parent().prev('p');
            if (!$p.length) $p = $el.closest('div').find('p').first();
            if ($p.length) {
                $p.find('span.material-symbols-outlined').remove();
                $p.prepend(`<span class="material-symbols-outlined" style="font-size: 18px;">${sec.icon === 'target' ? 'ads_click' : sec.icon}</span>`);
            }
        });
    }

    function getSignedNdas() {
        try {
            const userId = userData ? userData.id : 'anonymous';
            const signed = localStorage.getItem(`dealchat_signed_ndas_buyers_${userId}`);
            return signed ? JSON.parse(signed) : [];
        } catch (e) { return []; }
    }
    function saveSignedNda(id) {
        const list = getSignedNdas();
        const strId = String(id);
        if (!list.includes(strId)) {
            list.push(strId);
            const userId = userData ? userData.id : 'anonymous';
            localStorage.setItem(`dealchat_signed_ndas_buyers_${userId}`, JSON.stringify(list));
        }
    }

    function showNdaGate(id, companyName) {
        // NDA 모달 표시 로직
        const currentUserName = userData?.name || userData?.email?.split('@')[0] || '사용자';
        let guestName = null; // [New] 외부 공유 시 수신자 이름 저장
        $('#logged-in-user-name').text(currentUserName);
        
        const ndaModalEl = document.getElementById('nda-modal');
        const ndaModal = bootstrap.Modal.getOrCreateInstance(ndaModalEl, {
            backdrop: 'static',
            keyboard: false
        });

        // NDA 전용 블랙 배경 토글
        ndaModalEl.addEventListener('show.bs.modal', function () {
            setTimeout(() => { $('.modal-backdrop').addClass('nda-backdrop'); }, 0);
        });
        ndaModalEl.addEventListener('hidden.bs.modal', function () {
            $('.modal-backdrop').removeClass('nda-backdrop');
        });

        const $confirmBtn = $('#btn-confirm-nda');
        const $accessKeySection = $('#nda-access-key-section');
        const isExternal = fromSource === 'shared';

        if (isExternal) {
            $accessKeySection.show();
        } else {
            $accessKeySection.hide();
        }

        const validateNda = () => {
            const signature = $('#nda-signature-name').val().trim();
            const confirmTxt = $('#nda-confirmation-text').val().trim();
            const accessKey = $('#nda-access-key').val().trim();
            const REQUIRED_TXT = "위 사항을 위반하지 않을 것을 약속합니다";
            
            let isValid = false;
            if (isExternal) {
                // 외부 공유 시: 성함이 guestName과 일치하고, 확약 문구가 일치하며, 키가 입력되어야 함
                isValid = (signature === (guestName || '') && confirmTxt === REQUIRED_TXT && accessKey.length >= 6);
            } else {
                // 회원 접속 시: 성함이 currentUserName과 일치하고 확약 문구가 일치해야 함
                isValid = (signature === currentUserName && confirmTxt === REQUIRED_TXT);
            }

            if (isValid) {
                $confirmBtn.prop('disabled', false).css('opacity', '1');
            } else {
                $confirmBtn.prop('disabled', true).css('opacity', '0.5');
            }
        };

        $('#nda-signature-name, #nda-confirmation-text').off('input').on('input', validateNda);
        
        // [New] 접근 키 입력 시 실시간 유효성 확인 및 성함 가이드 업데이트
        $('#nda-access-key').off('input').on('input', async function() {
            const key = $(this).val().trim();
            if (key.length >= 6) {
                const shareLog = await sharingUtils.validateShareKey(_supabase, id, key);
                if (shareLog) {
                    guestName = shareLog.recipient_name;
                    $('#logged-in-user-name').text(guestName).css('color', '#0d9488');
                    $('#nda-name-hint').html(`* <strong style="color: #0d9488;">${guestName}</strong> 님의 성함을 입력해주세요.`);
                    $(this).css('border-color', '#10b981');
                } else {
                    guestName = null;
                    $('#logged-in-user-name').text('사용자').css('color', '#8b5cf6');
                    $('#nda-name-hint').html(`* 유효하지 않은 키이거나 접근 횟수(3회)를 초과했습니다.`);
                    $(this).css('border-color', '#ef4444');
                }
            } else {
                guestName = null;
                $('#nda-name-hint').text('* 전달받은 6자리 접근 키를 입력해주세요.');
                $(this).css('border-color', '#f1f5f9');
            }
            validateNda();
        });
        
        $confirmBtn.off('click').on('click', async () => {
            const signature = $('#nda-signature-name').val().trim();
            const accessKey = $('#nda-access-key').val().trim();

            if (isExternal) {
                // 키 유효성 검사
                const shareLog = await sharingUtils.validateShareKey(_supabase, id, accessKey);
                if (!shareLog) {
                    alert('유효하지 않거나 만료된 접근 키입니다.');
                    return;
                }
                // 접근 로그 기록
                await sharingUtils.logExternalAccess(_supabase, shareLog.id);
            }

            try {
                if (userData) {
                    // 회원인 경우 nda_logs 저장 (중복 호출 제거 및 필드 정리)
                    await _supabase.from('nda_logs').insert({
                        user_id: userData.id,
                        item_id: id,
                        signature: signature,
                        item_type: 'buyer'
                    });
                }
                
                // 서명 완료 기록 (로컬 스토리지 - 비회원 포함)
                saveSignedNda(id);
            } catch (e) { 
                console.error('Failed to save NDA log', e); 
            }

            ndaModal.hide();
            location.reload();
        });

        // 취소 시 목록으로
        $('#nda-modal-cancel-btn').off('click').on('click', () => {
            location.href = './my_buyers.html';
        });

        ndaModal.show();
    }
});
