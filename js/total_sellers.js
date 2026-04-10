import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';
import { initExternalSharing } from './sharing_utils.js';
import { debounce, escapeHtml, applyKeywordsMasking, maskWithCircles } from './utils.js';
import { renderPagination } from './pagination_utils.js';
import { 
    getIndustryIcon, 
    addSelectedUser, 
    renderSelectedTags, 
    initShareUserSearch, 
    submitShareHandler, 
    fetchFiles,
    initUserMap,
    renderListLoader
} from './my_list_utils.js';
import { getSignedNdas as utilsGetSignedNdas, saveSignedNda as utilsSaveSignedNda } from './nda_utils.js';

// 프로필 모달 스크립트 로드
const script = document.createElement('script');
script.src = '../js/profile_modal.js';
document.head.appendChild(script);

const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 8;
let allSellers = [];
let filteredSellers = [];
let userMap = {};
let currentuser_id = null;
let currentUserData = null;
window.currentShareSellerId = null;
let selectedReceivers = [];
let signedNdaIds = []; // Supabase에서 가져온 NDA 체결 ID 목록

// ==========================================
// NDA 체결 상태 관리
// ==========================================
// NDA 관련 함수는 nda_utils.js에서 제공하는 래퍼 함수로 대체
function getSignedNdas() {
    return utilsGetSignedNdas('seller', currentuser_id);
}

function saveSignedNda(sellerId) {
    utilsSaveSignedNda('seller', sellerId, currentuser_id);
}

$(document).ready(function () {
    currentUserData = checkAuth();
    if (!currentUserData) return;
    const user_id = currentUserData.id;
    currentuser_id = user_id;

    // [RBAC] 매수자 등급 보안 설정: 드래그 및 우클릭 금지
    if (currentUserData.role === 'buyer') {
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

    // Header profile and menu are now initialized globally by header_loader.js

    loadInitialData();

    // ==========================================
    // Event Handlers
    // ==========================================

    // Search
    $('#search-icon-btn').on('click', () => { currentPage = 1; loadSellers(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadSellers(); }
    });

    // Filter Toggle

    // Filter Change Events
    $(document).on('change', '.industry-checkbox, .method-checkbox, .visibility-checkbox, #include-negotiable', () => {
        currentPage = 1;
        applyFilters();
    });
    $('#filter-min-price, #filter-max-price').on('input', debounce(() => {
        currentPage = 1;
        applyFilters();
    }, 300));

    // Reset Filters
    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .method-checkbox, .visibility-checkbox').prop('checked', false);
        $('#include-negotiable').prop('checked', true);
        $('#filter-min-price, #filter-max-price').val('');
        applyFilters();
    });

    // Sort Options
    $(document).on('click', '.sort-option', function (e) {
        e.preventDefault();
        $('.sort-option').removeClass('active');
        $(this).addClass('active');
        const label = $(this).text();
        $('#current-sort-label').text(label);
        const sortType = $(this).data('sort');
        applySort(sortType);
    });

    // CSV Export
    $('#export-csv-btn').on('click', exportToCSV);

    // 외부 공유 및 단순 URL 복사 초기화
    initExternalSharing('seller', '#8b5cf6');

    // --- Share Search ---
    initShareUserSearch({
        inputSelector: '#share-user-search',
        resultsSelector: '#user-search-results',
        getUserMap: () => userMap,
        getSelectedReceivers: () => selectedReceivers,
        onSelect: (id, name) => {
            selectedReceivers = addSelectedUser(selectedReceivers, id, name, () => localRenderSelectedTags());
        }
    });

    $('#btn-submit-share').on('click', function () {
        submitShareHandler({
            itemId: window.currentShareSellerId,
            itemType: 'seller',
            senderId: currentuser_id,
            selectedReceivers: selectedReceivers,
            btnElement: this,
            supabaseEndpoint: SUPABASE_ENDPOINT,
            onSuccess: () => {
                alert(`${selectedReceivers.length}명의 팀원에게 공유되었습니다.`);
                bootstrap.Modal.getInstance(document.getElementById('share-modal')).hide();
            }
        });
    });

    $('#btn-share-with-user-trigger').on('click', function () {
        const modalEl = document.getElementById('share-options-modal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        const shareModalEl = document.getElementById('share-modal');
        const shareModal = new bootstrap.Modal(shareModalEl);
        shareModal.show();
    });

    // 외부 공유 초기화
    initExternalSharing('seller', '#8b5cf6');
});


