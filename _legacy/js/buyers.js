import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let allBuyers = [];
let userMap = {};
let filteredBuyers = [];
let currentuser_id = null;

// ==========================================
// NDA Timeline State
// ==========================================
let ndaLogs = [];
let currentNdaSort = 'newest';

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
    const userData = checkAuth();
    if (!userData) return;
    const user_id = userData.id;
    currentuser_id = user_id;

    updateHeaderProfile(userData);
    initUserMenu();

    loadInitialData(user_id);

    // ==========================================
    // Event Handlers
    // ==========================================

    // Search
    $('#search-btn').on('click', () => { currentPage = 1; loadBuyers(user_id); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadBuyers(user_id); }
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

    // New Buyer Button
    $('#new-btn').on('click', () => { location.href = './buyer.html?id=new'; });

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

    // NDA Timeline Button
    $('#inbox-btn').on('click', function () {
        fetchNdaTimeline();
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('inbox-modal'));
        modal.show();
    });

    // NDA Timeline Sort
    $(document).on('click', '.inbox-sort-option', function (e) {
        e.preventDefault();
        const sortType = $(this).data('sort');
        const text = $(this).text();
        currentNdaSort = sortType;
        $('#current-inbox-sort').text(text);
        $('.inbox-sort-option').removeClass('active');
        $(this).addClass('active');
        renderNdaTimeline();
    });
});

// ==========================================
// Data Loading
// ==========================================

