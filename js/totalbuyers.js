import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let allBuyers = [];
let userMap = {};
let filteredBuyers = [];
let currentuser_id = null;
let currentUserData = null;

// ==========================================
// NDA 泥닿껐 ?곹깭 愿由?// ==========================================
function getSignedNdas() {
    try {
        const stored = localStorage.getItem(`dealchat_signed_ndas_buyers_${currentuser_id}`);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveSignedNda(buyerId) {
    const signed = getSignedNdas();
    if (!signed.includes(buyerId)) {
        signed.push(buyerId);
        localStorage.setItem(`dealchat_signed_ndas_buyers_${currentuser_id}`, JSON.stringify(signed));
    }
}

// Utility for HTML escaping
function escapeHtml(unsafe) {
    if (!unsafe && unsafe !== 0) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

$(document).ready(function () {
    currentUserData = checkAuth();
    if (!currentUserData) return;
    const user_id = currentUserData.id;
    currentuser_id = user_id;

    updateHeaderProfile(currentUserData);
    initUserMenu();

    loadInitialData();

    // ==========================================
    // Event Handlers
    // ==========================================

    // Search
    $('#search-btn').on('click', () => { currentPage = 1; loadBuyers(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadBuyers(); }
    });

    // Filter Toggle
    $('#filter-toggle-btn').on('click', function () {
        const $container = $('#filter-container');
        const isVisible = $container.is(':visible');
        $container.slideToggle();
        $(this).toggleClass('active', !isVisible);
        if (!isVisible) {
            $(this).css({
                'background-color': '#0d9488',
                'box-shadow': '0 4px 12px rgba(13, 148, 136, 0.2)'
            }).find('span').css('color', 'white');
        } else {
            $(this).css({
                'background-color': '#ffffff',
                'box-shadow': '0 2px 8px rgba(0,0,0,0.05)'
            }).find('span').css('color', '#64748b');
        }
    });

    // Filter Change Events
    $(document).on('change', '.industry-checkbox, .status-checkbox, .visibility-checkbox', () => {
        currentPage = 1;
        applyFilters();
    });
    $('#filter-min-price, #filter-max-price').on('input', () => {
        currentPage = 1;
        applyFilters();
    });

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
});

// ==========================================
// Data Loading
// ==========================================

function loadInitialData() {
    $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border" role="status" style="color: #0d9488 !important;"><span class="visually-hidden">Loading...</span></div></td></tr>');

    Promise.all([
        fetchUsers(),
        fetchBuyers()
    ]).then(([usersRes, buyersRes]) => {
        const users = usersRes?.data || usersRes;
        const buyers = buyersRes?.data || buyersRes;

        userMap = {};
        if (Array.isArray(users)) {
            users.forEach(u => {
                userMap[u.id] = {
                    name: u.name,
                    affiliation: u.company || 'DealChat'
                };
            });
        }

        allBuyers = Array.isArray(buyers) ? buyers.map(parseBuyerData).sort((a, b) => {
            const dateA = new Date(b.updated_at || b.created_at || 0);
            const dateB = new Date(a.updated_at || a.created_at || 0);
            return dateA - dateB;
        }) : [];
        
        updateFilterOptions();
        applyFilters();
        renderPagination();
    }).catch(error => {
        console.error('Initial Load Error:', error);
        $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
    }).finally(() => {
        hideLoader();
    });
}

function fetchUsers() {
    return APIcall({ action: 'get', table: 'users' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

function fetchBuyers() {
    const keyword = ($('#search-input').val() || "").trim();
    // Use empty user_id to fetch all buyers
    return APIcall({ action: 'get', table: 'buyers', user_id: "", keyword: keyword }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

function parseBuyerData(b) {
    if (!b) return null;
    return {
        ...b,
        industry: b.interest_industry || '湲고?',
        price: b.investment_amount || '',
        status: b.status || '?湲?
    };
}

function getIndustryIcon(industry) {
    const iconMap = {
        'AI': 'smart_toy',
        'IT쨌?뺣낫?듭떊': 'computer',
        'SaaS쨌?붾（??: 'cloud',
        '寃뚯엫': 'sports_esports',
        '怨듦났쨌援?갑': 'policy',
        '愿愿뫢룸젅?': 'beach_access',
        '援먯쑁쨌?먮??뚰겕': 'school',
        '湲덉쑖쨌??뚰겕': 'payments',
        '?띉룹엫쨌?댁뾽': 'agriculture',
        '?쇱씠?꾩뒪???: 'person',
        '紐⑤퉴由ы떚': 'directions_car',
        '臾명솕?덉닠쨌肄섑뀗痢?: 'movie',
        '諛붿씠?ㅒ룻뿬?ㅼ???: 'medical_services',
        '遺?숈궛': 'real_estate_agent',
        '酉고떚쨌?⑥뀡': 'content_cut',
        '?먮꼫吏쨌?섍꼍': 'eco',
        '?몄떇?끒룹냼?곴났??: 'restaurant',
        '?곗＜쨌??났': 'rocket',
        '?좏넻쨌臾쇰쪟': 'local_shipping',
        '?쒖“쨌嫄댁꽕': 'factory',
        '?뚮옯?셋룹빱裕ㅻ땲??: 'groups',
        '湲고?': 'person_search'
    };
    return iconMap[industry] || 'person_search';
}

function loadBuyers() {
    fetchBuyers()
        .then(res => {
            const data = res?.data || res;
            if (data.error) throw new Error(data.error);
            allBuyers = Array.isArray(data) ? data.map(parseBuyerData).sort((a, b) => {
                const dateA = new Date(b.updated_at || b.created_at || 0);
                const dateB = new Date(a.updated_at || a.created_at || 0);
                return dateA - dateB;
            }) : [];
            updateFilterOptions();
            applyFilters();
            renderPagination();
        })
        .catch(error => {
            console.error('Reload Error:', error);
            $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
        });
}

// ==========================================
// Rendering
// ==========================================

function renderBuyers() {
    const container = $('#buyer-list-container');
    container.empty();

    if (filteredBuyers.length === 0) {
        container.html('<tr><td colspan="8" class="text-center py-5 text-muted">?쇱튂?섎뒗 諛붿씠???뺣낫媛 ?놁뒿?덈떎.</td></tr>');
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredBuyers.length);
    const pageItems = filteredBuyers.slice(startIndex, endIndex);

    const signedNdas = getSignedNdas();

    pageItems.forEach(buyer => {
        const createdDate = new Date(buyer.created_at || Date.now());
        const updatedDate = buyer.updated_at ? new Date(buyer.updated_at) : null;
        const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
        const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
            ? formatDate(updatedDate)
            : formatDate(createdDate);

        const authorData = userMap[buyer.user_id] || { name: 'Unknown', affiliation: 'DealChat' };

        const status = buyer.status || '?湲?;
        const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
        
        const statusStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f0fdfa; color: #0d9488; border: 1px solid #ccfbf1;";
            
        const industryStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f0fdfa; color: #0d9488;";

        const priceColor = isRestricted ? "#94a3b8" : "#0d9488";

        const isOwner = String(buyer.user_id) === String(currentuser_id);
        const isSigned = signedNdas.includes(String(buyer.id));
        const isAuthorized = isOwner || isSigned;
        const displayName = isAuthorized ? buyer.companyName : '鍮꾧났媛?;
        
        let displaySummary = buyer.summary || "";
        if (!isAuthorized && buyer.companyName) {
            const escapedName = buyer.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            displaySummary = displaySummary.replace(nameRegex, 'OOO');
        }

        const rowHtml = `
            <tr onclick="showBuyerDetail('${buyer.id}')" style="cursor: pointer; ${isRestricted ? 'background-color: #fbfcfd;' : ''}">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3">
                        <div class="company-icon-square" style="width: 36px; height: 36px; background: ${isRestricted ? '#cbd5e1' : '#0d9488'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 10px rgba(13, 148, 136, ${isRestricted ? '0.1' : '0.2'});">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${getIndustryIcon(buyer.industry)}</span>
                        </div>
                        <span class="seller-name-td" style="${isRestricted ? 'color: #94a3b8;' : ''}">${escapeHtml(displayName)}</span>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap; ${industryStyle}">${escapeHtml(buyer.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: ${priceColor}; font-size: 14px;">${isAuthorized ? (buyer.price ? `${buyer.price}?? : '-') : '鍮꾧났媛?}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="status-tag-td" style="font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 6px; ${statusStyle}">${escapeHtml(status)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td">${escapeHtml(displaySummary)}</div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; overflow: hidden;">
                    <div class="author-td" style="${isRestricted ? 'color: #94a3b8;' : ''}">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}" alt="Avatar" class="author-avatar-sm" style="${isRestricted ? 'filter: grayscale(1); opacity: 0.6;' : ''}">
                        <div class="author-info-wrap">
                            <div class="author-name-td" style="${isRestricted ? 'color: #94a3b8;' : ''}">${escapeHtml(authorData.name)}</div>
                            <div class="author-affiliation-td" style="${isRestricted ? 'color: #cbd5e1;' : ''}">${escapeHtml(authorData.affiliation)}</div>
                        </div>
                    </div>
                </td>
                <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; ${isRestricted ? 'color: #94a3b8;' : ''}">${dateDisplay}</td>
                <td style="padding: 20px 24px !important; text-align: center !important; vertical-align: middle !important; white-space: nowrap;" onclick="event.stopPropagation();">
                    ${(isRestricted || !isAuthorized) ? '' : `
                    <button class="row-action-btn" style="margin-left: 0;" title="諛붿씠??怨듭쑀?섍린" onclick="openShareModal('${buyer.id}')">
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
    const buyer = allBuyers.find(b => b.id === id);
    if (!buyer) return;

    const authorData = userMap[buyer.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
    const createdDate = new Date(buyer.created_at || Date.now());
    const updatedDate = buyer.updated_at ? new Date(buyer.updated_at) : null;
    const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `理쒖쥌 ?섏젙: ${formatDate(updatedDate)}`
        : `?깅줉?? ${formatDate(createdDate)}`;

    const signedNdas = getSignedNdas();
    const isOwner = String(buyer.user_id) === String(currentuser_id);
    const isSigned = signedNdas.includes(String(buyer.id));
    const isAuthorized = isOwner || isSigned;
    const displayName = isAuthorized ? buyer.companyName : '鍮꾧났媛?;

    let displaySummary = buyer.summary || "";
    if (!isAuthorized && buyer.companyName) {
        const escapedName = buyer.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(escapedName, 'gi');
        displaySummary = displaySummary.replace(nameRegex, 'OOO');
    }

    $('#detail-buyer-icon').text(getIndustryIcon(buyer.industry));
    $('#detail-buyer-name').text(displayName);
    $('#detail-buyer-price').text(isAuthorized ? (buyer.price ? `${buyer.price}?? : '?뺣낫 ?놁쓬') : '鍮꾧났媛?);
    const status = buyer.status || '?湲?;
    const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
    
    $('#detail-buyer-status').text(status);
    
    $('#detail-buyer-summary').css('filter', 'none');
    $('#detail-buyer-memo').css('filter', 'none');
    $('#btn-go-to-editor').prop('disabled', false).css({'opacity': '1', 'background': '#0d9488'}).text('?먯꽭??蹂닿린');

    if (isRestricted) {
        $('#detail-buyer-summary').text(displaySummary);
        $('#detail-buyer-memo').parent().hide();
        $('#btn-go-to-editor').prop('disabled', true).css({'opacity': '0.5', 'background': '#64748b'});
        $('#btn-go-to-editor').text(status === '吏꾪뻾以? ? '嫄곕옒 吏꾪뻾 以? : '嫄곕옒 ?꾨즺');
    } else {
        $('#detail-buyer-summary').text(displaySummary);
        const memo = buyer.manager_memo || buyer.managerMemo || "";
        if (isAuthorized && memo) {
            $('#detail-buyer-memo').text(memo).parent().show();
        } else if (!isAuthorized && memo) {
            // NDA 泥닿껐 ?꾩뿉??硫붾え 媛由?            $('#detail-buyer-memo').text('NDA 泥닿껐 ???대엺 媛?ν븳 ?뺣낫?낅땲??').css('color', '#94a3b8').parent().show();
        } else {
            $('#detail-buyer-memo').text('').parent().hide();
        }
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (buyer.industry) {
        industryContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px; color: #0d9488 !important; background-color: rgba(13, 148, 136, 0.1) !important;">#${escapeHtml(buyer.industry)}</span>`);
    }

    const truncatedName = (authorData.name || '').length > 4 ? (authorData.name || '').substring(0, 4) + '...' : (authorData.name || '');
    $('#detail-author-name').text(truncatedName);
    $('#detail-author-affiliation').text(authorData.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}`);
    $('#detail-buyer-date').text(dateDisplay);

    const currentUserName = userData?.name || userData?.email?.split('@')[0] || '?ъ슜??;
    $('#logged-in-user-name').text(currentUserName);

    $('#btn-go-to-editor').off('click').on('click', () => {
        if (isOwner) {
            $('#transition-loader').css('display', 'flex');
            setTimeout(() => {
                location.href = `./buyer.html?id=${encodeURIComponent(id)}&from=totalbuyer`;
            }, 600);
            return;
        }

        if (isSigned) {
            APIcall({ table: 'nda_logs', action: 'update_view', user_id: currentuser_id, buyer_id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .catch(e => console.error('Failed to log view', e));

            $('#transition-loader').css('display', 'flex');
            setTimeout(() => {
                location.href = `./buyer.html?id=${encodeURIComponent(id)}&from=totalbuyer`;
            }, 600);
            return;
        }

        $('#nda-signature-name').val('');
        $('#nda-confirmation-text').val('');
        
        const $confirmBtn = $('#btn-confirm-nda');
        $confirmBtn.prop('disabled', true).css('opacity', '0.5');

        const validateNda = () => {
            const signature = $('#nda-signature-name').val().trim();
            const confirmTxt = $('#nda-confirmation-text').val().trim();
            const REQUIRED_TXT = "???ы빆???꾨컲?섏? ?딆쓣 寃껋쓣 ?쎌냽?⑸땲??;
            
            if (signature === currentUserName && confirmTxt === REQUIRED_TXT) {
                $confirmBtn.prop('disabled', false).css('opacity', '1');
            } else {
                $confirmBtn.prop('disabled', true).css('opacity', '0.5');
            }
        };

        $('#nda-signature-name, #nda-confirmation-text').off('input').on('input', validateNda);

        const ndaModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('nda-modal'));
        const detailModal = bootstrap.Modal.getInstance(document.getElementById('buyer-detail-modal'));
        
        detailModal.hide();
        ndaModal.show();

        $('#nda-modal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
            if (!window.ndaSigned && detailModal) detailModal.show();
            window.ndaSigned = false;
        });

        $('#btn-confirm-nda').off('click').on('click', () => {
            const signature = $('#nda-signature-name').val().trim();
            // Validation already done via button state

            window.ndaSigned = true;
            saveSignedNda(id);
            
            APIcall({ table: 'nda_logs', action: 'create', user_id: currentuser_id, buyer_id: id, signature: signature }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .catch(e => console.error('Failed to save NDA log', e));

            ndaModal.hide();
            renderBuyers();

            $('#transition-loader').css('display', 'flex');
            setTimeout(() => {
                location.href = `./buyer.html?id=${encodeURIComponent(id)}&from=totalbuyer`;
            }, 600);
        });
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('buyer-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

window.openShareModal = function (buyerId) {
    const buyer = allBuyers.find(b => String(b.id) === String(buyerId));
    if (!buyer) return;

    const optionsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-options-modal'));

    $('#btn-share-url').off('click').on('click', () => {
        const baseUrl = window.location.origin + window.location.pathname.replace('totalbuyers.html', 'buyers.html');
        const shareUrl = `${baseUrl}?id=${encodeURIComponent(buyerId)}`;

        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('URL???대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            optionsModal.hide();
        }).catch(err => {
            console.error('URL copy failed', err);
            alert('URL 蹂듭궗???ㅽ뙣?덉뒿?덈떎.');
        });
    });

    optionsModal.show();
};

// ==========================================
// Pagination
// ==========================================

function renderPagination() {
    const container = $('#pagination-container');
    container.empty();
    const totalPages = Math.ceil(filteredBuyers.length / itemsPerPage);
    if (totalPages <= 1) return;

    const prevDisabled = currentPage === 1 ? 'disabled' : '';
    container.append(`<button class="btn btn-outline-light pagination-btn" ${prevDisabled} onclick="changePage(1)"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button>`);
    container.append(`<button class="btn btn-outline-light pagination-btn" ${prevDisabled} onclick="changePage(${currentPage - 1})"><span class="material-symbols-outlined">chevron_left</span></button>`);

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        container.append(`<button class="btn btn-outline-light pagination-btn ${activeClass}" onclick="changePage(${i})">${i}</button>`);
    }

    const nextDisabled = currentPage === totalPages ? 'disabled' : '';
    container.append(`<button class="btn btn-outline-light pagination-btn" ${nextDisabled} onclick="changePage(${currentPage + 1})"><span class="material-symbols-outlined">chevron_right</span></button>`);
    container.append(`<button class="btn btn-outline-light pagination-btn" ${nextDisabled} onclick="changePage(${totalPages})"><span class="material-symbols-outlined">keyboard_double_arrow_right</span></button>`);
}

window.changePage = function (page) {
    const totalPages = Math.ceil(filteredBuyers.length / itemsPerPage);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderBuyers();
    renderPagination();
    document.querySelector('.search-and-actions').scrollIntoView({ behavior: 'smooth' });
};

// ==========================================
// Filters & Sort
// ==========================================

function updateFilterOptions() {
    const $industryList = $('#filter-industry-list');
    const selectedIndustries = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const categories = ["AI", "IT쨌?뺣낫?듭떊", "SaaS쨌?붾（??, "寃뚯엫", "怨듦났쨌援?갑", "愿愿뫢룸젅?", "援먯쑁쨌?먮??뚰겕", "湲덉쑖쨌??뚰겕", "?띉룹엫쨌?댁뾽", "?쇱씠?꾩뒪???, "紐⑤퉴由ы떚", "臾명솕?덉닠쨌肄섑뀗痢?, "諛붿씠?ㅒ룻뿬?ㅼ???, "遺?숈궛", "酉고떚쨌?⑥뀡", "?먮꼫吏쨌?섍꼍", "?몄떇?끒룹냼?곴났??, "?곗＜쨌??났", "?좏넻쨌臾쇰쪟", "?쒖“쨌嫄댁꽕", "?뚮옯?셋룹빱裕ㅻ땲??, "湲고?"];
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
        const isMine = buyer.user_id === currentuser_id;
        const isPublic = !buyer.is_temporary;
        if (!isMine && !isPublic) return false;

        const matchesKeyword = !keyword ||
            (buyer.companyName && buyer.companyName.toLowerCase().includes(keyword)) ||
            (buyer.industry && buyer.industry.toLowerCase().includes(keyword)) ||
            (buyer.summary && buyer.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.includes(buyer.industry);
        if (!matchesIndustry) return false;

        const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(buyer.status);
        if (!matchesStatus) return false;

        const signedNdas = getSignedNdas();
        const isSigned = signedNdas.includes(String(buyer.id));
        const isOwner = buyer.user_id === currentuser_id;
        const isAuthorized = isOwner || isSigned;

        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'signed') return isAuthorized;
            if (v === 'unsigned') return !isAuthorized;
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
    renderPagination();
}

function applySort(type, shouldRender = true) {
    switch (type) {
        case 'name':
            filteredBuyers.sort((a, b) => (a.companyName || "").localeCompare(b.companyName || "", 'ko-KR'));
            break;
        case 'price':
            filteredBuyers.sort((a, b) => {
                const aVal = parseFloat(a.price) || 0;
                const bVal = parseFloat(b.price) || 0;
                return bVal - aVal;
            });
            break;
        case 'latest':
        default:
            filteredBuyers.sort((a, b) => {
                const dateA = new Date(a.updated_at || a.created_at);
                const dateB = new Date(b.updated_at || b.created_at);
                return dateB - dateA;
            });
            break;
    }
    if (shouldRender) {
        currentPage = 1;
        renderBuyers();
        renderPagination();
    }
}

// ==========================================
// CSV Export
// ==========================================

function exportToCSV() {
    if (filteredBuyers.length === 0) { alert('?대낫???곗씠?곌? ?놁뒿?덈떎.'); return; }
    const signedNdas = getSignedNdas();
    const headers = ['諛붿씠?대챸', '?곗뾽', '吏꾪뻾 ?꾪솴', '媛?⑹옄湲??듭썝)', '?붿빟', '?대떦??, '?깅줉??];
    const rows = filteredBuyers.map(b => {
        const isOwner = String(b.user_id) === String(currentuser_id);
        const isSigned = signedNdas.includes(String(b.id));
        const status = b.status || '?湲?;
        const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
        const shouldMask = !isOwner && (isRestricted || !isSigned);
        const companyName = shouldMask ? '鍮꾧났媛? : (b.companyName || '');
        let summary = b.summary || '';
        if (shouldMask && b.companyName) {
            const escapedName = b.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            summary = summary.replace(nameRegex, 'OOO');
        }
        const author = userMap[b.user_id]?.name || 'Unknown';
        const date = new Date(b.created_at).toLocaleDateString();
        const price = shouldMask ? '-' : (b.price || '');
        return [companyName, b.industry || '', status, price, summary, author, date].map(field => `"${String(field).replace(/"/g, '""')}"`);
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