// ==========================================
// Data Loading
// ==========================================

async function loadInitialData() {
    $('#seller-list-container').html(renderListLoader(8, '#8b5cf6'));
    try {
        userMap = await initUserMap(_supabase);
        const { data: sellers, error: sError } = await _supabase.from('sellers').select('*, companies(*)').is('deleted_at', null);
        if (sError) throw sError;

        allSellers = Array.isArray(sellers) ? sellers.map(parseSellerData).sort((a, b) => {
            const dateA = new Date(b.updated_at || b.created_at || 0);
            const dateB = new Date(a.updated_at || a.created_at || 0);
            return dateA - dateB;
        }) : [];
        updateFilterOptions();
        applyFilters();
    } catch (error) {
        console.error('Initial Load Error:', error);
        $('#seller-list-container').html('<div class="col-12 text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</div>');
    } finally {
        hideLoader();
    }
}

// fetchUsers, getIndustryIcon, fetchSellers 중복 함수 제거

function loadSellers() {
    _supabase.from('sellers').select('*, companies(*)').is('deleted_at', null)
        .then(res => {
            const data = res?.data || res;
            if (res.error) throw res.error;
            allSellers = Array.isArray(data) ? data.map(parseSellerData).sort((a, b) => {
                const dateA = new Date(b.updated_at || b.created_at || 0);
                const dateB = new Date(a.updated_at || a.created_at || 0);
                return dateA - dateB;
            }) : [];
            updateFilterOptions();
            applyFilters();
        })
        .catch(error => {
            console.error('Reload Error:', error);
            $('#seller-list-container').html('<div class="col-12 text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</div>');
        });
}

function parseSellerData(s) {
    if (!s) return null;
    const parsed = { ...s };
    parsed.company_name = s.name || s.company_name || s.companyName || (s.companies && s.companies.name) || "정보 없음";
    parsed.user_id = s.user_id || s.user_id || null;
    parsed.industry = s.industry || (s.companies && s.companies.industry) || '기타';
    parsed.summary = s.summary || (s.companies && s.companies.summary) || "";
    parsed.matching_price = s.matching_price || s.sale_price || null;

    // Status mapping (resilience)
    if (parsed.status) {
        const validStatuses = ['대기', '진행중', '완료'];
        if (!validStatuses.includes(parsed.status)) {
            // Mapping English or other values to Korean if needed
            if (parsed.status === 'pending' || parsed.status === 'waiting') parsed.status = '대기';
            else if (parsed.status === 'ongoing' || parsed.status === 'progress') parsed.status = '진행중';
            else if (parsed.status === 'completed' || parsed.status === 'done') parsed.status = '완료';
            else parsed.status = '대기';
        }
    } else {
        parsed.status = '대기';
    }
    return parsed;
}

// ==========================================
// Rendering
// ==========================================

