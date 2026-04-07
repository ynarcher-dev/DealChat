import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let totalItems = 0;
let allSellers = [];
let userMap = {};
let filteredSellers = [];
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
    $('#search-btn').on('click', () => { currentPage = 1; loadSellers(user_id); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadSellers(user_id); }
    });

    // Filter Toggle
    $('#filter-toggle-btn').on('click', function () {
        const $container = $('#filter-container');
        const isVisible = $container.is(':visible');
        $container.slideToggle();
        $(this).toggleClass('active', !isVisible);
        if (!isVisible) {
            $(this).css({
                'background-color': '#8b5cf6',
                'box-shadow': '0 4px 12px rgba(139, 92, 246, 0.2)'
            }).find('span').css('color', 'white');
        } else {
            $(this).css({
                'background-color': '#ffffff',
                'box-shadow': '0 2px 8px rgba(0,0,0,0.05)'
            }).find('span').css('color', '#64748b');
        }
    });

    // Filter Change Events
    $(document).on('change', '.industry-checkbox, .method-checkbox, .visibility-checkbox, .negotiable-checkbox', () => {
        currentPage = 1;
        applyFilters();
    });
    $('#filter-min-price, #filter-max-price').on('input', () => {
        currentPage = 1;
        applyFilters();
    });

    // Industry select ??update hidden input icon (panel doesn't have preview, skip)

    // Reset Filters
    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .method-checkbox, .visibility-checkbox, .negotiable-checkbox').prop('checked', false);
        $('#filter-min-price, #filter-max-price').val('');
        applyFilters();
    });

    // New Seller Button
    $('#new-btn').on('click', () => { location.href = './seller_editor.html?id=new'; });

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
    $('#seller-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border" role="status" style="color: #8b5cf6 !important;"><span class="visually-hidden">Loading...</span></div></td></tr>');

    Promise.all([
        fetchUsers(),
        fetchSellers(user_id)
    ]).then(([usersRes, sellersRes]) => {
        const users = usersRes?.data || usersRes;
        const sellers = sellersRes?.data || sellersRes;

        userMap = {};
        if (Array.isArray(users)) {
            users.forEach(u => {
                userMap[u.id] = {
                    name: u.name,
                    affiliation: u.company || 'DealChat'
                };
            });
        }

        allSellers = Array.isArray(sellers) ? sellers.map(parseSellerData).sort((a, b) => {
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
        $('#seller-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
    }).finally(() => {
        hideLoader();
    });
}

function fetchUsers() {
    return APIcall({ action: 'get', table: 'users' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

function fetchSellers(user_id) {
    const keyword = ($('#search-input').val() || "").trim();
    return APIcall({ action: 'get', table: 'sellers', user_id: user_id, keyword: keyword }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
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
        '湲고?': 'storefront'
    };
    return iconMap[industry] || 'storefront';
}

function loadSellers(user_id) {
    fetchSellers(user_id)
        .then(res => {
            const data = res?.data || res;
            if (data.error) throw new Error(data.error);
            allSellers = Array.isArray(data) ? data.map(parseSellerData).sort((a, b) => {
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
            $('#seller-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
        });
}

// ==========================================
// Rendering
// ==========================================

function renderSellers() {
    const container = $('#seller-list-container');
    container.empty();

    if (filteredSellers.length === 0) {
        container.html('<tr><td colspan="8" class="text-center py-5 text-muted">?쇱튂?섎뒗 留ㅻ룄???뺣낫媛 ?놁뒿?덈떎.</td></tr>');
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredSellers.length);
    const pageItems = filteredSellers.slice(startIndex, endIndex);

    pageItems.forEach(seller => {
        const createdDate = new Date(seller.created_at || Date.now());
        const updatedDate = seller.updated_at ? new Date(seller.updated_at) : null;
        const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
        const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
            ? formatDate(updatedDate)
            : formatDate(createdDate);

        const authorData = userMap[seller.user_id] || { name: 'Unknown', affiliation: 'DealChat' };

        const rowHtml = `
            <tr onclick="showSellerDetail('${seller.id}')" style="cursor: pointer;">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3">
                        <div class="company-icon-square" style="width: 36px; height: 36px; background: #8b5cf6; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.2);">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${getIndustryIcon(seller.industry)}</span>
                        </div>
                        <span class="seller-name-td">${escapeHtml(seller.companyName)}</span>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap;">${escapeHtml(seller.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: #8b5cf6; font-size: 14px;">${(seller.matching_price || seller.sale_price) ? ((seller.matching_price || seller.sale_price) === '협의' ? '협의' : (seller.matching_price || seller.sale_price) + '억') : '-'}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 600; color: #475569; font-size: 13px;">${escapeHtml(seller.status || '?湲?)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td">${escapeHtml(seller.summary)}</div>
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
                <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">${dateDisplay}</td>
                <td style="padding: 20px 24px !important; text-align: center !important; vertical-align: middle !important; white-space: nowrap;" onclick="event.stopPropagation();">
                    <button class="row-action-btn" style="margin-left: 0;" title="留ㅻ룄??怨듭쑀?섍린" onclick="openShareModal('${seller.id}')">
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

window.showSellerDetail = function (id) {
    const seller = allSellers.find(s => s.id === id);
    if (!seller) return;

    const authorData = userMap[seller.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
    const createdDate = new Date(seller.created_at || Date.now());
    const updatedDate = seller.updated_at ? new Date(seller.updated_at) : null;
    const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `理쒖쥌 ?섏젙: ${formatDate(updatedDate)}`
        : `?깅줉?? ${formatDate(createdDate)}`;

    $('#detail-seller-icon').text(getIndustryIcon(seller.industry));
    $('#detail-seller-name').text(seller.companyName);
    $('#detail-seller-price').text((seller.matching_price || seller.sale_price) ? ((seller.matching_price || seller.sale_price) === '협의' ? '협의' : (seller.matching_price || seller.sale_price) + '억원') : '정보 없음');
    $('#detail-seller-status').text(seller.status || '?湲?);
    $('#detail-seller-summary').text(seller.summary);

    const memo = seller.managerMemo || seller.manager_memo || "";
    if (memo) {
        $('#detail-seller-memo').text(memo).parent().show();
    } else {
        $('#detail-seller-memo').text('').parent().hide();
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (seller.industry) {
        industryContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px; color: #8b5cf6 !important; background-color: rgba(139, 92, 246, 0.1) !important;">#${escapeHtml(seller.industry)}</span>`);
    }

    $('#detail-author-name').text(authorData.name);
    $('#detail-author-affiliation').text(authorData.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}`);
    $('#detail-seller-date').text(dateDisplay);

    $('#edit-seller-btn').off('click').on('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('seller-detail-modal')).hide();
        editSeller(seller.id);
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('seller-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

let currentShareSellerId = null;
let selectedReceivers = [];

window.openShareModal = function (sellerId) {
    const seller = allSellers.find(s => String(s.id) === String(sellerId));
    if (!seller) {
        console.warn('Share Modal: Seller not found', sellerId);
        return;
    }

    currentShareSellerId = sellerId;
    const optionsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-options-modal'));

    // ??먯뿉寃?吏곸젒 怨듭쑀
    $('#btn-share-with-user-trigger').off('click').on('click', () => {
        optionsModal.hide();
        setTimeout(() => openUserShareModal(sellerId), 300);
    });

    // URL 蹂듭궗
    $('#btn-share-url').off('click').on('click', () => {
        const baseUrl = window.location.origin + window.location.pathname.replace('sellers.html', 'sellers.html');
        const shareUrl = `${baseUrl}?id=${encodeURIComponent(sellerId)}`;

        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('URL???대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            optionsModal.hide();
        }).catch(err => {
            console.error('URL copy failed', err);
            const tempInput = document.createElement('input');
            tempInput.value = shareUrl;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
            alert('URL???대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            optionsModal.hide();
        });
    });

    optionsModal.show();
};

window.openUserShareModal = function (sellerId) {
    const seller = allSellers.find(s => String(s.id) === String(sellerId));
    if (!seller) return;

    selectedReceivers = [];
    const $container = $('#selected-users-container');
    const $input = $('#share-user-search');
    const $results = $('#user-search-results');

    // --- File Fetching Logic (Added) ---
    const $fileArea = $('#share-file-selection-area');
    const $fileList = $('#share-file-selection-list');
    if ($fileArea.length) {
        $fileArea.hide();
        $fileList.empty().append('<div class="text-muted p-1" style="font-size: 13px;">파일을 불러오는 중...</div>');

        APIcall({
            action: 'get',
            table: 'files',
            company_id: seller.company_id || seller.id
        }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json())
        .then(data => {
            const files = Array.isArray(data) ? data : (data.Items || []);
            $fileList.empty();
            if (files.length > 0) {
                files.forEach(file => {
                    const fileHtml = `
                        <div class="form-check p-1 ms-4" style="border-bottom: 1px solid #f1f5f9;">
                            <input class="form-check-input share-file-checkbox" type="checkbox" value="${file.id}" id="file-${file.id}">
                            <label class="form-check-label d-flex align-items-center gap-2" for="file-${file.id}" style="font-size: 13px; cursor: pointer;">
                                <span class="material-symbols-outlined text-secondary" style="font-size: 18px;">description</span>
                                <span class="text-truncate" style="max-width: 250px;">${escapeHtml(file.file_name)}</span>
                            </label>
                        </div>
                    `;
                    $fileList.append(fileHtml);
                });
                $fileArea.show();
            } else {
                $fileList.append('<div class="text-muted p-1" style="font-size: 13px;">불러올 수 있는 파일이 없습니다.</div>');
                $fileArea.hide();
            }
        })
        .catch(err => {
            console.error('Fetch Files Error:', err);
            $fileList.html('<div class="text-danger p-1" style="font-size: 13px;">파일 로드 실패</div>');
        });
    }

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
            $results.html('<div class="p-3 text-muted text-center" style="font-size: 13px;">?쇱튂?섎뒗 異붿쿇 硫ㅻ쾭媛 ?없뒿?덈떎.</div>').show();
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
                    style="background: #8b5cf6; color: white; border-radius: 8px; font-weight: 500; font-size: 13px;">
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
        submitShare(sellerId, this);
    });

    $(document).off('click.userSearch').on('click.userSearch', function (e) {
        if (!$(e.target).closest('.position-relative').length) {
            $results.hide();
        }
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-modal'));
    modal.show();
};

function submitShare(sellerId, btnElement) {
    const memo = $('#share-memo').val().trim();

    const selectedFileIds = $('.share-file-checkbox:checked').map(function() {
        return $(this).val();
    }).get();

    if (selectedReceivers.length === 0) {
        alert('怨듭쑀????먯쓣 ??紐??댁긽 ?좏깮??二쇱꽭??');
        return;
    }

    const $btn = $(btnElement);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('?꾩넚 以?..');

    const sharePromises = selectedReceivers.map(uid => {
        const payload = {
            table: 'shared_sellers',
            action: 'create',
            seller_id: sellerId,
            sender_id: currentuser_id,
            receiver_id: uid,
            memo: memo,
            file_ids: selectedFileIds, // Added file selection
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
            alert('怨듭쑀 ?붿껌???ㅽ뙣?덉뒿?덈떎: ' + (error.message || '?????녿뒗 ?ㅻ쪟'));
        })
        .finally(() => {
            $btn.prop('disabled', false).text(originalText);
        });
}

// ==========================================
// Delete / Edit
// ==========================================

window.deleteSeller = function (id) {
    if (!confirm('?뺣쭚濡???留ㅻ룄???뺣낫瑜???젣?섏떆寃좎뒿?덇퉴?')) return;

    APIcall({ table: 'sellers', action: 'delete', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(response => response.json())
        .then(result => {
            if (result.error) alert('??젣 以??ㅻ쪟 諛쒖깮: ' + result.error);
            else {
                alert('??젣?섏뿀?듬땲??');
                allSellers = allSellers.filter(s => s.id !== id);
                applyFilters();
            }
        })
        .catch(error => { console.error('Delete Error:', error); alert('??젣 ?붿껌 ?ㅽ뙣'); });
};


window.editSeller = function (id) {
    location.href = './seller_editor.html?id=' + id;
};


// ==========================================
// Pagination
// ==========================================

function renderPagination() {
    const container = $('#pagination-container');
    container.empty();

    const totalPages = Math.ceil(filteredSellers.length / itemsPerPage);
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
    const totalPages = Math.ceil(filteredSellers.length / itemsPerPage);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderSellers();
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
    const selectedMethods = $('.method-checkbox:checked').map(function () { return this.value; }).get();
    const selectedVisibility = $('.visibility-checkbox:checked').map(function () { return this.value; }).get();
    const includeNegotiable = $('.negotiable-checkbox').is(':checked');
    const keyword = ($('#search-input').val() || "").trim().toLowerCase();
    const minPrice = parseFloat($('#filter-min-price').val()) || 0;
    const maxPrice = parseFloat($('#filter-max-price').val()) || Infinity;

    filteredSellers = allSellers.filter(seller => {
        // [1] ???곗씠?곕쭔 (湲곕낯 議곌굔)
        if (seller.user_id !== currentuser_id) return false;

        // [2] ?ㅼ썙???꾪꽣
        const matchesKeyword = !keyword ||
            (seller.companyName && seller.companyName.toLowerCase().includes(keyword)) ||
            (seller.industry && seller.industry.toLowerCase().includes(keyword)) ||
            (seller.summary && seller.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        // [3] ?곗뾽 ?꾪꽣
        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.includes(seller.industry);
        if (!matchesIndustry) return false;

        // [4] 吏꾪뻾?꾪솴 ?꾪꽣
        const matchesMethod = selectedMethods.length === 0 || selectedMethods.includes(seller.status);
        if (!matchesMethod) return false;

        // [5] 怨듦컻?щ? ?꾪꽣
        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'private') return seller.is_temporary === true;
            if (v === 'public') return !seller.is_temporary;
            return true;
        });
        if (!matchesVisibility) return false;

        // [6] 가격 필터 (범위 + 협의포함)
        const price = parseFloat(seller.matching_price || seller.sale_price);
        const isNegotiable = !(seller.matching_price || seller.sale_price) || (seller.matching_price || seller.sale_price) === '협의' || isNaN(price);
        
        let matchesPrice = false;
        if (isNegotiable) {
            // 협의 항목: '협의 포함' 체크 시에만 표시
            matchesPrice = includeNegotiable;
        } else {
            // 媛寃???ぉ: 踰붿쐞 ?댁뿉 ?덉쓣 ???쒖떆
            matchesPrice = (price >= minPrice && price <= maxPrice);
        }

        return matchesPrice;
    });

    // ?꾩옱 ?뺣젹 ?ъ쟻??    const currentSort = $('.sort-option.active').data('sort') || 'latest';
    applySort(currentSort, false);

    currentPage = 1;
    renderSellers();
    renderPagination();
}

function applySort(type, shouldRender = true) {
    switch (type) {
        case 'name':
            filteredSellers.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko-KR'));
            break;
        case 'price':
            filteredSellers.sort((a, b) => {
                const aVal = parseFloat(a.matching_price || a.sale_price) || 0;
                const bVal = parseFloat(b.matching_price || b.sale_price) || 0;
                return bVal - aVal;
            });
            break;
        case 'latest':
        default:
            filteredSellers.sort((a, b) => {
                const dateA = new Date(a.updated_at || a.created_at);
                const dateB = new Date(b.updated_at || b.created_at);
                return dateB - dateA;
            });
            break;
    }

    if (shouldRender) {
        currentPage = 1;
        renderSellers();
        renderPagination();
    }
}

// ==========================================
// CSV Export
// ==========================================

function exportToCSV() {
    if (filteredSellers.length === 0) { alert('?대낫???곗씠?곌? ?놁뒿?덈떎.'); return; }
    const headers = ['留ㅻ룄?먮챸', '?곗뾽', '吏꾪뻾 ?꾪솴', '媛寃??듭썝)', '?붿빟', '?대떦??硫붾え', '?대떦??, '?깅줉??];
    const rows = filteredSellers.map(s => {
        const author = userMap[s.user_id]?.name || 'Unknown';
        const date = new Date(s.created_at).toLocaleDateString();
        return [s.companyName || '', s.industry || '', s.status || '', s.matching_price || s.sale_price || '', s.summary || '', s.manager_memo || '', author, date].map(field => `"${String(field).replace(/"/g, '""')}"`);
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DealChat_Sellers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// Inbox (?섏떊??/ 諛쒖떊?? Logic
// ==========================================

// ==========================================
// NDA Timeline Logic
// ==========================================

window.fetchNdaTimeline = function () {
    if (!currentuser_id) return;

    // 紐⑤뱺 nda_logs瑜?媛?몄삩 ?? ??留ㅻ룄??湲(allSellers)?????寃껊쭔 ?꾪꽣留?    const payload = {
        table: 'nda_logs',
        action: 'get'
    };

    APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json())
        .then(res => {
            const data = res?.data || res;
            if (Array.isArray(data)) {
                // ??留ㅻ룄??ID 紐⑸줉
                const mySellerIds = allSellers.map(s => String(s.id));
                // ??湲?????濡쒓렇留??꾪꽣留?                ndaLogs = data.filter(log => mySellerIds.includes(String(log.seller_id)));
                renderNdaTimeline();
            }
        })
        .catch(err => {
            console.warn('NDA ??꾨씪???곗씠??議고쉶瑜??ㅽ뙣?덉뒿?덈떎.', err);
        });
};

function renderNdaTimeline() {
    const $list = $('#inbox-list');
    $list.empty();

    let items = [...ndaLogs];

    // ?뺣젹
    items.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return currentNdaSort === 'oldest' ? dateA - dateB : dateB - dateA;
    });

    if (items.length === 0) {
        $list.append(`<div class="text-center text-muted py-5" style="font-size: 14px; background: white; border-radius: 12px; border: 1px dashed #e2e8f0;">NDA 泥닿껐 諛??대엺 ?댁뿭???놁뒿?덈떎.</div>`);
        return;
    }

    items.forEach(item => {
        const viewerInfo = userMap[item.user_id] || { name: '?????놁쓬', affiliation: '' };
        const sellerInfo = allSellers.find(s => String(s.id) === String(item.seller_id));
        const sellerName = sellerInfo ? sellerInfo.companyName : '??젣??留ㅻ룄??;
        const industry = sellerInfo ? sellerInfo.industry : '湲고?';
        
        const signedDate = new Date(item.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const viewedDate = item.viewed_at 
            ? new Date(item.viewed_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            : signedDate; // ?대엺 ?뺣낫媛 ?놁쑝硫?泥닿껐?쇨낵 ?숈씪?섍쾶 ?쒖떆

        const html = `
            <div class="inbox-row d-flex align-items-center px-3 py-3 mb-2"
                style="border-radius: 16px; border: 1px solid #eef2f6; background: #ffffff; cursor: default; transition: all 0.2s;">

                <!-- Seller Column (24%) -->
                <div style="width: 24%;" class="d-flex align-items-center gap-2">
                    <div style="width: 32px; height: 32px; background: #f5f3ff; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-symbols-outlined" style="font-size: 18px; color: #8b5cf6;">${getIndustryIcon(industry)}</span>
                    </div>
                    <div class="text-truncate fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(sellerName)}</div>
                </div>

                <!-- Viewer Column (22%) -->
                <div style="width: 22%;" class="d-flex align-items-center gap-2">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(viewerInfo.name)}"
                        style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid #e2e8f0;">
                    <div class="text-truncate">
                        <div style="font-size: 13px; color: #1e293b; font-weight: 600;">${escapeHtml(viewerInfo.name)}</div>
                        <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(viewerInfo.affiliation)}</div>
                    </div>
                </div>

                <!-- Signed Date Column (20%) -->
                <div style="width: 20%; font-size: 13px; color: #475569;">
                    ${signedDate}
                </div>

                <!-- Last Viewed Column (20%) -->
                <div style="width: 20%; font-size: 13px; color: #94a3b8;">
                    ${viewedDate}
                </div>

                <!-- PDF Column (14%) -->
                <div style="width: 14%;" class="text-center">
                    <button class="btn btn-sm btn-outline-primary py-1 px-2 d-flex align-items-center justify-content-center mx-auto gap-1" 
                        style="border-radius: 6px; font-size: 12px; border-color: #8b5cf6; color: #8b5cf6;"
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
    if (!log) {
        alert('NDA ?댁뿭??李얠쓣 ???놁뒿?덈떎.');
        return;
    }

    const viewerInfo = userMap[log.user_id] || { name: '?????놁쓬', affiliation: '' };
    const sellerInfo = allSellers.find(s => String(s.id) === String(log.seller_id)) || { companyName: '?뺣낫 ?놁쓬' };
    const signedDate = new Date(log.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const htmlContent = `
        <div style="padding: 60px; font-family: 'Pretendard', sans-serif; color: #1e293b; line-height: 1.6;">
            <div style="text-align: center; margin-bottom: 50px;">
                <h1 style="font-size: 28px; font-weight: 800; color: #1e293b; margin-bottom: 5px;">鍮꾨??좎??뺤빟??(NDA)</h1>
                <p style="font-size: 14px; color: #64748b;">Nondisclosure Agreement</p>
            </div>
            
            <div style="margin-bottom: 30px;">
                <p style="font-size: 15px; margin-bottom: 15px;">蹂??뺤빟?쒕뒗 ?꾨옒????곸뿉 ??섏뿬 湲곕????좎???寃껋쓣 ?뺤빟?섎뒗 臾몄꽌?낅땲??</p>
                <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; margin-bottom: 10px;">
                        <span style="width: 100px; color: #64748b; font-weight: 600;">???由ы룷??</span>
                        <span style="font-weight: 700;">${sellerInfo.companyName}</span>
                    </div>
                </div>
            </div>

            <div style="margin-bottom: 40px; font-size: 14px; color: #475569; text-align: justify;">
                <p style="margin-bottom: 10px;">1. 蹂몄씤? ?곴린 由ы룷?몄뿉 ?ы븿??紐⑤뱺 ?뺣낫(?댄븯 "湲곕??뺣낫")媛 ???먯뿉寃??좎텧?섏? ?딅룄濡?理쒖꽑???ㅽ븯硫? ?ㅼ쭅 寃??紐⑹쟻?쇰줈留??ъ슜??寃껋쓣 ?뺤씤?⑸땲??</p>
                <p style="margin-bottom: 10px;">2. 蹂몄씤? ?쒕㈃ ?숈쓽 ?놁씠 "湲곕??뺣낫"瑜?蹂듭젣, 諛고룷?섍굅???대? ?댁슜?섏뿬 遺?뱁븳 ?대뱷??痍⑦븯吏 ?딆쓣 寃껋쓣 ?쎌냽?⑸땲??</p>
                <p style="margin-bottom: 10px;">3. 蹂??뺤빟 ?꾨컲?쇰줈 ?명븯??諛쒖깮?섎뒗 紐⑤뱺 ?먰빐????섏뿬 踰뺤쟻 梨낆엫??吏?寃껋쓣 ?뺤씤?⑸땲??</p>
            </div>

            <div style="margin-top: 80px; padding-top: 40px; border-top: 1px solid #e2e8f0;">
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <p style="font-size: 15px; margin-bottom: 30px;">${signedDate}</p>
                    <div style="text-align: right;">
                        <p style="margin-bottom: 5px; color: #64748b; font-size: 13px;">?뺤빟??/p>
                        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 20px;">
                            <div style="text-align: right;">
                                <span style="font-size: 18px; font-weight: 700;">${viewerInfo.name}</span>
                                <span style="font-size: 13px; color: #64748b; margin-left: 5px;">(${viewerInfo.affiliation})</span>
                            </div>
                            <div style="width: 120px; text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 5px;">
                                <span style="font-family: 'cursive'; font-size: 24px; color: #8b5cf6;">${log.signature || viewerInfo.name}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 100px; text-align: center;">
                <p style="font-size: 20px; font-weight: 800; color: #8b5cf6; opacity: 0.3; letter-spacing: 5px;">DEALCHAT OFFICIAL</p>
            </div>
        </div>
    `;

    const element = document.createElement('div');
    element.innerHTML = htmlContent;
    document.body.appendChild(element);

    const opt = {
        margin: 0,
        filename: `NDA_${sellerInfo.companyName}_${viewerInfo.name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(element).set(opt).save().then(() => {
        document.body.removeChild(element);
    });
};

// ==========================================
// Helpers
// ==========================================

function parseSellerData(seller) {
    const parsed = { ...seller };
    if (!parsed.status) {
        if (['?湲?, '吏꾪뻾以?, '?꾨즺'].includes(parsed.sale_method)) {
            parsed.status = parsed.sale_method;
            parsed.sale_method = '';
        } else {
            parsed.status = '誘몄???;
        }
    }
    return parsed;
}

