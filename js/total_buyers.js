import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';
import { initExternalSharing } from './sharing_utils.js';
import { debounce, escapeHtml } from './utils.js';
import { renderPagination } from './pagination_utils.js';
import { 
    getIndustryIcon, 
    addSelectedUser, 
    renderSelectedTags, 
    initShareUserSearch, 
    submitShareHandler, 
    fetchFiles,
    initUserMap
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
const itemsPerPage = 15;
let allBuyers = [];
let userMap = {};
let filteredBuyers = [];
let currentuser_id = null;
let currentUserData = null;
window.currentShareBuyerId = null;
let selectedReceivers = [];
let signedNdaIds = []; // Supabase에서 가져온 NDA 체결 ID 목록

// ==========================================
// NDA 체결 상태 관리
// ==========================================
// NDA 관련 함수는 nda_utils.js 활용
function getSignedNdas() {
    return utilsGetSignedNdas('buyer', currentuser_id);
}

function saveSignedNda(buyerId) {
    utilsSaveSignedNda('buyer', buyerId, currentuser_id);
}

$(document).ready(function () {
    currentUserData = checkAuth();
    if (!currentUserData) return;
    const user_id = currentUserData.id;
    currentuser_id = user_id;

    // Header profile and menu are now initialized globally by header_loader.js

    loadInitialData();

    // ==========================================
    // Event Handlers
    // ==========================================

    // Search
    $('#search-icon-btn').on('click', () => { currentPage = 1; loadBuyers(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadBuyers(); }
    });

    // Filter Toggle

    // Filter Change Events
    $(document).on('change', '.industry-checkbox, .status-checkbox, .visibility-checkbox', () => {
        currentPage = 1;
        applyFilters();
    });
    $('#filter-min-price, #filter-max-price').on('input', debounce(() => {
        currentPage = 1;
        applyFilters();
    }, 300));

    // Reset Filters
    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .status-checkbox, .visibility-checkbox').prop('checked', false);
        $('#filter-min-price, #filter-max-price').val('');
        applyFilters();
    });

    // CSV Export
    $('#export-csv-btn').on('click', exportToCSV);

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

    // --- Share Logic ---
    // --- Share Logic ---
    initShareUserSearch({
        inputSelector: '#share-user-search',
        resultsSelector: '#user-search-results',
        userMap: userMap,
        getSelectedReceivers: () => selectedReceivers,
        onSelect: (id, name) => {
            selectedReceivers = addSelectedUser(selectedReceivers, id, name, () => localRenderSelectedTags());
        }
    });

    $('#btn-submit-share').on('click', function () {
        submitShareHandler({
            itemId: window.currentShareBuyerId,
            itemType: 'buyer',
            senderId: currentuser_id,
            selectedReceivers: selectedReceivers,
            btnElement: this,
            supabaseEndpoint: SUPABASE_ENDPOINT,
            onSuccess: () => {
                alert(`${selectedReceivers.length}명의 타인에게 공유되었습니다.`);
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

    // 외부 공유 및 단순 URL 복사 초기화
    // 외부 공유 및 단순 URL 복사 초기화
    initExternalSharing('buyer', '#0d9488');

});

// ==========================================
// Data Loading
// ==========================================

async function loadInitialData() {
    $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border" role="status" style="color: #0d9488 !important;"><span class="visually-hidden">Loading...</span></div></td></tr>');

    try {
        userMap = await initUserMap(_supabase);
        const { data: buyers, error: bError } = await _supabase.from('buyers').select('*');
        if (bError) throw bError;

        allBuyers = Array.isArray(buyers) ? buyers.map(parseBuyerData).sort((a, b) => {
            const dateA = new Date(b.updated_at || b.created_at || 0);
            const dateB = new Date(a.updated_at || a.created_at || 0);
            return dateA - dateB;
        }) : [];
        
        updateFilterOptions();
        applyFilters();
    } catch (error) {
        console.error('Initial Load Error:', error);
        $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>');
    } finally {
        hideLoader();
    }
}

function parseBuyerData(b) {
    if (!b) return null;
    const parsed = { ...b };
    
    // [Resilience] Handle name, company_name, companyName
    parsed.company_name = b.name || b.company_name || b.companyName || "정보 없음";
    parsed.user_id = b.user_id || b.user_id || null;
    parsed.id = b.id;

    // [Resilience] Handle industry mapping
    parsed.industry = b.industry || b.interest_industry || '기타';
    
    // [Resilience] Handle price mapping
    parsed.price = b.price || b.available_funds || b.investment_amount || "";
    
    // [Resilience] Handle status mapping
    parsed.status = b.status || '대기';

    return parsed;
}

// fetchUsers, getIndustryIcon, fetchBuyers 제거

function loadBuyers() {
    _supabase.from('buyers').select('*')
        .then(res => {
            const data = res?.data || res;
            if (res.error) throw res.error;
            allBuyers = Array.isArray(data) ? data.map(parseBuyerData).sort((a, b) => {
                const dateA = new Date(b.updated_at || b.created_at || 0);
                const dateB = new Date(a.updated_at || a.created_at || 0);
                return dateA - dateB;
            }) : [];
            updateFilterOptions();
            applyFilters();
        })
        .catch(error => {
            console.error('Reload Error:', error);
            $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>');
        });
}

// ==========================================
// Rendering
// ==========================================

function renderBuyers() {
    const container = $('#buyer-list-container');
    container.empty();

    if (filteredBuyers.length === 0) {
        container.html('<tr><td colspan="8" class="text-center py-5 text-muted">일치하는 매수자 정보가 없습니다.</td></tr>');
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredBuyers.length);
    const pageItems = filteredBuyers.slice(startIndex, endIndex);

    const signedNdas = getSignedNdas();

    pageItems.forEach(buyer => {
        const createdDate = new Date(buyer.created_at || Date.now());
        const updatedDate = buyer.updated_at ? new Date(buyer.updated_at) : null;
        const d = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
        const dateDisplay = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;

        const authorData = userMap[buyer.user_id] || DEFAULT_MANAGER;

        const status = buyer.status || '대기';
        const isRestricted = (status === '진행중' || status === '완료');
        
        const statusStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f0fdfa; color: #0d9488; border: 1px solid #ccfbf1;";
            
        const industryStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f0fdfa; color: #0d9488; border: 1px solid #ccfbf1;";

        const isOwner = !!(buyer.user_id && currentuser_id && String(buyer.user_id) === String(currentuser_id));
        const isSigned = signedNdaIds.includes(String(buyer.id)) || signedNdas.includes(String(buyer.id));
        const isAuthorized = isOwner || isSigned;
        
        // [진행중/완료] 상태일 때 비공개 처리
        let displayName = isAuthorized ? buyer.company_name : '비공개';
        let displaySummary = buyer.summary || "";

        if (isRestricted) {
            displayName = '비공개';
            displaySummary = (status === '진행중') ? '진행 중인 딜입니다.' : '완료된 딜입니다.';
        } else if (!isAuthorized && buyer.company_name) {
            const escapedName = buyer.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            displaySummary = displaySummary.replace(nameRegex, 'OOO');
        }

        // 가용자금은 상태와 무관하게 노출 (진행중/완료 포함)하되, 상태에 따라 색상 처리
        const displayPrice = (isAuthorized || isRestricted) ? (buyer.price ? `${buyer.price}억` : '-') : '비공개';
        const priceColor = isRestricted ? "#94a3b8" : "#1e293b";

        const rowHtml = `
            <tr onclick="showBuyerDetail('${buyer.id}')" style="cursor: pointer; ${isRestricted ? 'background-color: #fbfcfd;' : ''}">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3" style="min-width: 0;">
                        <div style="width: 36px; height: 36px; background: ${isRestricted ? '#94a3b8' : '#0d9488'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${!isAuthorized ? 'lock' : getIndustryIcon(buyer.industry)}</span>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            ${!isAuthorized
                                ? isRestricted
                                    ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#94a3b8;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:3px 10px;white-space:nowrap;"><span class="material-symbols-outlined" style="font-size:14px;">lock</span>NDA 필요</span>`
                                    : `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#0d9488;background:#f0fdfa;border:1px solid #0d948833;border-radius:8px;padding:3px 10px;white-space:nowrap;"><span class="material-symbols-outlined" style="font-size:14px;">lock</span>NDA 필요</span>`
                                : `<span class="fw-bold text-truncate" style="display: block; font-size: 14px; ${isRestricted ? 'color: #94a3b8;' : 'color: #1e293b;'}">${escapeHtml(displayName)}</span>`
                            }
                        </div>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap; ${industryStyle}">${escapeHtml(buyer.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: ${priceColor}; font-size: 14px;">${displayPrice}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="status-tag-td" style="font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 6px; ${statusStyle}">${escapeHtml(status)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td">${escapeHtml(displaySummary)}</div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; overflow: hidden; cursor: pointer;" onclick="event.stopPropagation(); showProfileModal('${buyer.user_id}')">
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
                    ${(isRestricted || !isAuthorized) ? '' : `
                    <button class="row-action-btn" style="margin-left: 0;" title="매수자 공유하기" onclick="openShareModal('${buyer.id}')">
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

window.showBuyerDetail = function (id) {
    const buyer = allBuyers.find(b => String(b.id) === String(id));
    if (!buyer) return;

    const authorData = userMap[buyer.user_id] || DEFAULT_MANAGER;
    const createdDate = new Date(buyer.created_at || Date.now());
    const updatedDate = buyer.updated_at ? new Date(buyer.updated_at) : null;
    const d_detail = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `최종 수정: ${d_detail.getFullYear()}.${String(d_detail.getMonth()+1).padStart(2,'0')}.${String(d_detail.getDate()).padStart(2,'0')} ${String(d_detail.getHours()).padStart(2,'0')}:${String(d_detail.getMinutes()).padStart(2,'0')}`
        : `등록일: ${d_detail.getFullYear()}.${String(d_detail.getMonth()+1).padStart(2,'0')}.${String(d_detail.getDate()).padStart(2,'0')} ${String(d_detail.getHours()).padStart(2,'0')}:${String(d_detail.getMinutes()).padStart(2,'0')}`;

    const signedNdas = getSignedNdas();
    const isOwner = !!(buyer.user_id && currentuser_id && String(buyer.user_id) === String(currentuser_id));
    const localSigned = getSignedNdas();
    const isSigned = signedNdaIds.includes(String(buyer.id)) || localSigned.includes(String(buyer.id));
    const isAuthorized = isOwner || isSigned;
    const status = buyer.status || '대기';
    const isRestricted = (status === '진행중' || status === '완료');
    
    // [진행중/완료] 상태일 때 비공개 처리
    let displayName = isAuthorized ? buyer.company_name : '비공개';
    let displaySummary = buyer.summary || "";

    if (isRestricted) {
        displayName = '비공개';
        displaySummary = (status === '진행중') ? '진행 중인 딜입니다.' : '완료된 딜입니다.';
    } else if (!isAuthorized && buyer.company_name) {
        const escapedName = buyer.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(escapedName, 'gi');
        displaySummary = displaySummary.replace(nameRegex, 'OOO');
    }

    $('#detail-buyer-icon').text(getIndustryIcon(buyer.industry));
    $('#detail-buyer-name').text(displayName);
    const displayPriceDetail = (isAuthorized || isRestricted) ? (buyer.price ? `${buyer.price}억` : '정보 없음') : '비공개';
    $('#detail-buyer-price').text(displayPriceDetail).css('color', isRestricted ? '#94a3b8' : '#0d9488');
    
    $('#detail-buyer-status').text(status);
    
    $('#detail-buyer-summary').css('filter', 'none');
    $('#detail-buyer-memo').css('filter', 'none');
    $('#btn-go-to-dealbook').prop('disabled', false).css({'opacity': '1', 'background': '#0d9488'}).text('자세히 보기');

    if (isRestricted) {
        $('#detail-buyer-summary').text(displaySummary);
        $('#detail-buyer-memo').parent().hide();
        $('#btn-go-to-dealbook').prop('disabled', true).css({'opacity': '0.5', 'background': '#64748b'});
        $('#btn-go-to-dealbook').text(status === '진행중' ? '거래 진행 중' : '거래 완료');
    } else {
        $('#detail-buyer-summary').text(displaySummary);
        const memo = buyer.manager_memo || buyer.managerMemo || "";
        if (isAuthorized && memo) {
            $('#detail-buyer-memo').text(memo).parent().show();
        } else if (!isAuthorized && memo) {
            // NDA 체결 전에는 메모 가림
            $('#detail-buyer-memo').text('NDA 체결 후 열람 가능한 정보입니다.').css('color', '#94a3b8').parent().show();
        } else {
            $('#detail-buyer-memo').text('').parent().hide();
        }
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (buyer.industry) {
        industryContainer.append(`<span class="industry-tag-td" style="background:#f0fdfa; color:#0d9488; border:1px solid #0d948833;">${escapeHtml(buyer.industry)}</span>`);
    }

    const authorDisplayName = authorData.name || DEFAULT_MANAGER.name;
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
        // NDA 체결 여부와 상관없이 상세 페이지(Dealbook)로 이동합니다.
        // 상세 페이지의 리포트 모드에서 NDA 게이트가 작동하게 됩니다.
        $('#transition-loader').css('display', 'flex');
        setTimeout(() => {
            location.href = `./dealbook_buyers.html?id=${encodeURIComponent(id)}&from=totalbuyer`;
        }, 600);
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('buyer-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

window.openShareModal = function (buyerId) {
    window.currentShareBuyerId = buyerId;
    const buyer = allBuyers.find(b => String(b.id) === String(buyerId));
    if (!buyer) return;

    // 초기화
    selectedReceivers = [];
    localRenderSelectedTags();
    $('#share-memo').val('');

    // 외부 공유용 입력 필드 초기화
    $('#ext-share-recipient').val('');
    $('#ext-share-org').val('');
    $('#ext-share-reason').val('');

    // Fetch files associated with the buyer's company
    const companyId = buyer.company_id || buyer.id; 
    fetchFiles({
        supabase: _supabase,
        entityType: 'buyer',
        entityId: buyerId,
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
        theme: { bgColor: '#eef2ff', textColor: '#0d9488', borderColor: '#0d9488' },
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
    const selectedStatuses = $('.status-checkbox:checked').map(function () { return this.value; }).get();
    const selectedVisibility = $('.visibility-checkbox:checked').map(function () { return this.value; }).get();
    const keyword = ($('#search-input').val() || "").trim().toLowerCase();
    const minPrice = parseFloat($('#filter-min-price').val()) || 0;
    const maxPrice = parseFloat($('#filter-max-price').val()) || Infinity;

    filteredBuyers = allBuyers.filter(buyer => {
        // [1] 공개된 것만 노출 - 비공개(is_draft: true)는 무조건 필터링
        if (buyer.is_draft) return false;

        // [2] 키워드 필터
        const matchesKeyword = !keyword ||
            (buyer.company_name && buyer.company_name.toLowerCase().includes(keyword)) ||
            (buyer.industry && buyer.industry.toLowerCase().includes(keyword)) ||
            (buyer.summary && buyer.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.includes(buyer.industry);
        if (!matchesIndustry) return false;

        const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(buyer.status);
        if (!matchesStatus) return false;

        const localSigned = getSignedNdas();
        const isSigned = signedNdaIds.includes(String(buyer.id)) || localSigned.includes(String(buyer.id));
        const isOwner = !!(buyer.user_id && currentuser_id && String(buyer.user_id) === String(currentuser_id));
        const isAuthorized = isOwner || isSigned;

        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'public') return isAuthorized; // NDA 진행 (대기 포함)
            if (v === 'private') return !isAuthorized; // NDA 미진행
            return true;
        });
        if (!matchesVisibility) return false;


        const price = parseFloat(buyer.price) || 0;
        const matchesPrice = (price === 0 && minPrice === 0) || (price >= minPrice && price <= maxPrice);

        return matchesPrice;
    });

    const currentSort = $('.sort-option.active').data('sort') || 'latest';
    applySort(currentSort, false);
    currentPage = 1;
    renderBuyers();
    renderPagination({
        totalItems: filteredBuyers.length,
        itemsPerPage: itemsPerPage,
        currentPage: currentPage,
        onPageChange: (p) => {
            currentPage = p;
            renderBuyers();
        },
        scrollToSelector: '.search-and-actions'
    });
}

function applySort(type, shouldRender = true) {
    if (type === 'latest') {
        filteredBuyers.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    } else if (type === 'oldest') {
        filteredBuyers.sort((a, b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at));
    } else if (type === 'name_asc') {
        filteredBuyers.sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "", 'ko-KR'));
    } else if (type === 'name_desc') {
        filteredBuyers.sort((a, b) => (b.company_name || "").localeCompare(a.company_name || "", 'ko-KR'));
    } else if (type === 'price_desc') {
        filteredBuyers.sort((a, b) => (parseFloat(String(b.price || 0).replace(/,/g, '')) || 0) - (parseFloat(String(a.price || 0).replace(/,/g, '')) || 0));
    } else if (type === 'price_asc') {
        filteredBuyers.sort((a, b) => (parseFloat(String(a.price || 0).replace(/,/g, '')) || 0) - (parseFloat(String(b.price || 0).replace(/,/g, '')) || 0));
    }
    
    if (shouldRender) {
        currentPage = 1;
        renderBuyers();
        renderPagination({
            totalItems: filteredBuyers.length,
            itemsPerPage: itemsPerPage,
            currentPage: currentPage,
            onPageChange: (p) => {
                currentPage = p;
                renderBuyers();
            },
            scrollToSelector: '.search-and-actions'
        });
    }
}

// ==========================================
// CSV Export
// ==========================================

function exportToCSV() {
    if (filteredBuyers.length === 0) { alert('내보낼 데이터가 없습니다.'); return; }
    const signedNdas = getSignedNdas();
    const headers = ['매수자명', '산업', '진행 상황', '가용자금(억)', '요약', '담당자', '등록일'];
    const rows = filteredBuyers.map(b => {
        const isOwner = !!(b.user_id && currentuser_id && String(b.user_id) === String(currentuser_id));
        const isSigned = signedNdas.includes(String(b.id));
        const status = b.status || '대기';
        const isRestricted = (status === '진행중' || status === '완료');
        const shouldMask = !isOwner && (isRestricted || !isSigned);
        const company_name = shouldMask ? '비공개' : (b.company_name || '');
        let summary = b.summary || '';
        if (shouldMask && b.company_name) {
            const escapedName = b.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            summary = summary.replace(nameRegex, 'OOO');
        }
        const author = userMap[b.user_id]?.name || 'Unknown';
        const date = (() => { const d = new Date(b.created_at); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; })();
        const price = shouldMask ? '-' : (b.price || '');
        return [company_name, b.industry || '', status, price, summary, author, date].map(field => `"${String(field).replace(/"/g, '""')}"`);
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DealChat_Buyers_All_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