function renderSellers() {
    const container = $('#seller-list-container');
    container.empty();

    if (filteredSellers.length === 0) {
        container.html('<tr><td colspan="8" class="text-center py-5 text-muted">일치하는 매도자 정보가 없습니다.</td></tr>');
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredSellers.length);
    const pageItems = filteredSellers.slice(startIndex, endIndex);

    const signedNdas = getSignedNdas();

    pageItems.forEach(seller => {
        const createdDate = new Date(seller.created_at || Date.now());
        const updatedDate = seller.updated_at ? new Date(seller.updated_at) : null;
        const d = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
        const dateDisplay = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;

        const authorData = userMap[seller.user_id] || DEFAULT_MANAGER;
        
        const status = seller.status || '대기';
        const isRestricted = (status === '진행중' || status === '완료');
        
        const statusStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f5f3ff; color: #8b5cf6; border: 1px solid #ddd6fe;";
            
        const industryStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f5f3ff; color: #8b5cf6; border: 1px solid #ddd6fe;";

        const isOwner = String(seller.user_id) === String(currentuser_id);
        const isSigned = signedNdaIds.includes(String(seller.id)) || signedNdas.includes(String(seller.id));
        const isAuthorized = isOwner || isSigned;

        const isNameBlinded = (seller.is_blind_active && seller.blind_personal?.name);
        
        let displayName = (seller.company_name || '정보 없음');
        if (status === '완료') {
            displayName = '완료';
        } else if (status === '진행중') {
            displayName = '진행중';
        } else if (isNameBlinded) {
            displayName = 'Blind';
        }

        let displaySummary = seller.summary || "";

        // 본문 마스킹 (키워드 기반)
        if (seller.is_blind_active && seller.blind_keywords) {
            displaySummary = applyKeywordsMasking(displaySummary, seller.blind_keywords);
        }

        // 이름 블라인드 시 본문의 이름도 마스킹
        if (isNameBlinded && seller.company_name) {
            const escapedName = seller.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            displaySummary = displaySummary.replace(nameRegex, (match) => maskWithCircles(match));
        }

        // 진행상황에 따른 스타일
        const isPriceNegotiable = !seller.matching_price || seller.matching_price === '협의';
        const priceDisplay = isPriceNegotiable ? (seller.matching_price || '협의') : `${seller.matching_price}억`;
        const priceColor = isRestricted ? "#94a3b8" : "#000000";

        const rowHtml = `
            <tr onclick="showSellerDetail('${seller.id}')" style="cursor: pointer; ${isRestricted ? 'background-color: #fbfcfd;' : ''}">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3" style="min-width: 0;">
                        <div class="company-icon-square" style="width: 36px; height: 36px; background: ${isRestricted ? '#cbd5e1' : '#8b5cf6'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 10px rgba(139, 92, 246, ${isRestricted ? '0.1' : '0.2'});">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${!isAuthorized ? 'lock' : getIndustryIcon(seller.industry)}</span>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            ${(!isAuthorized && !isRestricted)
                                ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#8b5cf6;background:#f5f3ff;border:1px solid #8b5cf633;border-radius:8px;padding:3px 10px;white-space:nowrap;"><span class="material-symbols-outlined" style="font-size:14px;">lock</span>NDA 필요</span>`
                                : `<span class="fw-bold text-truncate" style="display: block; font-size: 14px; ${isRestricted ? 'color: #94a3b8;' : 'color: #1e293b;'}">${escapeHtml(displayName)}</span>`
                            }
                        </div>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap; ${industryStyle}">${escapeHtml(seller.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: ${priceColor}; font-size: 14px;">${priceDisplay}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="status-tag-td" style="font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 6px; ${statusStyle}">${escapeHtml(status)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td">${escapeHtml(displaySummary)}</div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; overflow: hidden; cursor: pointer;" onclick="event.stopPropagation(); showProfileModal('${seller.user_id}')">
                    <div class="author-td" style="${isRestricted ? 'color: #94a3b8;' : ''}">
                        <img src="${resolveAvatarUrl(authorData.avatar, 1)}" alt="Avatar" class="author-avatar-sm" style="${isRestricted ? 'filter: grayscale(1); opacity: 0.6;' : ''}">
                        <div class="author-info-wrap">
                            <div class="author-name-td" style="color: #000000; font-weight: 700; ${isRestricted ? 'color: #94a3b8;' : ''}">${escapeHtml(authorData.name)}</div>
                            <div class="author-affiliation-td" style="${isRestricted ? 'color: #cbd5e1;' : ''}">${escapeHtml(authorData.affiliation)}</div>
                        </div>
                    </div>
                </td>
                <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; font-size: 13px; color: #94a3b8; font-family: 'Outfit', sans-serif;">${dateDisplay}</td>
                <td style="padding: 20px 24px !important; text-align: center !important; vertical-align: middle !important; white-space: nowrap;" onclick="event.stopPropagation();">
                    ${(isRestricted || !isAuthorized || currentUserData.role === 'buyer') ? '' : `
                    <button class="row-action-btn" style="margin-left: 0;" title="매도자 공유하기" onclick="openShareModal('${seller.id}')">
                        <span class="material-symbols-outlined" style="font-size: 18px;">share</span>
                    </button>
                    `}
                </td>
            </tr>
        `;
        container.append(rowHtml);
    });
}

// ==========================================
// Detail Modal
// ==========================================

window.showSellerDetail = function (id) {
    const seller = allSellers.find(s => String(s.id) === String(id));
    if (!seller) return;

    const authorData = userMap[seller.user_id] || DEFAULT_MANAGER;
    const createdDate = new Date(seller.created_at || Date.now());
    const updatedDate = seller.updated_at ? new Date(seller.updated_at) : null;
    const d_detail = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `최종 수정: ${d_detail.getFullYear()}.${String(d_detail.getMonth()+1).padStart(2,'0')}.${String(d_detail.getDate()).padStart(2,'0')} ${String(d_detail.getHours()).padStart(2,'0')}:${String(d_detail.getMinutes()).padStart(2,'0')}`
        : `등록일: ${d_detail.getFullYear()}.${String(d_detail.getMonth()+1).padStart(2,'0')}.${String(d_detail.getDate()).padStart(2,'0')} ${String(d_detail.getHours()).padStart(2,'0')}:${String(d_detail.getMinutes()).padStart(2,'0')}`;

    const isOwner = String(seller.user_id) === String(currentuser_id);
    const localSigned = getSignedNdas();
    const isSigned = signedNdaIds.includes(String(seller.id)) || localSigned.includes(String(seller.id));
    const isAuthorized = isOwner || isSigned;

    const isNameBlinded = (seller.is_blind_active && seller.blind_personal?.name);
    const status = seller.status || '대기';

    let displayName = (seller.company_name || '정보 없음');
    if (status === '완료') {
        displayName = '완료';
    } else if (status === '진행중') {
        displayName = '진행중';
    } else if (!isAuthorized) {
        displayName = 'NDA 필요';
    } else if (isNameBlinded) {
        displayName = 'Blind';
    }

    let displaySummary = seller.summary || "";
    let memo = seller.manager_memo || seller.managerMemo || "";

    // 본문 마스킹 (키워드 기반)
    if (seller.is_blind_active && seller.blind_keywords) {
        displaySummary = applyKeywordsMasking(displaySummary, seller.blind_keywords);
        if (memo) memo = applyKeywordsMasking(memo, seller.blind_keywords);
    }

    // 이름 블라인드 또는 NDA 미체결 시 본문의 이름도 마스킹
    if ((isNameBlinded || !isAuthorized) && seller.company_name) {
        const escapedName = seller.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(escapedName, 'gi');
        displaySummary = displaySummary.replace(nameRegex, (match) => maskWithCircles(match));
    }

    const isPriceNegotiable = !seller.matching_price || seller.matching_price === '협의';
    const priceDisplay = isPriceNegotiable ? (seller.matching_price || '정보 없음') : `${seller.matching_price}억`;

    const isRestricted = (status === '진행중' || status === '완료');

    $('#detail-seller-icon').text(getIndustryIcon(seller.industry));
    $('#detail-seller-name').text(displayName);
    $('#detail-seller-price').text(priceDisplay);
    $('#detail-seller-status').text(status);
    
    $('#detail-seller-summary').css('filter', 'none');
    $('#detail-seller-memo').css('filter', 'none');
    $('#btn-go-to-dealbook').prop('disabled', false).css({'opacity': '1', 'background': '#8b5cf6'}).text('자세히 보기');

    if (isRestricted) {
        $('#detail-seller-summary').text(displaySummary);
        $('#detail-seller-memo').parent().hide();
        $('#btn-go-to-dealbook').prop('disabled', true).css({'opacity': '0.5', 'background': '#64748b'});
        $('#btn-go-to-dealbook').text(status === '진행중' ? '거래 진행 중' : '거래 완료');
    } else {
        $('#detail-seller-summary').text(displaySummary);
        if (isAuthorized && memo) {
            $('#detail-seller-memo').text(memo).css('color', '#475569').parent().show();
        } else if (!isAuthorized && memo) {
            $('#detail-seller-memo').text('NDA 체결 후 열람 가능한 정보입니다.').css('color', '#94a3b8').parent().show();
        } else {
            $('#detail-seller-memo').text('').parent().hide();
        }
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (seller.industry) {
        let displayIndustry = seller.industry;
        if (seller.industry.startsWith('기타: ')) {
            displayIndustry = seller.industry.replace('기타: ', '');
        }
        industryContainer.append(`<span class="industry-tag-td" style="background:#f5f3ff; color:#8b5cf6; border:1px solid #8b5cf633;">${escapeHtml(displayIndustry)}</span>`);
    }

    const authorDisplayName = authorData.name;
    $('#detail-author-name').text(authorDisplayName);
    const authorSubInfo = authorData.affiliation || 'DealChat';
    $('#detail-author-affiliation').text(authorSubInfo);
    $('#detail-author-avatar').attr('src', resolveAvatarUrl(authorData.avatar, 1));
    
    // 상세 모달 작성자 클릭 비활성화 (요청에 따라 제거)
    $('#detail-author-info-box').css('cursor', 'default').off('click');
    $('#detail-author-name').css('color', '#1e293b').css('font-weight', '700');
    
    $('#detail-modified-date').text(dateDisplay);

    const currentUserName = currentUserData?.name || currentUserData?.email?.split('@')[0] || '사용자';
    $('#logged-in-user-name').text(currentUserName);

    $('#btn-go-to-dealbook').off('click').on('click', () => {
        if (isRestricted) {
            if (status === '진행중') alert('현재 거래가 진행 중입니다.');
            else alert('거래가 완료되었습니다.');
            return;
        }

        // NDA 체결 여부와 상관없이 상세 페이지(Dealbook)로 이동합니다.
        // 상세 페이지의 리포트 모드에서 NDA 게이트가 작동하게 됩니다.
        $('#transition-loader').css('display', 'flex');
        setTimeout(() => {
            location.href = `./dealbook_sellers.html?id=${encodeURIComponent(id)}&from=totalseller`;
        }, 600);
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('seller-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

window.openShareModal = function (sellerId) {
    window.currentShareSellerId = sellerId;
    const seller = allSellers.find(s => String(s.id) === String(sellerId));
    if (!seller) return;

    // 초기화
    selectedReceivers = [];
    localRenderSelectedTags();
    $('#share-memo').val('');

    // 외부 공유용 입력 필드 초기화
    $('#ext-share-recipient').val('');
    $('#ext-share-org').val('');
    $('#ext-share-reason').val('');

    // Fetch files associated with the seller's company and the seller itself
    const companyId = seller.company_id || (seller.companies && seller.companies.id);
    fetchFiles({
        supabase: _supabase,
        entityType: 'seller',
        entityId: sellerId,
        companyId: companyId
    });

    const modalEl = document.getElementById('share-options-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
};

function localRenderSelectedTags() {
    renderSelectedTags({
        containerSelector: '#selected-users-container',
        selectedReceivers: selectedReceivers,
        userMap: userMap,
        theme: { bgColor: '#eef2ff', textColor: '#8b5cf6', borderColor: '#8b5cf6' },
        onRemove: (id) => {
            selectedReceivers = selectedReceivers.filter(uid => uid !== id);
            localRenderSelectedTags();
        }
    });
}


// ==========================================
// Filters & Sort
// ==========================================

function updateFilterOptions() {
    const $industryList = $('#filter-industry-list');
    const selectedIndustries = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const categories = ["AI", "IT·정보통신", "SaaS·솔루션", "게임", "공공·국방", "관광·레저", "교육·에듀테크", "금융·핀테크", "농축수산·어업", "라이프스타일", "모빌리티", "문화예술·콘텐츠", "바이오·헬스케어", "부동산", "뷰티·패션", "에너지·환경", "외식·음료·소상공인", "우주·항공", "유통·물류", "제조·건설", "플랫폼·커뮤니티", "기타"];
    $industryList.empty();
    categories.forEach(ind => {
        const isChecked = selectedIndustries.includes(ind) ? 'checked' : '';
        $industryList.append(`<div class="filter-item"><input type="checkbox" class="btn-check industry-checkbox" id="filter-ind-${ind}" value="${ind}" ${isChecked} autocomplete="off"><label class="industry-checkbox-label" for="filter-ind-${ind}">${ind}</label></div>`);
    });
}

function applyFilters() {
    const selectedIndustries = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const selectedStatuses = $('.method-checkbox:checked').map(function () { return this.value; }).get();
    const selectedVisibility = $('.visibility-checkbox:checked').map(function () { return this.value; }).get();
    const keyword = ($('#search-input').val() || "").trim().toLowerCase();
    const minPrice = parseFloat($('#filter-min-price').val()) || 0;
    const maxPrice = parseFloat($('#filter-max-price').val()) || Infinity;
    const includeNegotiable = $('#include-negotiable').is(':checked');

    filteredSellers = allSellers.filter(seller => {
        // [1] 공개된 것만 노출 - 비공개(is_draft: true)는 무조건 필터링
        if (seller.is_draft) return false;

        // [2] 키워드 필터
        const matchesKeyword = !keyword ||
            (seller.company_name && seller.company_name.toLowerCase().includes(keyword)) ||
            (seller.industry && seller.industry.toLowerCase().includes(keyword)) ||
            (seller.summary && seller.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        // [3] 산업 필터
        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.includes(seller.industry);
        if (!matchesIndustry) return false;

        // [4] 진행현황 필터
        const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(seller.status);
        if (!matchesStatus) return false;

        // [5] 공개여부 필터 (NDA 진행/미진행)
        const isOwner = String(seller.user_id) === String(currentuser_id);
        const localSigned = getSignedNdas();
        const isSigned = signedNdaIds.includes(String(seller.id)) || localSigned.includes(String(seller.id));
        const isAuthorized = isOwner || isSigned;

        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'public') return isAuthorized; // NDA 진행 (대기 포함)
            if (v === 'private') return !isAuthorized; // NDA 미진행
            return true;
        });
        if (!matchesVisibility) return false;


        // [7] 가격 필터 (범위 + 협의포함)
        const price = parseFloat(seller.matching_price);
        const isNegotiable = !seller.matching_price || seller.matching_price === '협의' || isNaN(price);
        
        let matchesPrice = false;
        if (isNegotiable) {
            // 협의 항목: 기본가 범위 미지정 시에는 항상 표시, 범위 지정 시에는 '협의 포함' 체크 시에만 표시
            if (minPrice === 0 && maxPrice === Infinity) {
                matchesPrice = true;
            } else {
                matchesPrice = includeNegotiable;
            }
        } else {
            // 가격 항목: 범위 내에 있을 때 표시
            matchesPrice = (price >= minPrice && price <= maxPrice);
        }

        return matchesPrice;
    });

    // 현재 정렬 유지
    const currentSort = $('.sort-option.active').data('sort') || 'latest';
    applySort(currentSort, false);

    currentPage = 1;
    renderSellers();
    renderPagination({
        totalItems: filteredSellers.length,
        itemsPerPage: itemsPerPage,
        currentPage: currentPage,
        onPageChange: (p) => {
            currentPage = p;
            renderSellers();
        },
        scrollToSelector: '.search-and-actions'
    });
}

function applySort(type, shouldRender = true) {
    if (type === 'latest') {
        filteredSellers.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    } else if (type === 'oldest') {
        filteredSellers.sort((a, b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at));
    } else if (type === 'name_asc') {
        filteredSellers.sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "", 'ko-KR'));
    } else if (type === 'name_desc') {
        filteredSellers.sort((a, b) => (b.company_name || "").localeCompare(a.company_name || "", 'ko-KR'));
    } else if (type === 'price_desc') {
        filteredSellers.sort((a, b) => (parseFloat(String(b.matching_price || b.sale_price || 0).replace(/,/g, '')) || 0) - (parseFloat(String(a.matching_price || a.sale_price || 0).replace(/,/g, '')) || 0));
    } else if (type === 'price_asc') {
        filteredSellers.sort((a, b) => (parseFloat(String(a.matching_price || a.sale_price || 0).replace(/,/g, '')) || 0) - (parseFloat(String(b.matching_price || b.sale_price || 0).replace(/,/g, '')) || 0));
    }

    if (shouldRender) {
        currentPage = 1;
        renderSellers();
        renderPagination({
            totalItems: filteredSellers.length,
            itemsPerPage: itemsPerPage,
            currentPage: currentPage,
            onPageChange: (p) => {
                currentPage = p;
                renderSellers();
            },
            scrollToSelector: '.search-and-actions'
        });
    }
}

// ==========================================
// CSV Export
// ==========================================

function exportToCSV() {
    if (filteredSellers.length === 0) { alert('내보낼 데이터가 없습니다.'); return; }
    
    const signedNdas = getSignedNdas();
    const headers = ['매도자명', '산업', '진행 상황', '가격(억)', '요약', '담당자', '등록일'];
    
    const rows = filteredSellers.map(s => {
        const isOwner = String(s.user_id) === String(currentuser_id);
        const localSigned = getSignedNdas();
        const isSigned = signedNdaIds.includes(String(s.id)) || localSigned.includes(String(s.id));
        const isAuthorized = isOwner || isSigned;
        const status = s.status || '대기';
        const isRestricted = (status === '진행중' || status === '완료');

        const isNameBlinded = (s.is_blind_active && s.blind_personal?.name);
        
        // 마스킹 조건: 진행현황(완료/진행중)이 최우선, 그 다음이 작성자의 기업명 블라인드 체크
        let company_name = (s.company_name || '');
        if (status === '완료') {
            company_name = '완료';
        } else if (status === '진행중') {
            company_name = '진행중';
        } else if (!isAuthorized) {
            company_name = 'NDA 필요';
        } else if (isNameBlinded) {
            company_name = 'Blind';
        }
        
        let summary = s.summary || '';
        
        // 키워드 마스킹
        if (s.is_blind_active && s.blind_keywords) {
            summary = applyKeywordsMasking(summary, s.blind_keywords);
        }

        // 이름 블라인드 또는 NDA 미체결 시 본문의 이름도 마스킹
        if ((isNameBlinded || !isAuthorized) && s.company_name) {
            const escapedName = s.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            summary = summary.replace(nameRegex, (match) => maskWithCircles(match));
        }

        const author = userMap[s.user_id]?.name || 'Unknown';
        const date = (() => { const d = new Date(s.created_at); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; })();
        
        const shouldMaskPrice = !isAuthorized;
        const price = shouldMaskPrice ? '-' : (s.matching_price || s.sale_price || '');
        
        return [
            company_name, 
            s.industry || '', 
            status, 
            price, 
            summary, 
            author, 
            date
        ].map(field => `"${String(field).replace(/"/g, '""')}"`);
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DealChat_Sellers_All_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