function loadInitialData(user_id) {
    $('#buyer-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border" role="status" style="color: #0d9488 !important;"><span class="visually-hidden">Loading...</span></div></td></tr>');

    Promise.all([
        fetchUsers(),
        fetchBuyers(user_id)
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

        // NDA ??꾨씪???곗씠??珥덇린 濡쒕뱶
        fetchNdaTimeline();
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

function fetchBuyers(user_id) {
    const keyword = ($('#search-input').val() || "").trim();
    return APIcall({ action: 'get', table: 'buyers', user_id: user_id, keyword: keyword }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

function parseBuyerData(b) {
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

function loadBuyers(user_id) {
    fetchBuyers(user_id)
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

    pageItems.forEach(buyer => {
        const createdDate = new Date(buyer.created_at || Date.now());
        const updatedDate = buyer.updated_at ? new Date(buyer.updated_at) : null;
        const d = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
        const dateDisplay = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;

        const authorData = userMap[buyer.user_id] || { name: 'Unknown', affiliation: 'DealChat' };

        const rowHtml = `
            <tr onclick="showBuyerDetail('${buyer.id}')" style="cursor: pointer;">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3">
                        <div class="company-icon-square" style="width: 36px; height: 36px; background: #0d9488; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 10px rgba(13, 148, 136, 0.2);">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${getIndustryIcon(buyer.industry)}</span>
                        </div>
                        <span class="seller-name-td">${escapeHtml(buyer.companyName)}</span>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap;">${escapeHtml(buyer.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: #0d9488; font-size: 14px;">${buyer.price ? `${buyer.price}?? : '-'}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 600; color: #475569; font-size: 13px;">${escapeHtml(buyer.status || '?湲?)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td">${escapeHtml(buyer.summary)}</div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; white-space: nowrap;">
                    <div class="author-td">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}" alt="Avatar" class="author-avatar-sm">
                        <div style="line-height: 1.2;">
                            <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${escapeHtml(authorData.name)}</div>
                            <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(authorData.affiliation)}</div>
                        </div>
                    </div>
                </td>
                <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; font-size: 13px; color: #94a3b8; font-family: 'Outfit', sans-serif;">${dateDisplay}</td>
                <td style="padding: 20px 24px !important; text-align: center !important; vertical-align: middle !important; white-space: nowrap;" onclick="event.stopPropagation();">
                    <button class="row-action-btn" style="margin-left: 0;" title="매수자 공유하기" onclick="openShareModal('${buyer.id}')">
                        <span class="material-symbols-outlined" style="font-size: 18px;">share</span>
                    </button>
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
    const d = (updatedDate && updatedDate.getTime() !== createdDate.getTime()) ? updatedDate : createdDate;
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `최종 수정: ${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        : `등록일: ${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    $('#detail-buyer-icon').text(getIndustryIcon(buyer.industry));
    $('#detail-buyer-name').text(buyer.companyName);
    $('#detail-buyer-price').text(buyer.price ? `${buyer.price} ?듭썝` : '?뺣낫 ?놁쓬');
    $('#detail-buyer-status').text(buyer.status || '?湲?);
    $('#detail-buyer-summary').text(buyer.summary);

    const memo = buyer.managerMemo || buyer.manager_memo || "";
    if (memo) {
        $('#detail-buyer-memo').text(memo).parent().show();
    } else {
        $('#detail-buyer-memo').text('').parent().hide();
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (buyer.industry) {
        industryContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px; color: #0d9488 !important; background-color: rgba(13, 148, 136, 0.1) !important;">#${escapeHtml(buyer.industry)}</span>`);
    }

    $('#detail-author-name').text(authorData.name);
    $('#detail-author-affiliation').text(authorData.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}`);
    $('#detail-buyer-date').text(dateDisplay);

    $('#edit-buyer-btn').off('click').on('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('buyer-detail-modal')).hide();
        editBuyer(buyer.id);
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('buyer-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

let currentShareBuyerId = null;
let selectedReceivers = [];

window.openShareModal = function (buyerId) {
    const buyer = allBuyers.find(b => String(b.id) === String(buyerId));
    if (!buyer) return;

    currentShareBuyerId = buyerId;
    const optionsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-options-modal'));

    // ??먯뿉寃?吏곸젒 怨듭쑀
    $('#btn-share-with-user-trigger').off('click').on('click', () => {
        optionsModal.hide();
        setTimeout(() => openUserShareModal(buyerId), 300);
    });

    // URL 蹂듭궗
    $('#btn-share-url').off('click').on('click', () => {
        const baseUrl = window.location.origin + window.location.pathname.replace('buyers.html', 'buyers.html');
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

window.openUserShareModal = function (buyerId) {
    const buyer = allBuyers.find(b => String(b.id) === String(buyerId));
    if (!buyer) return;

    selectedReceivers = [];
    const $container = $('#selected-users-container');
    const $input = $('#share-user-search');
    const $results = $('#user-search-results');

    $container.html('<span class="text-muted p-1" style="font-size: 13px;">?대쫫?쇰줈 ??먯쓣 寃?됲븯?몄슂.</span>');
    $input.val('');
    $results.hide();
    $('#share-memo').val('');

    $input.off('input').on('input', function () {
        const query = $(this).val().trim().toLowerCase();
        if (!query) {
            $results.hide();
            return;
        }

        const matches = Object.keys(userMap).filter(uid => {
            if (selectedReceivers.includes(uid)) return false;
            const user = userMap[uid];
            return user.name.toLowerCase().includes(query) || user.affiliation.toLowerCase().includes(query);
        });

        if (matches.length > 0) {
            $results.empty().show();
            matches.forEach(uid => {
                const user = userMap[uid];
                const item = $(`
                    <div class="user-search-item p-2 border-bottom" style="cursor: pointer; transition: background 0.2s;">
                        <div class="fw-bold" style="font-size: 14px;">${escapeHtml(user.name)}</div>
                        <div class="text-muted" style="font-size: 12px;">${escapeHtml(user.affiliation)}</div>
                    </div>
                `);
                item.on('mouseenter', function () { $(this).css('background', '#f1f5f9'); })
                    .on('mouseleave', function () { $(this).css('background', 'transparent'); });
                item.on('click', () => {
                    addUserToSelection(uid);
                    $input.val('');
                    $results.hide();
                });
                $results.append(item);
            });
        } else {
            $results.html('<div class="p-3 text-muted text-center" style="font-size: 13px;">?쇱튂?섎뒗 異붿쿇 硫ㅻ쾭媛 ?놁뒿?덈떎.</div>').show();
        }
    });

    function addUserToSelection(uid) {
        if (selectedReceivers.includes(uid)) return;
        selectedReceivers.push(uid);
        renderSelectedTags();
    }

    function renderSelectedTags() {
        if (selectedReceivers.length === 0) {
            $container.html('<span class="text-muted p-1" style="font-size: 13px;">?대쫫?쇰줈 ??먯쓣 寃?됲븯?몄슂.</span>');
            return;
        }
        $container.empty();
        selectedReceivers.forEach(uid => {
            const user = userMap[uid];
            const tag = $(`
                <div class="badge d-flex align-items-center gap-2 p-2"
                    style="background: #0d9488; color: white; border-radius: 8px; font-weight: 500; font-size: 13px;">
                    ${escapeHtml(user.name)}
                    <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">close</span>
                </div>
            `);
            tag.find('span').on('click', (e) => {
                e.stopPropagation();
                selectedReceivers = selectedReceivers.filter(id => id !== uid);
                renderSelectedTags();
            });
            $container.append(tag);
        });
    }

    $('#btn-submit-share').off('click').on('click', function () {
        submitShare(buyerId, this);
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-modal'));
    modal.show();
};

function submitShare(buyerId, btnElement) {
    const memo = $('#share-memo').val().trim();

    if (selectedReceivers.length === 0) {
        alert('怨듭쑀????먯쓣 ??紐??댁긽 ?좏깮??二쇱꽭??');
        return;
    }

    const $btn = $(btnElement);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('전송 중...');

    const sharePromises = selectedReceivers.map(uid => {
        const payload = {
            table: 'shared_buyers', // Assuming shared_buyers table
            action: 'create',
            buyer_id: buyerId,
            sender_id: currentuser_id,
            receiver_id: uid,
            memo: memo,
            is_read: false
        };
        return APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(response => response.json());
    });

    Promise.all(sharePromises)
        .then(results => {
            const errors = results.filter(r => r.error);
            if (errors.length > 0) {
                alert(`${errors.length}嫄댁쓽 怨듭쑀 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.`);
            } else {
                alert(`${selectedReceivers.length}紐낆쓽 ??먯뿉寃?怨듭쑀?섏뿀?듬땲??`);
                bootstrap.Modal.getInstance(document.getElementById('share-modal')).hide();
            }
        })
        .catch(error => {
            console.error('Share Error:', error);
            alert('공유 요청이 실패했습니다.');
        })
        .finally(() => {
            $btn.prop('disabled', false).text(originalText);
        });
}

// ==========================================
// Delete / Edit
// ==========================================

window.deleteBuyer = function (id) {
    if (!confirm('?뺣쭚濡???諛붿씠???뺣낫瑜???젣?섏떆寃좎뒿?덇퉴?')) return;

    APIcall({ table: 'buyers', action: 'delete', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(response => response.json())
        .then(result => {
            if (result.error) alert('??젣 以??ㅻ쪟 諛쒖깮: ' + result.error);
            else {
                alert('??젣?섏뿀?듬땲??');
                allBuyers = allBuyers.filter(b => b.id !== id);
                applyFilters();
            }
        })
        .catch(error => { console.error('Delete Error:', error); alert('??젣 ?붿껌 ?ㅽ뙣'); });
};


window.editBuyer = function (id) {
    location.href = './buyer.html?id=' + id;
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
        if (buyer.user_id !== currentuser_id) return false;

        const matchesKeyword = !keyword ||
            (buyer.companyName && buyer.companyName.toLowerCase().includes(keyword)) ||
            (buyer.industry && buyer.industry.toLowerCase().includes(keyword)) ||
            (buyer.summary && buyer.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.includes(buyer.industry);
        if (!matchesIndustry) return false;

        const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(buyer.status);
        if (!matchesStatus) return false;

        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'private') return buyer.share_type === 'private';
            if (v === 'public') return buyer.share_type === 'public';
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
            filteredBuyers.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko-KR'));
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
    const headers = ['諛붿씠?대챸', '?곗뾽', '吏꾪뻾 ?꾪솴', '媛?⑹옄湲??듭썝)', '?붿빟', '?대떦??硫붾え', '?대떦??, '?깅줉??];
    const rows = filteredBuyers.map(b => {
        const author = userMap[b.user_id]?.name || 'Unknown';
        const d = new Date(b.created_at);
        const date = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
        return [b.companyName || '', b.industry || '', b.status || '', b.price || '', b.summary || '', b.manager_memo || b.managerMemo || '', author, date].map(field => `"${String(field).replace(/"/g, '""')}"`);
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DealChat_Buyers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// NDA Timeline Logic
// ==========================================

window.fetchNdaTimeline = function () {
    if (!currentuser_id) return;

    APIcall({ table: 'nda_logs', action: 'get' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json())
        .then(res => {
            const data = res?.data || res;
            if (Array.isArray(data)) {
                const myBuyerIds = allBuyers.map(b => String(b.id));
                // Assuming nda_logs uses 'seller_id' as a generic'id' for both buyers and sellers in this simple setup
                // or we check 'buyer_id' if it exists. Let's check for log.buyer_id || log.seller_id
                ndaLogs = data.filter(log => myBuyerIds.includes(String(log.buyer_id || log.seller_id)));
                renderNdaTimeline();
            }
        })
        .catch(err => console.warn('NDA ??꾨씪???곗씠??議고쉶瑜??ㅽ뙣?덉뒿?덈떎.', err));
};

function renderNdaTimeline() {
    const $list = $('#inbox-list');
    $list.empty();

    let items = [...ndaLogs];
    items.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return currentNdaSort === 'oldest' ? dateA - dateB : dateB - dateA;
    });

    if (items.length === 0) {
        $list.append(`<div class="text-center text-muted py-5" style="font-size: 14px; background: white; border-radius: 12px; border: 1px dashed #e2e8f0;">NDA 체결 및 열람 내역이 없습니다.</div>`);
        return;
    }

    items.forEach(item => {
        const viewerInfo = userMap[item.user_id] || { name: '?????놁쓬', affiliation: '' };
        const buyerId = item.buyer_id || item.seller_id;
        const buyerInfo = allBuyers.find(b => String(b.id) === String(buyerId));
        const buyerName = buyerInfo ? buyerInfo.companyName : '??젣??諛붿씠??;
        const industry = buyerInfo ? buyerInfo.industry : '湲고?';
        
        const d_signed = new Date(item.created_at);
        const signedDate = `${d_signed.getFullYear()}.${String(d_signed.getMonth()+1).padStart(2,'0')}.${String(d_signed.getDate()).padStart(2,'0')} ${String(d_signed.getHours()).padStart(2,'0')}:${String(d_signed.getMinutes()).padStart(2,'0')}`;
        const d_viewed = item.viewed_at ? new Date(item.viewed_at) : d_signed;
        const viewedDate = `${d_viewed.getFullYear()}.${String(d_viewed.getMonth()+1).padStart(2,'0')}.${String(d_viewed.getDate()).padStart(2,'0')} ${String(d_viewed.getHours()).padStart(2,'0')}:${String(d_viewed.getMinutes()).padStart(2,'0')}`;

        const truncatedName = (viewerInfo.name || '').length > 4 ? (viewerInfo.name || '').substring(0, 4) + '..' : (viewerInfo.name || '');

        const html = `
            <div class="inbox-row d-flex align-items-center px-3 py-3 mb-2"
                style="border-radius: 16px; border: 1px solid #eef2f6; background: #ffffff; cursor: default; transition: all 0.2s;">

                <div style="width: 24%;" class="d-flex align-items-center gap-2">
                    <div style="width: 32px; height: 32px; background: #f0fdfa; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-symbols-outlined" style="font-size: 18px; color: #0d9488;">${getIndustryIcon(industry)}</span>
                    </div>
                    <div class="text-truncate fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(buyerName)}</div>
                </div>

                <div style="width: 22%;" class="d-flex align-items-center gap-2">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(viewerInfo.name)}"
                        style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid #e2e8f0;">
                    <div class="text-truncate">
                        <div style="font-size: 13px; color: #1e293b; font-weight: 600;">${escapeHtml(truncatedName)}</div>
                        <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(viewerInfo.affiliation)}</div>
                    </div>
                </div>

                <div style="width: 20%; font-size: 13px; color: #475569;">${signedDate}</div>
                <div style="width: 20%; font-size: 13px; color: #94a3b8;">${viewedDate}</div>

                <div style="width: 14%;" class="text-center">
                    <button class="btn btn-sm btn-outline-teal py-1 px-2 d-flex align-items-center justify-content-center mx-auto gap-1" 
                        style="border-radius: 6px; font-size: 12px; border-color: #0d9488; color: #0d9488;"
                        onclick="window.downloadNdaPdf('${item.id}')">
                        <span class="material-symbols-outlined" style="font-size: 16px;">download</span>
                        <span>PDF</span>
                    </button>
                </div>
            </div>
        `;
        $list.append(html);
    });
}

window.downloadNdaPdf = function (logId) {
    const log = ndaLogs.find(l => String(l.id) === String(logId));
    if (!log) { alert('NDA 내역을 찾을 수 없습니다.'); return; }

    const viewerInfo = userMap[log.user_id] || { name: '정보 없음', affiliation: '' };
    const buyerId = log.buyer_id || log.seller_id;
    const buyerInfo = allBuyers.find(b => String(b.id) === String(buyerId)) || { companyName: '정보 없음' };
    const _pd = new Date(log.created_at);
    const signedDate = `${_pd.getFullYear()}.${String(_pd.getMonth()+1).padStart(2,'0')}.${String(_pd.getDate()).padStart(2,'0')} ${String(_pd.getHours()).padStart(2,'0')}:${String(_pd.getMinutes()).padStart(2,'0')}`;

    const pdfHtml = `
        <div style="padding: 60px; font-family: 'Pretendard', sans-serif; color: #333; line-height: 1.6;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 50px;">
                <div>
                    <h1 style="font-size: 28px; font-weight: 800; color: #0d9488; margin: 0; margin-bottom: 10px;">鍮꾨??좎??쎌젙??(NDA)</h1>
                    <p style="font-size: 14px; color: #666; margin: 0;">臾몄꽌踰덊샇: DC-NDA-${log.id.substring(0, 8).toUpperCase()}</p>
                </div>
                <div style="text-align: right;">
                    <h2 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0;">DealChat</h2>
                </div>
            </div>
            
            <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin-bottom: 40px; border: 1px solid #edf2f7;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; width: 100px; font-size: 14px;">???諛붿씠??/td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 700; font-size: 15px;">${buyerInfo.companyName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">?대엺???깅챸</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 700; font-size: 15px;">${viewerInfo.name}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">?뚯냽 湲곌?</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 700; font-size: 15px;">${viewerInfo.affiliation}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; font-size: 14px;">泥닿껐 ?쇱떆</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 700; font-size: 15px;">${signedDate}</td>
                    </tr>
                </table>
            </div>

            <div style="margin-bottom: 40px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 15px; color: #1a1a1a;">?쎌젙 ?댁슜</h3>
                <div style="font-size: 13px; color: #4a5568; text-align: justify;">
                    蹂몄씤(?댄븯 '?섎졊??)? DealChat ?뚮옯?쇱쓣 ?듯빐 ?쒓났諛쏅뒗 ?????諛붿씠?댁뿉 愿???쒕컲 ?뺣낫(?댄븯 '鍮꾨??뺣낫')瑜??대엺?⑥뿉 ?덉뼱 ?ㅼ쓬怨?媛숈씠 ?쎌젙?⑸땲??<br><br>
                    1. (鍮꾨??좎? ?섎Т) ?섎졊?몄? 蹂?鍮꾨??뺣낫瑜??꾧꺽??鍮꾨?濡??좎??섎ŉ, ?뺣낫 ?쒓났?먯쓽 ?쒕㈃ ?숈쓽 ?놁씠 ???먯뿉寃??꾩꽕?섍굅??怨듦컻?섏? ?딆뒿?덈떎.<br>
                    2. (紐⑹쟻 ???ъ슜 湲덉?) ?섎졊?몄? 蹂?鍮꾨??뺣낫瑜??대떦 諛붿씠?댁???嫄곕옒 寃??紐⑹쟻 ?댁쇅???⑸룄濡??ъ슜?섏? ?딆뒿?덈떎.<br>
                    3. (?꾩옄 ?쒕챸???⑤젰) 蹂??쎌젙? ?섎졊?몄씠 ?뚮옯???댁뿉??'?숈쓽 諛??쒕챸' 踰꾪듉???대┃?⑥쑝濡쒖뜥 ?꾩옄臾몄꽌 諛??꾩옄嫄곕옒 湲곕낯踰뺤뿉 ?곕씪 ?곷쾿?섍쾶 泥닿껐??寃껋쑝濡?媛꾩＜?⑸땲??
                </div>
            </div>

            <div style="text-align: center; margin-top: 80px;">
                <p style="font-size: 14px; color: #666; margin-bottom: 30px;">?꾩? 媛숈씠 湲곕챸?좎씤 ?⑸땲??</p>
                <div style="display: flex; justify-content: center; gap: 50px; align-items: flex-end;">
                    <div style="text-align: left;">
                        <p style="font-size: 12px; color: #999; margin-bottom: 5px;">?섎졊??(?꾩옄?쒕챸)</p>
                        <div style="font-family: 'Outfit', cursive; font-size: 24px; color: #1a1a1a; padding: 10px; border-bottom: 2px solid #333;">
                            ${viewerInfo.name}
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 100px; border-top: 1px solid #eee; pt: 20px; text-align: center; font-size: 11px; color: #aaa;">
                蹂?臾몄꽌??DealChat ?쒖뒪?쒖뿉 ?섑빐 ?먮룞 ?앹꽦??蹂댁븞 臾몄꽌?낅땲??
            </div>
        </div>
    `;

    const opt = {
        margin: 0,
        filename: `NDA_${buyerInfo.companyName}_${viewerInfo.name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(pdfHtml).set(opt).save();
};
