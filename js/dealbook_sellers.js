import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import * as sharingUtils from './sharing_utils.js';

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
    // 인증 및 초기화
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    let sellerId = urlParams.get('id');   // 'new' 또는 실제 ID
    const fromSource = urlParams.get('from'); // 'totalseller' 등 유입 경로
    let isNew = sellerId === 'new';

    let userData = null;
    try {
        userData = JSON.parse(localStorage.getItem('dealchat_users'));
    } catch (e) {}

    // 비회원 & 외부 공유 링크인 경우 예외 허용
    if (!userData || !userData.isLoggedIn) {
        if (fromSource === 'shared' && sellerId) {
            console.log('Non-member accessing shared seller report');
            // loadSellerData handles NDA and redirect
        } else {
            checkAuth(); // 로그인 페이지로 리다이렉트
            return;
        }
    } else {
        updateHeaderProfile(userData);
        initUserMenu();
    }

    const user_id = userData ? userData.id : null;

    let currentSellerData = null;
    let availableFiles = [];
    let conversationHistory = [];
    let currentSourceType = 'training';
    let availableReportTypes = [];

    let myCompanies = [];
    let selectedCompanyId = null; // 선택된 기업의 UUID 추적
    
    // 유입 경로에 따른 뒤로가기 버튼 링크 수정
    if (fromSource === 'totalseller') {
        $('.sidebar .panel-header button').filter(function() {
            return $(this).attr('onclick') && $(this).attr('onclick').includes('my_sellers.html');
        }).attr('onclick', "location.href='./total_sellers.html'");
    }

    // 기업 정보 파싱 함수 (companies.js 로직 유사)
    function parseCompanyData(company) {
        const parsed = { ...company };
        parsed.companyName = company.name || company.company_name || company.companyName || "";
        
        // 최신 DB 컬럼 우선 사용
        parsed.ceoName = company.ceo_name || company.ceoName || "";
        parsed.companyEmail = company.email || company.companyEmail || "";
        parsed.establishmentDate = company.establishment_date || company.establishmentDate || "";
        parsed.companyAddress = company.address || company.companyAddress || "";
        parsed.financialAnalysis = company.financial_analysis || company.financialAnalysis || "";
        parsed.managerMemo = company.manager_memo || company.managerMemo || "";

        // [New Schema Support] DB에서 직접 받은 데이터(JSONB 배열)가 있으면 우선함
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

            // 요약 텍스트에만 정보가 있는 경우 보완 (하방 호환)
            if (metaText) {
                const ceoMatch = metaText.match(/대표자명\s*:\s*(.*)/);
                if (ceoMatch && !parsed.ceoName) parsed.ceoName = ceoMatch[1].split('\n')[0].trim();
                
                const emailMatch = metaText.match(/이메일\s*:\s*(.*)/);
                if (emailMatch && !parsed.companyEmail) parsed.companyEmail = emailMatch[1].split('\n')[0].trim();
                
                const dateMatch = metaText.match(/설립일자\s*:\s*(.*)/);
                if (dateMatch && !parsed.establishmentDate) parsed.establishmentDate = dateMatch[1].split('\n')[0].trim();
                
                const addressMatch = metaText.match(/주소\s*:\s*(.*)/);
                if (addressMatch && !parsed.companyAddress) parsed.companyAddress = addressMatch[1].split('\n')[0].trim();
                
                const finStatusMatch = metaText.match(/재무\s*현황\s*:\s*((?:.|\n)*?)(?=(?=대표자명|이메일|설립일자:|주소:|재무 분석:|해당자 의견:|$))/);
                if (finStatusMatch && !parsed.financialStatusDesc) parsed.financialStatusDesc = finStatusMatch[1].trim();
                
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
        console.log('내 매도인 추천용 기업 목록 로딩 시작... (ID:', user_id, ')');
        try {
            const { data, error } = await _supabase
                .from('companies')
                .select('*')
                .eq('user_id', user_id)
                .is('deleted_at', null);

            if (data && !error) {
                myCompanies = data.map(parseCompanyData);
                console.log('내 매도인 추천용 기업 목록 로드 완료:', myCompanies.length, '개');
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
            } else {
                console.error('기업 목록 로드 실패:', error);
            }
        } catch (err) {
            console.error('Load companies critical error:', err);
        }
    }
    loadMyCompanies();

    // 기업 선택 시 필드 채우기 (개선: 이전 매도 정보도 함께 호출)
    async function fillCompanyFields(company) {
        if (!company) return;
        
        console.log('기업 연동 시작:', company.companyName, '(ID:', company.id, ')');
        
        // 1. 기업 기본 정보 채우기
        $('#seller-name-editor').text(company.companyName || '').trigger('input');
        $('#seller-industry').val(company.industry || '기타').trigger('change');
        $('#seller-ceo').val(company.ceoName || '');
        $('#seller-email').val(company.companyEmail || '');
        $('#seller-establishment').val(company.establishmentDate || '');
        $('#seller-address').val(company.companyAddress || '');
        $('#seller-summary').val(company.parsedSummary || company.summary || '');
        $('#seller-fin-analysis').val(company.financialAnalysis || '');
        
        // 2. 재무 정보 테이블 채우기
        $('#financial-rows').empty();
        const finSource = company.financialDataArr || company.financial_info || company.financial_data;
        if (finSource && Array.isArray(finSource) && finSource.length > 0) {
            finSource.forEach(fin => {
                createFinancialRow(
                    fin.year || '', 
                    fin.revenue || '', 
                    fin.profit || fin.operating_profit || '', 
                    fin.net_profit || fin.net_income || '', 
                    fin.ev_ebitda || ''
                );
            });
        }
        
        // 기업 정보 연동 시 필드 비활성화 및 스타일 적용
        toggleCompanyFields(true);
        
        // 3. 기존 매도 정보(sellers 테이블)가 있는지 확인하여 가져오기
        // [보안/RLS] 본인이 작성한 매도글만 조회하여 업데이트 대상으로 삼음 (403 오류 방지)
        try {
            const { data: sellerData, error: sellerError } = await _supabase
                .from('sellers')
                .select('*')
                .eq('company_id', company.id)
                .eq('user_id', user_id) 
                .maybeSingle();
            
            if (sellerError) {
                console.warn('기존 매도인 정보 조회 중 오류(무시 가능):', sellerError);
            }

            if (sellerData) {
                console.log('기존 매도 정보 발견:', sellerData);
                // 기존 데이터가 있다면 필드 주입
                $('#seller-price').val(sellerData.matching_price || sellerData.sale_price || '');
                if ((sellerData.matching_price || sellerData.sale_price) === '협의') {
                    $('#negotiable-check').prop('checked', true);
                    $('#seller-price').prop('readonly', true).css('background', '#f8fafc');
                }
                
                $('#seller-method').val(sellerData.sale_method || '');
                $('#seller-memo').val(sellerData.sale_info || '');
                $('#seller-manager-memo').val(sellerData.manager_memo || '');
                // 전역 상태 업데이트 (수정 모드로 전환)
                sellerId = sellerData.id;
                isNew = false;
                currentSellerData = sellerData;
                selectedCompanyId = sellerData.company_id;
                
                console.log('상세 상태 업데이트 완료: sellerId=', sellerId, 'isNew=', isNew);
                
                // 전역 sellerId 업데이트 (수정 모드로 전환 유도)
                // location.href를 바꾸면 입력 중이던 내용이 날아갈 수 있으므로 주의 필요
                // 여기서는 필드만 채우고 저장 시 update로 처리하도록 유도
            } else {
                // 기존 매도 정보가 없으면 필드 초기화
                $('#seller-price').val('');
                $('#negotiable-check').prop('checked', false);
                $('#seller-price').prop('readonly', false).css('background', '#ffffff');
                $('#seller-method').val('');
                $('#seller-memo').val('');
                $('#seller-manager-memo').val(''); // 회사 기본 의견 대신 비워둠 (요구사항 반영)
                setChip('대기');
            }
        } catch (err) {
            console.error('Failed to fetch existing seller data:', err);
        }

        autoResizeAll();
        $('#company-suggestions').hide();
    }

    // 기업 정보 연동 시 필드 상태 관리 함수 (개선: 복사 방식이므로 항상 활성 상태 유지)
    function toggleCompanyFields(isLinked) {
        const activeStyle = {
            'background-color': '#ffffff',
            'color': '#1e293b',
            'cursor': 'auto'
        };

        const targetFields = [
            { el: $('#seller-industry'), type: 'select' },
            { el: $('#seller-ceo'), type: 'input' },
            { el: $('#seller-email'), type: 'input' },
            { el: $('#seller-establishment'), type: 'input' },
            { el: $('#seller-address'), type: 'input' },
            { el: $('#seller-summary'), type: 'textarea' },
            { el: $('#seller-fin-analysis'), type: 'textarea' }
        ];

        targetFields.forEach(({ el, type }) => {
            // 연동 여부와 상관없이 항상 수정 가능하도록 설정
            if (type === 'select') el.prop('disabled', false);
            else el.prop('readonly', false);
            el.css(activeStyle);
        });

        // 재무 정보 행들 및 관련 버튼 처리
        const $finRows = $('.financial-row input');
        const $addBtn = $('#add-financial-btn');
        const $removeBtns = $('.btn-remove-row');

        $finRows.prop('readonly', false).css(activeStyle);
        $addBtn.prop('disabled', false).css({ 'opacity': '1', 'cursor': 'pointer' });
        $removeBtns.show();
    }

    // 기업명 입력 이벤트 (자동 완성 및 제목 업데이트)
    $('#seller-name-editor').on('input focus keyup focusin', function() {
        const name = $(this).text().trim() || '매도인';
        const query = name.toLowerCase();
        
        // 제목 업데이트
        document.title = `${name} - 매도인 정보`;
        $('#sidebar-header-title').text(name || '매도인 정보');

        const $suggestions = $('#company-suggestions');
        if (!name || name === '매도인') { $suggestions.hide(); return; }
        if (myCompanies.length === 0) { $suggestions.hide(); return; } 
        
        const filtered = myCompanies.filter(c => {
            const dbName = (c.name || "").toLowerCase();
            const parsedName = (c.companyName || "").toLowerCase();
            return dbName.includes(query) || parsedName.includes(query);
        });

        if (filtered.length === 0) { $suggestions.hide(); return; }
        $suggestions.empty().show();

        // 최대 10개까지만 노출
        const displayList = filtered.slice(0, 10);

        displayList.forEach(c => {
            const dispName = c.name || c.companyName || "";
            const $item = $(`<div style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px; transition: background 0.2s;">
                                <div style="font-weight: 700; color: #1e293b;">${dispName}</div>
                                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${c.industry || '기타'}</div>
                             </div>`);
            
            $item.on('mouseenter', function() { $(this).css('background', '#f1f5f9'); });
            $item.on('mouseleave', function() { $(this).css('background', 'white'); });
            
            $item.on('mousedown', (e) => {
                e.preventDefault();
                selectedCompanyId = c.id; // UUID 저장
                fillCompanyFields(c);
            });
            $suggestions.append($item);
        });

        // 최하단 "직접 입력" 옵션 추가
        const $directItem = $(`<div style="padding: 10px 16px; cursor: pointer; border-top: 2px solid #f1f5f9; font-size: 13px; color: #8b5cf6; font-weight: 600; background: #f8fafc;">
                                <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">edit_note</span> 직접 입력 (닫기)
                             </div>`);
        $directItem.on('mousedown', (e) => {
            e.preventDefault();
            $suggestions.hide();
        });
        $suggestions.append($directItem);
    });

    // 산업 선택 변경
    $('#seller-industry').on('change', function() {
        if ($(this).val() === '기타') {
            $('#seller-industry-etc').show().focus();
        } else {
            $('#seller-industry-etc').hide();
        }
    });

    // 매각 희망가 '협의' 체크박스 로직
    $('#negotiable-check').on('change', function() {
        const $priceInput = $('#seller-price');
        if ($(this).is(':checked')) {
            $priceInput.val('협의').prop('readonly', true).css('background', '#f8fafc');
        } else {
            $priceInput.val('').prop('readonly', false).css('background', '#ffffff').focus();
        }
    });

    if (userData) {
        $('#memo-author-name').text(userData.name || '');
        $('#memo-author-company').text(userData.company || 'DealChat');
        $('#memo-author-affiliation').text(userData.department || userData.affiliation || '-');
        $('#memo-author-email').text(userData.email || '');
        $('#memo-author-avatar').attr('src', resolveAvatarUrl(userData.avatar || userData.avatar_url, 1));
    }

    if (!isNew) {
        $('#btn-delete-seller').show();
    } else {
        $('#btn-delete-seller').hide();
    }

    if (!sellerId) {
        alert('매도인 ID가 없습니다.');
        location.href = './my_sellers.html';
        return;
    }

    // ==========================================
    // 데이터 로드
    // ==========================================
    async function loadSellerData() {
        if (isNew) {
            setChip('대기');
            $('#financial-rows').empty();
            hideLoader();
            return;
        }

        try {
            console.log('매도인 상세 데이터 로딩... (ID:', sellerId, ')');
            
            let isSigned = false;
            if (userData && userData.isLoggedIn) {
                // 상시 서명 이력 확인 (fromSource와 관계없이 사용자가 로그인했다면 확인)
                const { data: ndaData } = await _supabase
                    .from('nda_logs')
                    .select('id')
                    .eq('user_id', userData.id)
                    .or(`item_id.eq.${sellerId},seller_id.eq.${sellerId}`)
                    .maybeSingle();
                
                // 2. 로컬 스토리지에서 서명 이력이 있는지 확인 (비회원 폴백)
                const localSigned = getSignedNdas();
                isSigned = !!ndaData || localSigned.includes(String(sellerId));
            }

            let seller = null;
            let ndaRequired = false;

            // 1. 전체 데이터 로드 시 기업 정보 조인
            const { data: fullData, error: fullError } = await _supabase
                .from('sellers')
                .select('*, companies(*)')
                .eq('id', sellerId)
                .maybeSingle();

            if (fullData) {
                seller = fullData;
            } else if (fromSource === 'shared' || fromSource === 'totalseller') {
                const { data: limitedData } = await _supabase
                    .from('sellers')
                    .select(`
                        id, company_id, matching_price, sale_method, is_draft, status, user_id, created_at, updated_at, 
                        sale_info, manager_memo,
                        companies(*)
                    `)
                    .eq('id', sellerId)
                    .maybeSingle();
                
                if (limitedData) {
                    seller = limitedData;
                }
            }

            if (!seller) {
                alert('해당 매도인 정보를 찾을 수 없거나 접근 권한이 없습니다.');
                location.href = './my_sellers.html';
                return;
            }

            const isOwner = userData && String(seller.user_id) === String(userData.id);

            if (!isOwner && !isSigned) {
                ndaRequired = true;
            }

            if (ndaRequired) {
                const displayName = seller.name || '비공개 기업';
                showNdaGate(sellerId, displayName);
            } else {
                currentSellerData = seller;
                
                if (userData && !isOwner && fromSource === 'totalseller' && isSigned) {
                    APIcall({ 
                        table: 'nda_logs', 
                        action: 'update_view', 
                        user_id: userData.id, 
                        seller_id: sellerId 
                    }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                    .catch(e => console.error('Failed to log view on load', e));
                }
                
                // 기업 정보 매핑 (sellers 테이블 독립 컬럼 데이터 우선, 없으면 companies 조인 데이터)
                const company = seller.companies || {};
                const sellerName = seller.name || company.name || '비공개 기업';
                const sellerIndustry = seller.industry || company.industry || '선택해주세요';
                const sellerSummary = seller.summary || company.summary || '';
                const sellerCeo = seller.ceo_name || company.ceo_name || '';
                const sellerEmail = seller.email || company.email || '';
                const sellerEstDate = seller.establishment_date || company.establishment_date || '';
                const sellerAddress = seller.address || company.address || '';
                const sellerFinAnalysis = seller.financial_analysis || company.financial_analysis || '';
                const sellerFinInfo = (seller.financial_info && Array.isArray(seller.financial_info) && seller.financial_info.length > 0) 
                                     ? seller.financial_info 
                                     : (company.financial_info || []);
    
                $('#sidebar-header-title').text(sellerName);
                document.title = sellerName + ' - 매도인 정보';
                
                const d = new Date(seller.updated_at || seller.created_at);
                const formattedDate = d.toLocaleDateString('ko-KR', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                $('#memo-update-date').text(`최종 수정: ${formattedDate}`);
    
                $('#seller-name-editor').text(sellerName);
                $('#seller-industry').val(sellerIndustry).trigger('change');
                if ($('#seller-industry').val() === '기타') {
                    $('#seller-industry-etc').val(sellerIndustry);
                }
    
                $('#seller-ceo').val(sellerCeo);
                $('#seller-email').val(sellerEmail);
                $('#seller-establishment').val(sellerEstDate);
                $('#seller-address').val(sellerAddress);
                
                const price = seller.matching_price || seller.sale_price || '';
                $('#seller-price').val(price);
                if (price === '협의') {
                    $('#negotiable-check').prop('checked', true);
                    $('#seller-price').prop('readonly', true).css('background', '#f8fafc');
                }
    
                $('#seller-summary').val(sellerSummary);
                $('#seller-fin-analysis').val(sellerFinAnalysis);
                
                const saleInfo = seller.sale_info || seller.sale_memo || '';
                $('#seller-memo').val(saleInfo);
                $('#seller-manager-memo').val(seller.manager_memo || '');
    
                const currentStatus = seller.status || '대기';
                setChip(currentStatus);
    
                const currentMethod = (['대기', '진행중', '완료'].includes(seller.sale_method)) ? '' : (seller.sale_method || '');
                $('#seller-method').val(currentMethod);
    
                $('#financial-rows').empty();
                const finData = sellerFinInfo && Array.isArray(sellerFinInfo) ? sellerFinInfo : (seller.financial_info || []);
                if (finData.length > 0) {
                    finData.forEach(f => {
                        createFinancialRow(f.year, f.revenue, f.profit, f.net_profit, f.ev_ebitda);
                    });
                }
                if ($('#financial-rows').children().length === 0) {
                    createFinancialRow(); 
                }
    
                const authorId = seller.user_id;
                try {
                    const { data: authorData } = authorId ? await _supabase.from('users').select('*').eq('id', authorId).maybeSingle() : { data: null };
                    const author = authorData || DEFAULT_MANAGER;
                    
                    $('#memo-author-name').text(author.name || DEFAULT_MANAGER.name);
                    $('#memo-author-company').text(author.company || 'DealChat');
                    $('#memo-author-affiliation').text(author.department || author.affiliation || '-');
                    $('#memo-author-email').text(author.email || '');
                    $('#memo-author-avatar').attr('src', resolveAvatarUrl(author.avatar || author.avatar_url, 1));
                    
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
                } catch (e) {
                    console.warn('Author info load fail:', e);
                }
    
                autoResizeAll();
    
                if (fromSource === 'totalseller') {
                    applySellerReadOnlyMode();
                } else if (seller.companies) {
                    // 기업 정보가 연결된 경우 필드 비활성화 적용
                    toggleCompanyFields(true);
                }
    
                loadAvailableFiles();
    
                if (seller.history && Array.isArray(seller.history)) {
                    conversationHistory = seller.history;
                    conversationHistory.forEach(msg => {
                        addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                    });
                    $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                }
            }
        } catch (err) {
            console.error('Load error:', err);
            location.href = './my_sellers.html';
        } finally {
            hideLoader();
        }
    }

    loadSellerData();
    loadReportTypes();

    // ==========================================
    // 진행 현황 Chip
    // ==========================================
    function setChip(value) {
        $('.btn-status-chip').removeClass('active').css({
            background: '#fff', color: '#64748b', borderColor: '#e2e8f0'
        });
        $(`.btn-status-chip[data-value="${value}"]`).addClass('active').css({
            background: '#8b5cf6', color: '#fff', borderColor: '#8b5cf6',
            boxShadow: '0 4px 10px rgba(139,92,246,0.2)'
        });
        $('#seller-status').val(value);
    }

    $(document).on('click', '.btn-status-chip', function () {
        setChip($(this).data('value'));
    });

    // ==========================================
    // Textarea 자동 높이
    // ==========================================
    function autoResizeTextarea($el) {
        if (!$el || !$el[0]) return;
        $el.css('height', 'auto');
        $el.css('height', $el[0].scrollHeight + 'px');
    }
    function autoResizeAll() {
        autoResizeTextarea($('#seller-summary'));
        autoResizeTextarea($('#seller-memo'));
        autoResizeTextarea($('#seller-manager-memo'));
        autoResizeTextarea($('#seller-fin-analysis'));
    }

    $('#seller-summary, #seller-memo, #seller-manager-memo, #seller-fin-analysis').on('input', function () {
        autoResizeTextarea($(this));
    });

    // ==========================================
    // 재무 정보 동적 행 관리
    // ==========================================
    function createFinancialRow(year = '', revenue = '', profit = '', netProfit = '', evEbitda = '') {
        const rowId = `fin-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const rowHtml = `
            <div class="financial-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; padding: 0 30px 0 12px; box-sizing: border-box; width: 100%;">
                <input type="text" class="fin-year" value="${year}" placeholder="연도"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-revenue format-number" value="${revenue}" placeholder="매출액"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-profit format-number" value="${profit}" placeholder="영업이익"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-net-profit format-number" value="${netProfit}" placeholder="순이익"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-ev-ebitda" value="${evEbitda}" placeholder="EV/EBITDA"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #ef4444; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -24px;">
                    <span class="material-symbols-outlined" style="font-size: 18px; font-weight: bold;">remove</span>
                </button>
            </div>
        `;
        $('#financial-rows').append(rowHtml);
    }

    $(document).on('input', '.format-number', function() {
        let val = $(this).val().replace(/[^0-9.-]/g, '');
        if (val) {
            const parts = val.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            $(this).val(parts.join('.'));
        }
    });

    $('#add-financial-btn').on('click', function() {
        createFinancialRow();
    });

    $(document).on('click', '.btn-remove-row', function() {
        $(this).closest('.financial-row').remove();
    });

    // ==========================================
    // 보고서 생성 로직
    // ==========================================
    function loadReportTypes() {
        $.getJSON('../data/reports.json', function (data) {
            availableReportTypes = data;
            renderReportCards();
        }).fail(function () {
            console.error("Failed to load report types.");
        });
    }

    function renderReportCards() {
        const $formatGrid = $('#report-grid-format');
        const $recGrid = $('#report-grid-recommended');

        $formatGrid.empty();
        $recGrid.empty();

        availableReportTypes.forEach(report => {
            const isPrimary = report.isPrimary ? 'primary' : '';
            const cardHtml = `
                <div class="report-card ${isPrimary}" data-id="${report.id}">
                    <h5>
                        ${report.title}
                        ${report.isPrimary ? '' : '<span class="material-symbols-outlined" style="font-size: 16px; color: #8b5cf6;">edit_note</span>'}
                    </h5>
                    <p>${report.description}</p>
                </div>
            `;

            if (report.type === 'format') {
                $formatGrid.append(cardHtml);
            } else {
                $recGrid.append(cardHtml);
            }
        });
    }

    const $reportModal = $('#report-selection-modal');
    const $reportDetailModal = $('#report-gen-detail-modal');

    $('#btn-generate-report').on('click', function () {
        $reportModal.css('display', 'flex');
    });

    $('#close-report-modal').on('click', function () {
        $reportModal.hide();
    });

    $('#close-gen-detail-modal').on('click', function () {
        $reportDetailModal.hide();
    });

    $('#back-to-selection').on('click', function () {
        $reportDetailModal.hide();
        $reportModal.css('display', 'flex');
    });

    $(document).on('click', '.report-card', function () {
        const reportId = $(this).data('id');
        const reportData = availableReportTypes.find(r => r.id === reportId);
        if (!reportData) return;

        $('#selected-report-title').text(reportData.title);
        $('#selected-report-desc').text(reportData.description);
        $('#report-instruction').val(reportData.instruction);

        $reportModal.hide();
        $reportDetailModal.css('display', 'flex');
    });

    $('#start-generate-report').on('click', async function () {
        const instruction = $('#report-instruction').val().trim();
        const language = $('#report-language').val();
        const reportType = $('#selected-report-title').text();

        if (!instruction) {
            alert('만들려는 보고서에 대한 설명을 입력해주세요.');
            $('#report-instruction').focus();
            return;
        }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> 생성 중...');

        try {
            const prompt = `[Report Type] ${reportType}\n[Language] ${language}\n[Instruction] ${instruction}`;
            
            let infoCtx = `=== 매도인 기본 정보 ===\n`;
            infoCtx += `기업명: ${$('#seller-name-editor').text()}\n`;
            infoCtx += `산업: ${$('#seller-industry').val()}\n`;
            infoCtx += `소개: ${$('#seller-summary').val()}\n`;
            infoCtx += `재무분석: ${$('#seller-fin-analysis').val()}\n`;
            infoCtx += `해당자의견: ${$('#seller-memo').val()}\n`;

            const historyCtx = conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
            
            let ragContext = "";
            if (!isNew) {
                ragContext = await searchVectorDB(`${reportType} 보고서 관련 정보`, sellerId);
            }

            const fullContext = infoCtx + "\n[Conversation History]\n" + historyCtx + (ragContext ? "\n=== 관련 문서 내용 ===\n" + ragContext : "");

            const response = await addAiResponse(prompt, fullContext);
            const data = await response.json();
            const generatedContent = data.answer;

            if (generatedContent) {
                downloadTextFile(`${reportType}.txt`, generatedContent);
                $reportDetailModal.hide();
                alert(`[${reportType} 생성 완료]\n\n파일이 다운로드되었습니다.`);
            }
        } catch (error) {
            console.error('보고서 생성 실패:', error);
            alert('보고서 생성 중 오류가 발생했습니다.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // ==========================================
    // 저장 및 삭제
    // ==========================================
    function getSummaryFromEditor() {
        return $('#seller-summary').val().trim();
    }

    function buildPayload(isDraft) {
        const name = $('#seller-name-editor').text().trim();
        const industryVal = $('#seller-industry').val();
        const industry = (industryVal === '기타' && $('#seller-industry-etc').val().trim())
                         ? $('#seller-industry-etc').val().trim()
                         : industryVal;
        const price = $('#seller-price').val().trim();
        const status = $('#seller-status').val();
        const method = $('#seller-method').val().trim();
        const summary = getSummaryFromEditor();
        
        const sale_info = $('#seller-memo').val().trim();
        const manager_memo = $('#seller-manager-memo').val().trim();

        const ceo = $('#seller-ceo').val().trim();
        const email = $('#seller-email').val().trim();
        const establishment = $('#seller-establishment').val().trim();
        const address = $('#seller-address').val().trim();
        const financial_analysis = $('#seller-fin-analysis').val().trim();

        const financial_data = [];
        $('.financial-row').each(function() {
            const year = $(this).find('.fin-year').val().trim();
            const revenue = $(this).find('.fin-revenue').val().replace(/,/g, '').trim();
            const profit = $(this).find('.fin-profit').val().replace(/,/g, '').trim();
            const net_profit = $(this).find('.fin-net-profit').val().replace(/,/g, '').trim();
            const ev_ebitda = $(this).find('.fin-ev-ebitda').val().trim();
            
            if (year || revenue || profit || net_profit || ev_ebitda) {
                financial_data.push({ year, revenue, profit, net_profit, ev_ebitda });
            }
        });

        if (!name || industry === '선택해주세요' || !summary) {
            alert('기업명, 산업, 회사 소개는 필수 항목입니다.');
            return null;
        }

        const payload = {
            company_id: currentSellerData ? currentSellerData.company_id : (selectedCompanyId || null),
            
            // [New Redesign] 기업 데이터를 독립적으로 복사하여 저장
            name: name,
            industry: industry,
            ceo_name: ceo,
            email: email,
            establishment_date: establishment,
            address: address,
            summary: summary,
            financial_info: financial_data, // JSONB
            financial_analysis: financial_analysis,

            matching_price: price, 
            sale_method: method,
            sale_info: sale_info,
            manager_memo: manager_memo,
            status: status || '대기',
            is_draft: isDraft,
            user_id: user_id || null,
            updated_at: new Date().toISOString()
        };

        return payload;
    }

    async function saveSeller(isDraft, $btn) {
        // 희망가 미입력 시 자동으로 '협의' 체크
        const currentPrice = $('#seller-price').val().trim();
        if (!currentPrice && !$('#negotiable-check').is(':checked')) {
            console.log('희망가 미입력으로 인한 "협의" 자동 체크 적용');
            $('#negotiable-check').prop('checked', true).trigger('change');
        }

        // [디버그] 인증 상태 및 세션 정보 로깅
        const { data: { session }, error: sessionError } = await _supabase.auth.getSession();
        const { data: { user }, error: authError } = await _supabase.auth.getUser();
        
        console.log('Auth Check - User ID from getUser():', user?.id);
        console.log('Auth Check - Session User ID:', session?.user?.id);
        
        if (!user) {
            console.error('인증 오류 (getUser() 실패):', authError || '사용자 정보 없음');
            alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
            location.href = './signin.html';
            return;
        }

        const real_auth_uid = user.id;
        const payload = buildPayload(isDraft);
        if (!payload) return;

        // 페이로드의 user_id를 실제 인증된 ID로 강제 고정
        payload.user_id = real_auth_uid;

        console.log('저장 시도 상세:', { 
            isNew, 
            sellerId, 
            payload_uid: payload.user_id, 
            auth_uid: real_auth_uid,
            matches: payload.user_id === real_auth_uid 
        });

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined" style="font-size:16px;">hourglass_top</span> 저장 중...');

        try {
            let result;
            if (isNew) {
                // [Redesign] 모든 필드를 포함하여 INSERT
                console.log('Sellers 독립 데이터 포함 INSERT 시도...');
                result = await _supabase.from('sellers').insert(payload);
            } else {
                result = await _supabase.from('sellers').update(payload).eq('id', sellerId).select();
            }

            console.log('Supabase API Response - Status:', result.status, 'StatusText:', result.statusText);
            
            if (result.error) {
                console.error('Supabase API Error:', result.error);
                throw result.error;
            }

            alert(isDraft ? '비공개로 저장되었습니다.' : '저장되었습니다.');
            // .select()가 없으므로 redirect 대신 reload나 목록 이동
            if (isNew) {
                location.href = './my_sellers.html';
            } else {
                location.reload();
            }
        } catch (err) {
            console.error('Save error details:', err);
            let msg = err.message || '오류 발생';
            if (err.code === '42501') {
                msg = '권한이 없습니다 (RLS 정책 위반).';
                console.warn('RLS Violation Triggered. Payload:', JSON.stringify(payload));
            }
            alert('저장 실패: ' + msg);
        } finally {
            $btn.prop('disabled', false).html(origHtml);
        }
    }

    $('#btn-save-seller').on('click', function () { saveSeller(false, $(this)); });
    $('#btn-draft-seller').on('click', function () { saveSeller(true, $(this)); });

    $('#btn-delete-seller').on('click', async function () {
        if (!confirm('정말로 이 매도인 정보를 삭제하시겠습니까?')) return;
        
        showLoader();
        try {
            const { error } = await _supabase.from('sellers').delete().eq('id', sellerId);
            if (error) throw error;
            
            alert('삭제되었습니다.');
            location.href = './my_sellers.html';
        } catch (e) {
            console.error("Delete error:", e); // Changed 'err' to 'e' and message to "Delete error:"
            alert('삭제 요청 실패');
        } finally {
            hideLoader();
        }
    });

    // ==========================================
    // 파일 업로드 / 목록
    // ==========================================
    async function loadAvailableFiles() {
        if (isNew) return;
        try {
            const { data, error } = await _supabase
                .from('files')
                .select('*')
                .eq('entity_id', sellerId)
                .eq('entity_type', 'seller');

            if (error) throw error;
            availableFiles = data || [];
            renderFileList();
        } catch (err) {
            console.error('File load error:', err);
        }
    }

    function renderFileList() {
        const $listTraining = $('#source-list-training');
        const $listFinance = $('#source-list-finance');
        const $listNonTraining = $('#source-list-non-training');
        $listTraining.empty();
        $listFinance.empty();
        $listNonTraining.empty();

        if (availableFiles.length === 0) {
            const emptyMsg = '<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>';
            $listTraining.html(emptyMsg);
            $listFinance.html(emptyMsg);
            $listNonTraining.html(emptyMsg);
            return;
        }

        availableFiles.forEach(file => {
            let $list;
            if (file.source_type === 'training') $list = $listTraining;
            else if (file.source_type === 'finance') $list = $listFinance;
            else $list = $listNonTraining;
            $list.append(`
                <li style="display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9;">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: #64748b;">description</span>
                    <span style="flex: 1; font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                          title="${file.file_name || ''}">${file.file_name || ''}</span>
                    <button class="btn-remove-file" data-id="${file.id}"
                        style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
                    </button>
                </li>
            `);
        });
    }

    $('#add-source-training').on('click', () => { currentSourceType = 'training'; $('#file-upload').click(); });
    $('#add-source-finance').on('click', () => { currentSourceType = 'finance'; $('#file-upload').click(); });
    $('#add-source-non-training').on('click', () => { currentSourceType = 'non-training'; $('#file-upload').click(); });

    $('#file-upload').on('change', async function () {
        const files = this.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (!filetypecheck(file)) continue;
            try {
                const uploadResult = await fileUpload(file, user_id, SUPABASE_ENDPOINT);
                if (uploadResult && uploadResult.key) {
                    await _supabase.from('files').insert({
                        entity_id: sellerId,
                        entity_type: 'seller',
                        storage_path: uploadResult.key,
                        file_name: file.name,
                        file_type: file.type.split('/')[1] || 'bin',
                        user_id: user_id,
                        source_type: currentSourceType
                    });
                }
            } catch (err) {
                console.error('Upload error:', err);
                alert(`${file.name} 업로드 실패`);
            }
        }
        this.value = '';
        loadAvailableFiles();
    });

    $(document).on('click', '.btn-remove-file', async function () {
        const fileId = $(this).data('id');
        if (!confirm('파일을 삭제하시겠습니까?')) return;
        try {
            const { error } = await _supabase.from('files').delete().eq('id', fileId);
            if (error) throw error;
            loadAvailableFiles();
        } catch (err) {
            console.error('File delete error:', err);
            alert('파일 삭제 실패');
        }
    });

    // ==========================================
    // AI 채팅 관련 (생략 가능하나 유지함)
    // ==========================================
    function addMessage(content, sender, animate = true) {
        $welcomeScreen.hide();
        const isUser = sender === 'user';
        const bubbleClass = isUser ? 'user-message' : 'ai-message';
        const msgHtml = `
            <div class="${bubbleClass}" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px; ${isUser ? 'flex-direction:row-reverse;' : ''}">
                <div style="width:32px; height:32px; border-radius:50%; background:${isUser ? '#8b5cf6' : '#f1f5f9'};
                             display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <span class="material-symbols-outlined" style="font-size:18px; color:${isUser ? '#fff' : '#64748b'};">${isUser ? 'person' : 'smart_toy'}</span>
                </div>
                <div style="max-width:80%; padding:12px 16px; border-radius:12px;
                             background:${isUser ? '#8b5cf6' : '#f8fafc'};
                             color:${isUser ? '#fff' : '#334155'}; font-size:14px; line-height:1.7;
                             box-shadow: 0 2px 8px rgba(0,0,0,0.06); white-space:pre-wrap;">${content}</div>
            </div>`;
        $chatMessages.append(msgHtml);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });
    }

    async function sendMessage() {
        const msg = $('#chat-input').val().trim();
        if (!msg) return;
        $('#chat-input').val('').css('height', '42px');

        addMessage(msg, 'user');
        conversationHistory.push({ role: 'user', content: msg, timestamp: new Date().toISOString() });

        const $aiPlaceholder = $('<div class="ai-message" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px;"><div style="width:32px; height:32px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:18px; color:#64748b;">smart_toy</span></div><div class="ai-typing" style="padding:12px 16px; border-radius:12px; background:#f8fafc; color:#64748b; font-size:14px;">답변 생성 중...</div></div>');
        $chatMessages.append($aiPlaceholder);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });

        try {
            let ragContext = "";
            if (!isNew) {
                ragContext = await searchVectorDB(msg, sellerId);
            }

            const context = `[매도인 기본 정보]\n기업명: ${$('#seller-name-editor').text()}\n산업: ${$('#seller-industry').val()}\n대표자: ${$('#seller-ceo').val()}\n이메일: ${$('#seller-email').val()}\n설립일자: ${$('#seller-establishment').val()}\n주소: ${$('#seller-address').val()}\n희망가: ${$('#seller-price').val()}\n진행현황: ${$('#seller-status').val()}\n회사 소개: ${getSummaryFromEditor()}\n재무 정보: ${$('#seller-fin-analysis').val()}\n매도 정보: ${$('#seller-memo').val()}\n\n[참고 문서 내용]\n${ragContext}`;
            
            const response = await addAiResponse(msg, context);
            const data = await response.json();
            const aiReply = data.answer || '답변을 받지 못했습니다.';
            
            $aiPlaceholder.find('.ai-typing').text(aiReply);
            conversationHistory.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString() });

            if (!isNew) {
                await _supabase.from('sellers').update({
                    history: conversationHistory,
                    updated_at: new Date().toISOString()
                }).eq('id', sellerId);
            }
        } catch (err) {
            $aiPlaceholder.find('.ai-typing').text('AI 답변 생성 실패.');
        }
    }

    $('#send-btn').on('click', sendMessage);
    $('#chat-input').on('keypress', function (e) {
        if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // ==========================================
    // AI 자동 입력
    // ==========================================
    async function autoFillFromFiles($btn) {
        if (isNew || availableFiles.length === 0) {
            alert('먼저 파일을 업로드하고 저장한 후 시도해 주세요.');
            return;
        }

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 20px;">sync</span> 추출 중...');

        try {
            const query = "기업명, 대표자명, 이메일, 설립일자, 사업장 주소, 매출액, 영업이익, 당기순이익, EV/EBITDA, 회사 소개 내용을 추출해주세요.";
            const contextRaw = await searchVectorDB(query, sellerId);

            const prompt = `용된 자료를 분석하여 매도 기업의 주요 정보를 추출해주세요. 확인 불가능한 정보는 빈 문자열("")로 처리하세요. 반드시 JSON 형식으로만 응답하세요.\n{ "companyName": "", "ceoName": "", "email": "", "establishment": "YYYY-MM-DD", "address": "", "summary": "", "revenue": "", "operatingProfit": "", "netProfit": "", "evEbitda": "" }`;

            const response = await addAiResponse(prompt, contextRaw);
            const data = await response.json();
            let jsonData = JSON.parse(data.answer.match(/\{[\s\S]*\}/)[0]);

            if (jsonData) {
                if (jsonData.companyName) $('#seller-name-editor').text(jsonData.companyName);
                if (jsonData.ceoName) $('#seller-ceo').val(jsonData.ceoName);
                if (jsonData.email) $('#seller-email').val(jsonData.email);
                if (jsonData.establishment) $('#seller-establishment').val(jsonData.establishment);
                if (jsonData.address) $('#seller-address').val(jsonData.address);
                if (jsonData.summary) $('#seller-summary').val(jsonData.summary);
                
                const $firstRow = $('.financial-row').first();
                if (jsonData.revenue) $firstRow.find('.fin-revenue').val(jsonData.revenue).trigger('input');
                if (jsonData.operatingProfit) $firstRow.find('.fin-profit').val(jsonData.operatingProfit).trigger('input');
                if (jsonData.netProfit) $firstRow.find('.fin-net-profit').val(jsonData.netProfit).trigger('input');
                if (jsonData.evEbitda) $firstRow.find('.fin-ev-ebitda').val(jsonData.evEbitda);
                
                autoResizeAll();
                alert('기업 정보가 자동으로 추출 및 입력되었습니다.');
            }
        } catch (err) {
            alert('정보 추출에 실패했습니다.');
        } finally {
            $btn.prop('disabled', false).html(origHtml);
        }
    }

    $('#ai-auto-fill-btn').on('click', function() { autoFillFromFiles($(this)); });

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
                    $('#nda-name-hint').html(`* 유효하지 않은 키입니다. 전달받은 키를 다시 확인해주세요.`);
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

            try {
                if (typeof showLoader === 'function') showLoader();
                
                if (isExternal) {
                    // 키 유효성 검사
                    const shareLog = await sharingUtils.validateShareKey(_supabase, id, accessKey);
                    if (!shareLog) {
                        alert('유효하지 않거나 만료된 접근 키입니다.');
                        return;
                    }
                    // 접근 로그 기록
                    await sharingUtils.logExternalAccess(_supabase, shareLog.id);
                } else if (userData) {
                    // 회원인 경우 nda_logs 저장
                    await _supabase.from('nda_logs').insert({
                        user_id: userData.id,
                        item_id: id,
                        signature: signature,
                        seller_id: id,
                        item_type: 'seller'
                    });
                }
                
                // 서명 완료 기록 (로컬 스토리지)
                saveSignedNda(id);

                ndaModal.hide();
                location.reload();
            } catch (e) {
                console.error('NDA sign error:', e);
                alert('NDA 체결 중 오류가 발생했습니다.');
            } finally {
                if (typeof hideLoader === 'function') hideLoader();
            }
        });

        $('#nda-modal-cancel-btn, #nda-modal .btn-close').off('click').on('click', () => {
             location.href = './total_sellers.html';
        });

        ndaModal.show();
    }

    function applySellerReadOnlyMode() {
        console.log('Applying Professional Seller Report Mode (Purple Theme - Synced with Companies/Buyers)');
        const primaryColor = '#8b5cf6'; // Seller Purple

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
                box-shadow: 0 12px 48px rgba(139, 92, 246, 0.08) !important;
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
            .report-table-wrapper #financial-rows {
                min-width: 600px !important;
            }
            #financial-rows {
                border: none !important;
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

            /* 라벨 강조 (Purple) */
            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-weight: 600 !important;
                font-size: 13px !important;
                margin-bottom: 6px !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }

            /* textarea 대신 div 변환 텍스트 */
            .report-text-content {
                background: transparent;
                border: none;
                padding: 0;
                font-size: 14px;
                color: var(--report-text);
                line-height: 1.6;
                white-space: pre-wrap;
                word-break: break-word;
                margin-bottom: 0;
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
            textarea:disabled { display: none !important; }

            /* 테이블 정렬 및 가로세로 구분 */
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
                border-right: 1px solid #f1f5f9 !important;
                display: flex !important;
                align-items: center !important;
                line-height: 1.4 !important;
            }
            .report-table-cell:last-child { border-right: none !important; }
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
            .cell-center { justify-content: center !important; text-align: center !important; }
            .cell-right { justify-content: flex-end !important; text-align: right !important; padding-right: 15px !important; }
            .cell-left { justify-content: flex-start !important; text-align: left !important; padding-left: 15px !important; }

            /* 기업명 스타일 */
            #seller-name-editor {
                cursor: default !important;
                border: none !important;
                padding: 0 !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                color: var(--report-text) !important;
            }
            .sidebar-nav div:has(> #seller-name-editor) {
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
                box-shadow: 0 4px 10px rgba(139, 92, 246, 0.25) !important;
            }

            /* 불필요한 에디터 요소 숨기기 */
            .main-content, #guide-panel, .right-panel, .panel-resize-handle,
            #ai-auto-fill-btn,
            #btn-save-seller, #btn-draft-seller, #btn-delete-seller,
            #add-financial-btn,
            .btn-remove-row, .delete-file, .btn-icon-only:not([onclick*="location.href"]),
            #financial-section div[style*="background: #f1f5f9"],
            #negotiable-check, label:has(#negotiable-check),
            #seller-industry-etc,
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
                box-shadow: 0 6px 16px rgba(139, 92, 246, 0.25) !important;
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

            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;

        if (!$('#report-mode-css').length) {
            $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        }

        // 워터마크
        if (!$('#report-watermark').length) {
            $('<div id="report-watermark">DealChat</div>').appendTo('body');
        }
        if (!$('#share-toast').length) {
            $('<div id="share-toast"><span class="material-symbols-outlined">check_circle</span> 클립보드에 복사 완료!</div>').appendTo('body');
        }

        // 재무 정보 테이블 재포맷
        reformatSellerFinancialTable();

        // 필드 아이콘 주입
        injectSellerReportIcons();

        // 기능 제한
        $('#seller-name-editor').attr('contenteditable', 'false');
        $('#seller-name-editor').parent().css({ 'background': 'transparent', 'border': 'none', 'padding': '0', 'height': '42px', 'display': 'flex', 'align-items': 'center' });

        // NDA 모달 내부의 필드는 제외하고 비활성화
        $('input:not(#nda-modal *), select:not(#nda-modal *), textarea:not(#nda-modal *)').prop('disabled', true);

        // textarea → div 변환
        ['#seller-summary', '#seller-fin-analysis', '#seller-memo', '#seller-manager-memo'].forEach(function(sel) {
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

        // 산업 필드 텍스트화
        const $indSelect = $('#seller-industry');
        const $indOther = $('#seller-industry-etc');
        let industryText = $indSelect.val() === '기타' ? $indOther.val().trim() : $indSelect.find('option:selected').text();
        if (!industryText || industryText === '선택해주세요') industryText = '-';
        if (!$indSelect.next('.report-text-field').length) {
            $('<div class="report-text-field" style="font-size:14px; color:var(--report-text); font-weight:500; height:42px; display:flex; align-items:center;">').insertAfter($indSelect).text(industryText);
        }
        $indSelect.hide();
        $indOther.hide();

        // 매칭 희망가 필드 텍스트화
        const $priceInput = $('#seller-price');
        if ($priceInput.length && !$priceInput.next('.report-text-field').length) {
            const priceVal = $priceInput.val() || '-';
            const priceText = priceVal === '협의' ? '협의' : (priceVal !== '-' ? `${priceVal} 원` : '-');
            $('<div class="report-text-field" style="font-size:14px; color:var(--report-text); font-weight:500; height:42px; display:flex; align-items:center;">').insertAfter($priceInput).text(priceText);
        }
        $priceInput.hide();

        // 매도 방식 필드 텍스트화
        const $methodInput = $('#seller-method');
        if ($methodInput.length && !$methodInput.next('.report-text-field').length) {
            const methodVal = $methodInput.val() || '-';
            $('<div class="report-text-field" style="font-size:14px; color:var(--report-text); font-weight:500; height:42px; display:flex; align-items:center;">').insertAfter($methodInput).text(methodVal);
        }
        $methodInput.hide();

        // 진행현황 컨테이너 투명화
        $('#status-chip-group').css({ 'background': 'transparent', 'border': 'none', 'padding': '4px 0' });

        $('#sidebar-header-title').text('매도자 정보');
        document.title = (currentSellerData?.companies?.name || currentSellerData?.name || '매도자') + ' 리포트 - DealChat';
    }

    function reformatSellerFinancialTable() {
        const $finRows = $('#financial-rows');
        if (!$finRows.length || $finRows.parent('.report-table-wrapper').length) return;

        const headerHtml = `
            <div class="report-table-row report-table-header">
                <div class="report-table-cell" style="flex: 1;">년도</div>
                <div class="report-table-cell" style="flex: 2;">매출액(원)</div>
                <div class="report-table-cell" style="flex: 2;">영업이익(원)</div>
                <div class="report-table-cell" style="flex: 2;">당기순익(원)</div>
                <div class="report-table-cell" style="flex: 1.5;">EV/EBITDA</div>
            </div>
        `;
        $finRows.before(headerHtml);

        const $header = $finRows.prev('.report-table-header');
        const $wrapper = $('<div class="report-table-wrapper">');
        $header.before($wrapper);
        $wrapper.append($header).append($finRows);

        $finRows.find('.financial-row').each(function() {
            const year     = $(this).find('.fin-year').val() || '-';
            const revenue  = $(this).find('.fin-revenue').val() || '-';
            const profit   = $(this).find('.fin-profit').val() || '-';
            const net      = $(this).find('.fin-net-profit').val() || '-';
            const evEbitda = $(this).find('.fin-ev-ebitda').val() || '-';

            const rowHtml = `
                <div class="report-table-row">
                    <div class="report-table-cell cell-center" style="flex: 1;">${year}</div>
                    <div class="report-table-cell cell-right" style="flex: 2;">${revenue}</div>
                    <div class="report-table-cell cell-right" style="flex: 2;">${profit}</div>
                    <div class="report-table-cell cell-right" style="flex: 2;">${net}</div>
                    <div class="report-table-cell cell-center" style="flex: 1.5;">${evEbitda}</div>
                </div>
            `;
            $(this).after(rowHtml).remove();
        });
    }

    function injectSellerReportIcons() {
        // 섹션 단위 라벨에만 아이콘 주입 (기업 레퍼런스와 동일)
        // 필드 단위(기업명, 산업, 대표자명 등)는 아이콘 미사용
        const sections = [
            { id: 'status-chip-group',   icon: 'account_tree' },
            { id: 'seller-summary',      icon: 'description'  },
            { id: 'financial-section',   icon: 'analytics'    },
            { id: 'seller-fin-analysis', icon: 'query_stats'  },
            { id: 'seller-memo',         icon: 'sell'         },
            { id: 'seller-manager-memo', icon: 'chat_bubble'  }
        ];

        sections.forEach(function(sec) {
            const $el = $(`#${sec.id}`);
            if (!$el.length) return;
            let $p = $el.prev('p');
            if (!$p.length) $p = $el.parent().prev('p');
            if (!$p.length) $p = $el.closest('div').find('p').first();
            if ($p.length) {
                $p.find('span.material-symbols-outlined').remove();
                $p.prepend(`<span class="material-symbols-outlined" style="font-size: 18px;">${sec.icon}</span>`);
            }
        });
    }

    // ==========================================
    // NDA Local Storage Helpers (For Non-members)
    // ==========================================
    function getSignedNdas() {
        try {
            const userId = userData ? userData.id : 'anonymous';
            const signed = localStorage.getItem(`dealchat_signed_ndas_sellers_${userId}`);
            return signed ? JSON.parse(signed) : [];
        } catch (e) { return []; }
    }

    function saveSignedNda(id) {
        const list = getSignedNdas();
        const strId = String(id);
        if (!list.includes(strId)) {
            list.push(strId);
            const userId = userData ? userData.id : 'anonymous';
            localStorage.setItem(`dealchat_signed_ndas_sellers_${userId}`, JSON.stringify(list));
        }
    }
});
