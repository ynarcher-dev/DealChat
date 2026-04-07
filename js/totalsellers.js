import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let allSellers = [];
let userMap = {};
let filteredSellers = [];
let currentuser_id = null;
let currentUserData = null;

// ==========================================
// Inbox State (Disabled in Total View)
// ==========================================
let inboxItems = [];
let outboxItems = [];
let currentInboxTab = 'received';
let currentInboxSort = 'newest';
let selectedInboxItems = new Set();

// NDA 泥닿껐 ?곹깭 愿由?function getSignedNdas() {
    try {
        const stored = localStorage.getItem(`dealchat_signed_ndas_${currentuser_id}`);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveSignedNda(sellerId) {
    const signed = getSignedNdas();
    if (!signed.includes(sellerId)) {
        signed.push(sellerId);
        localStorage.setItem(`dealchat_signed_ndas_${currentuser_id}`, JSON.stringify(signed));
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
    $('#search-btn').on('click', () => { currentPage = 1; loadSellers(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadSellers(); }
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

    // Reset Filters
    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .method-checkbox, .visibility-checkbox, .negotiable-checkbox').prop('checked', false);
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
    $('#seller-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border" role="status" style="color: #8b5cf6 !important;"><span class="visually-hidden">Loading...</span></div></td></tr>');

    Promise.all([
        fetchUsers(),
        fetchSellers("")
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

function fetchSellers() {
    const keyword = ($('#search-input').val() || "").trim();
    // Use empty user_id to fetch all sellers
    return APIcall({ action: 'get', table: 'sellers', user_id: "", keyword: keyword }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
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

function loadSellers() {
    fetchSellers()
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

function parseSellerData(s) {
    if (!s) return null;
    const parsed = { ...s };
    // Basic fields are already in s: companyName, industry, summary, sale_price, sale_method, user_id, created_at, updated_at
    // Migration logic
    // 吏꾪뻾?꾪솴(status) ?쒖???諛??湲?泥섎━
    const validStatuses = ['?湲?, '吏꾪뻾以?, '?꾨즺'];
    if (!parsed.status) {
        // [Migration] sale_method???곹깭媛믪씠 ?ㅼ뼱?덈뒗 寃쎌슦 ???        if (validStatuses.includes(parsed.sale_method)) {
            parsed.status = parsed.sale_method;
            parsed.sale_method = ''; 
        } else {
            parsed.status = '?湲?;
        }
    } else if (!validStatuses.includes(parsed.status)) {
        // 吏?뺣릺吏 ?딆? ?곹깭媛믪? ?꾨? '?湲? 泥섎━
        parsed.status = '?湲?;
    }
    // In case manager_memo is nested or named differently
    parsed.managerMemo = s.manager_memo || s.managerMemo || "";
    return parsed;
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

        const status = seller.status || '?湲?;
        const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
        
        // ?곗씠?곕젅?대툝(Status, Industry Tag) ?ㅽ????뺤쓽
        const statusStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #fdf2f8; color: #db2777; border: 1px solid #fbcfe8;"; // ?湲??곹깭??湲곗〈怨?李⑤퀎?붾맂 ?됱긽(Pinkish) ?먮뒗 湲곗〈 遺꾩쐞湲??좎?
            
        // ?붿껌?섏떊 '吏꾪뻾以??꾨즺' 由ы룷?몄슜 洹몃젅???ㅼ????곸슜
        const industryStyle = isRestricted 
            ? "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;" 
            : "background: #f5f3ff; color: #8b5cf6;";

        const priceColor = isRestricted ? "#94a3b8" : "#8b5cf6";

        const signedNdas = getSignedNdas();
        const isOwner = String(seller.user_id) === String(currentuser_id);
        const isSigned = signedNdas.includes(String(seller.id));
        
        // 湲곗뾽紐?沅뚰븳 ?뺤씤 (蹂몄씤 ?뱀? NDA 泥닿껐??
        const isAuthorized = isOwner || isSigned;
        const displayName = isAuthorized ? seller.companyName : '鍮꾧났媛?;
        
        // ?붿빟 ?댁쓽 湲곗뾽紐??꾪꽣留?(?먮Ц? ?좎??섎릺 湲곗뾽紐낅쭔 留덉뒪??
        let displaySummary = seller.summary || "";
        if (!isAuthorized && seller.companyName) {
            const escapedName = seller.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            displaySummary = displaySummary.replace(nameRegex, 'OOO');
        }

        const rowHtml = `
            <tr onclick="showSellerDetail('${seller.id}')" style="cursor: pointer; ${isRestricted ? 'background-color: #fbfcfd;' : ''}">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-3">
                        <div class="company-icon-square" style="width: 36px; height: 36px; background: ${isRestricted ? '#cbd5e1' : '#8b5cf6'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 10px rgba(139, 92, 246, ${isRestricted ? '0.1' : '0.2'});">
                            <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${getIndustryIcon(seller.industry)}</span>
                        </div>
                        <span class="seller-name-td" style="${isRestricted ? 'color: #94a3b8;' : ''}">${escapeHtml(displayName)}</span>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="industry-tag-td" style="white-space: nowrap; ${industryStyle}">${escapeHtml(seller.industry)}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-weight: 700; color: ${priceColor}; font-size: 14px;">${isAuthorized ? (seller.sale_price ? `${seller.sale_price}?? : '-') : '鍮꾧났媛?}</span>
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
                    <button class="row-action-btn" style="margin-left: 0;" title="留ㅻ룄??怨듭쑀?섍린" onclick="openShareModal('${seller.id}')">
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
    const seller = allSellers.find(s => s.id === id);
    if (!seller) return;

    const authorData = userMap[seller.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
    const createdDate = new Date(seller.created_at || Date.now());
    const updatedDate = seller.updated_at ? new Date(seller.updated_at) : null;
    const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `理쒖쥌 ?섏젙: ${formatDate(updatedDate)}`
        : `?깅줉?? ${formatDate(createdDate)}`;

    const signedNdas = getSignedNdas();
    const isOwner = String(seller.user_id) === String(currentuser_id);
    const isSigned = signedNdas.includes(String(seller.id));
    const isAuthorized = isOwner || isSigned;
    const displayName = isAuthorized ? seller.companyName : '鍮꾧났媛?;

    // ?붿빟 ??湲곗뾽紐?留덉뒪??    let displaySummary = seller.summary || "";
    if (!isAuthorized && seller.companyName) {
        const escapedName = seller.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(escapedName, 'gi');
        displaySummary = displaySummary.replace(nameRegex, 'OOO');
    }

    $('#detail-seller-icon').text(getIndustryIcon(seller.industry));
    $('#detail-seller-industry').text(seller.industry || '?뺣낫 ?놁쓬');
    $('#detail-seller-price').text(isAuthorized ? (seller.sale_price ? `${seller.sale_price}?? : '?뺣낫 ?놁쓬') : '鍮꾧났媛?);
    const status = seller.status || '?湲?;
    const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
    
    // 吏꾪뻾 ?꾪솴? ??긽 ?몄텧
    $('#detail-seller-status').text(status);
    
    // UI 珥덇린??    $('#detail-seller-summary').css('filter', 'none');
    $('#detail-seller-memo').css('filter', 'none');
    $('#btn-go-to-dealbook').prop('disabled', false).css({'opacity': '1', 'background': '#8b5cf6'}).text('?먯꽭??蹂닿린');

    if (isRestricted) {
        $('#detail-seller-summary').text(displaySummary).css('filter', 'none');
        $('#detail-seller-memo').parent().hide(); // ?대떦??硫붾え ?뱀뀡 ?꾩껜 ?④?
        $('#btn-go-to-dealbook').prop('disabled', true).css({'opacity': '0.5', 'background': '#64748b'});
        
        if (status === '吏꾪뻾以?) {
            $('#btn-go-to-dealbook').text('嫄곕옒 吏꾪뻾 以?);
        } else {
            $('#btn-go-to-dealbook').text('嫄곕옒 ?꾨즺');
        }
    } else {
        $('#detail-seller-summary').text(displaySummary).css('filter', 'none');
        const memo = seller.managerMemo || seller.manager_memo || "";
        if (isAuthorized && memo) {
            $('#detail-seller-memo').text(memo).parent().show();
        } else if (!isAuthorized && memo) {
            $('#detail-seller-memo').text('NDA 泥닿껐 ???대엺 媛?ν븳 ?뺣낫?낅땲??').css('color', '#94a3b8').parent().show();
        } else {
            $('#detail-seller-memo').text('').parent().hide();
        }
    }

    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (seller.industry) {
        industryContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px; color: #8b5cf6 !important; background-color: rgba(139, 92, 246, 0.1) !important;">#${escapeHtml(seller.industry)}</span>`);
    }

    const truncatedName = (authorData.name || '').length > 4 ? (authorData.name || '').substring(0, 4) + '...' : (authorData.name || '');
    $('#detail-author-name').text(truncatedName);
    $('#detail-author-affiliation').text(authorData.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}`);
    $('#detail-seller-date').text(dateDisplay);

    // ?꾩옱 ?ъ슜???대쫫 ?쒖떆 (NDA??
    const currentUserName = userData?.name || userData?.email?.split('@')[0] || '?ъ슜??;
    $('#logged-in-user-name').text(currentUserName);

    // ?먯꽭??蹂닿린 (Dealbook ?대룞 ??NDA ?몃━嫄?
    $('#btn-go-to-dealbook').off('click').on('click', () => {
        if (isRestricted) {
            if (status === '吏꾪뻾以?) alert('?꾩옱 嫄곕옒媛 吏꾪뻾 以묒엯?덈떎.');
            else alert('嫄곕옒媛 ?꾨즺?섏뿀?듬땲??');
            return;
        }

        if (isOwner) {
            const $loader = $('#transition-loader');
            $loader.css('display', 'flex');
            setTimeout(() => {
                location.href = `./seller_editor.html?id=${encodeURIComponent(id)}&from=totalseller`;
            }, 600);
            return;
        }

        // NDA ?대? 泥닿껐??寃쎌슦 ?대엺 ?대젰 ?낅뜲?댄듃
        if (isSigned) {
            const updatePayload = {
                table: 'nda_logs',
                action: 'update_view', // Assume backend has an action to update viewed_at by user/seller
                user_id: currentuser_id,
                seller_id: id
            };
            APIcall(updatePayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .catch(e => console.error('Failed to log view', e));

            const $loader = $('#transition-loader');
            $loader.css('display', 'flex');
            setTimeout(() => {
                location.href = `./seller_editor.html?id=${encodeURIComponent(id)}&from=totalseller`;
            }, 600);
            return;
        }

        // NDA 紐⑤떖 珥덇린??諛??쒖떆
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
        const sellerDetailModal = bootstrap.Modal.getInstance(document.getElementById('seller-detail-modal'));
        
        if (sellerDetailModal) sellerDetailModal.hide();
        ndaModal.show();

        // NDA 紐⑤떖???ロ옄 ??(?쒕챸?섏? ?딄퀬 痍⑥냼?덉쓣 寃쎌슦) ?곸꽭 紐⑤떖 ?ㅼ떆 ?쒖떆
        $('#nda-modal').off('hidden.bs.modal').on('hidden.bs.modal', function (e) {
            // ?쒕챸 ?깃났 ?쒖뿉???댁감???섏씠吏媛 ?대룞?섎?濡? 痍⑥냼 ?쒖뿉留??곸꽭 紐⑤떖???ㅼ떆 ?꾩썙以띾땲??
            if (!window.ndaSigned && sellerDetailModal) {
                 sellerDetailModal.show();
            }
            window.ndaSigned = false; // ?곹깭 珥덇린??        });

        // NDA ?숈쓽 ?뺤씤 踰꾪듉 ?몃뱾??        $('#btn-confirm-nda').off('click').on('click', () => {
            const signature = $('#nda-signature-name').val().trim();
            // Validation already done via button state

            // ?쒕챸 ?깃났 ?곹깭 湲곕줉
            window.ndaSigned = true;
            saveSignedNda(id); // 濡쒖뺄 ?ㅽ넗由ъ???泥닿껐 ?뺣낫 ???            
            // [異붽?] DB??NDA 泥닿껐 ?댁뿭 濡쒓퉭
            const ndaPayload = {
                table: 'nda_logs',
                action: 'create',
                user_id: currentuser_id,
                seller_id: id,
                signature: signature
            };
            
            APIcall(ndaPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .then(() => console.log('NDA log saved to DB'))
                .catch(e => console.error('Failed to save NDA log', e));

            // ?쒕챸 ?깃났 ??由ы룷?몃줈 ?대룞
            ndaModal.hide();
            
            // UI ?낅뜲?댄듃 (紐⑸줉???대쫫??怨듦컻濡?蹂寃쏀븯湲??꾪빐 由щ젋?붾쭅)
            renderSellers();

            const $loader = $('#transition-loader');
            $loader.css('display', 'flex'); // Show loading overlay
            
            setTimeout(() => {
                location.href = `./seller_editor.html?id=${encodeURIComponent(id)}&from=totalseller`;
            }, 600);
        });
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('seller-detail-modal'));
    modal.show();
};

// ==========================================
// Share Logic
// ==========================================

let currentShareSellerId = null;

window.openShareModal = function (sellerId) {
    const seller = allSellers.find(s => String(s.id) === String(sellerId));
    if (!seller) {
        console.warn('Share Modal: Seller not found', sellerId);
        return;
    }

    currentShareSellerId = sellerId;
    const optionsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-options-modal'));

    // URL 蹂듭궗
    $('#btn-share-url').off('click').on('click', () => {
        // Shared URL points to sellers.html for reading? Usually it might point back to totalsellers or a specific detail view.
        // For consistency with startup.js, let's keep it simple for now as sellers.html?id=... (but reading might need from=totalseller)
        const baseUrl = window.location.origin + window.location.pathname.replace('totalsellers.html', 'sellers.html');
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

// ==========================================
// Edit (Only for own items)
// ==========================================

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
        // [1] ???곗씠?곌굅?? ?⑥쓽 ?곗씠?곕㈃ 怨듦컻??寃껊쭔
        const isMine = seller.user_id === currentuser_id;
        const isPublic = !seller.is_temporary;
        if (!isMine && !isPublic) return false;

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

        // [5] 怨듦컻?щ? ?꾪꽣 (NDA 吏꾪뻾/誘몄쭊??
        const signedNdas = getSignedNdas();
        const isSigned = signedNdas.includes(String(seller.id));
        const isOwner = seller.user_id === currentuser_id;
        const isAuthorized = isOwner || isSigned;

        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'public') return isAuthorized; // NDA 吏꾪뻾 (??湲 ?ы븿)
            if (v === 'private') return !isAuthorized; // NDA 誘몄쭊??            return true;
        });
        if (!matchesVisibility) return false;

        // [6] 媛寃??꾪꽣 (踰붿쐞 + ?묒쓽?ы븿)
        const price = parseFloat(seller.sale_price);
        const isNegotiable = !seller.sale_price || seller.sale_price === '?묒쓽' || isNaN(price);
        
        let matchesPrice = false;
        if (isNegotiable) {
            // ?묒쓽 ??ぉ: '?묒쓽 ?ы븿' 泥댄겕 ?쒖뿉留??쒖떆
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
            filteredSellers.sort((a, b) => (a.companyName || "").localeCompare(b.companyName || "", 'ko-KR'));
            break;
        case 'price':
            filteredSellers.sort((a, b) => {
                const aVal = parseFloat(a.sale_price) || 0;
                const bVal = parseFloat(b.sale_price) || 0;
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
    
    const signedNdas = getSignedNdas();
    const headers = ['留ㅻ룄?먮챸', '?곗뾽', '吏꾪뻾 ?꾪솴', '媛寃??듭썝)', '?붿빟', '?대떦??, '?깅줉??];
    
    const rows = filteredSellers.map(s => {
        const isOwner = String(s.user_id) === String(currentuser_id);
        const isSigned = signedNdas.includes(String(s.id));
        const status = s.status || '?湲?;
        const isRestricted = (status === '吏꾪뻾以? || status === '?꾨즺');
        
        // 留덉뒪??議곌굔: 蹂몄씤 湲???꾨땲硫댁꽌 (?곹깭媛 吏꾪뻾以??꾨즺?닿굅??NDA 誘멸껐??寃쎌슦)
        const shouldMask = !isOwner && (isRestricted || !isSigned);

        const companyName = shouldMask ? '鍮꾧났媛? : (s.companyName || '');
        
        let summary = s.summary || '';
        if (shouldMask && s.companyName) {
            const escapedName = s.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(escapedName, 'gi');
            summary = summary.replace(nameRegex, 'OOO');
        }

        const author = userMap[s.user_id]?.name || 'Unknown';
        const date = new Date(s.created_at).toLocaleDateString();
        const price = shouldMask ? '-' : (s.sale_price || '');
        
        return [
            companyName, 
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
