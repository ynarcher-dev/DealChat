import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15; // Increased for table view
let totalItems = 0;
let allCompanies = []; // Store all fetched data for client-side pagination
let userMap = {}; // Map user_id to userName
let filteredCompanies = []; // Store companies after filtering
let currentuser_id = null;

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
    // Auth Check
    const userData = checkAuth();
    if (!userData) return;
    const user_id = userData.id;
    currentuser_id = user_id;

    // Update Header Profile
    updateHeaderProfile(userData);
    initUserMenu();

    // Initial Load
    loadInitialData(user_id);

    // Event Handlers
    $('#search-btn').on('click', () => { currentPage = 1; loadCompanies(user_id); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; loadCompanies(user_id); }
    });

    // Inbox Button Click
    $('#inbox-btn').on('click', function () {
        currentInboxTab = 'received';
        $('#received-tab').addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'box-shadow': '0 2px 4px rgba(0,0,0,0.05)' });
        $('#sent-tab').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'box-shadow': 'none' });
        renderInbox();
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('inbox-modal'));
        modal.show();
    });

    // Industry Icon Preview in Modal
    $(document).on('change', '#new-company-industry', function () {
        const industry = $(this).val();
        const iconName = getIndustryIcon(industry);
        $('#new-company-icon-preview .material-symbols-outlined').text(iconName);
    });

    // Filter Toggle
    $('#filter-toggle-btn').on('click', function () {
        const $container = $('#filter-container');
        const isVisible = $container.is(':visible');
        $container.slideToggle();
        $(this).toggleClass('active', !isVisible);
        if (!isVisible) {
            $(this).css({
                'background-color': '#1e293b',
                'box-shadow': '0 4px 12px rgba(30, 41, 59, 0.2)'
            }).find('span').css('color', 'white');
        } else {
            $(this).css({
                'background-color': '#ffffff',
                'box-shadow': '0 2px 8px rgba(0,0,0,0.05)'
            }).find('span').css('color', '#64748b');
        }
    });

    // Filter Change Events
    $(document).on('change', '.industry-checkbox, .mgmt-checkbox, .visibility-checkbox', () => {
        currentPage = 1;
        applyFilters();
    });

    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .mgmt-checkbox, .visibility-checkbox').prop('checked', false);
        $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').val('');
        applyFilters();
    });

    $('#new-btn').on('click', () => {
        location.href = `./dealbook.html?id=new`;
    });

    // Filter Range Inputs
    $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').on('input', applyFilters);


    // Sort Options
    $(document).on('click', '.sort-option', function (e) {
        e.preventDefault();
        $('.sort-option').removeClass('active');
        $(this).addClass('active');

        // Update Label
        const label = $(this).text();
        $('#current-sort-label').text(label);

        const sortType = $(this).data('sort');
        applySort(sortType);
    });

    // CSV Export Event
    $('#export-csv-btn').on('click', exportToCSV);
});

function exportToCSV() {
    if (filteredCompanies.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
    }

    // CSV Headers
    const headers = [
        '기업명', '업종', '요약', '발굴 경로', '투자 유무',
        '투자 밸류', '투자 금액', '담당자 메모', '담당자', '등록일'
    ];

    // CSV Data rows
    const rows = filteredCompanies.map(c => {
        const author = userMap[c.user_id]?.name || 'Unknown';
        const date = new Date(c.created_at).toLocaleDateString();

        return [
            c.companyName || '',
            c.industry || '',
            c.summary || '',
            c.discoveryPath || '',
            c.investmentStatus || '',
            c.valuation || '',
            c.investmentAmount || '',
            c.managerMemo || c.manager_memo || '',
            author,
            date
        ].map(field => `"${String(field).replace(/"/g, '""')}"`); // Escape quotes and wrap in quotes
    });

    // Combine headers and rows
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    // Add BOM for UTF-8 compatibility with Excel (prevents Korean character breaking)
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `DealChat_Companies_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function loadInitialData(user_id) {
    // Show loading state
    $('#company-list-container').html('<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></td></tr>');

    // Load users and companies in parallel
    Promise.all([
        fetchUsers(),
        fetchCompanies(user_id)
    ]).then(([users, companies]) => {
        // Build User Map with name and affiliation
        userMap = {};
        if (Array.isArray(users)) {
            users.forEach(u => {
                userMap[u.id] = {
                    name: u.name,
                    affiliation: u.company || 'DealChat'
                };
            });
        }

        allCompanies = Array.isArray(companies) ? companies
            .map(parseCompanyData)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) : [];
        updateFilterOptions();
        applyFilters();
        renderPagination();

        // Fetch inbox for the current user once initial data is loaded
        fetchInbox();
    }).catch(error => {
        console.error('Initial Load Error:', error);
        $('#company-list-container').html('<tr><td colspan="6" class="text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>');
    }).finally(() => {
        hideLoader();
    });
}

function fetchUsers() {
    return APIcall({ action: 'get', table: 'users' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

function fetchCompanies(user_id) {
    const keyword = ($('#search-input').val() || "").trim();
    return APIcall({ action: 'get', table: 'companies', user_id: user_id, keyword: keyword, deleted_at: "is.null" }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(res => res.json());
}

// Helper for file icons
function getFileIcon(filename) {
    if (!filename) return 'description';
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'picture_as_pdf';
    if (['doc', 'docx'].includes(ext)) return 'description';
    if (['xls', 'xlsx'].includes(ext)) return 'table_chart';
    if (['ppt', 'pptx'].includes(ext)) return 'present_to_all';
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return 'image';
    return 'description';
}

// Helper for industry icons
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
        '湲고?': 'corporate_fare'
    };
    return iconMap[industry] || 'corporate_fare';
}

function loadCompanies(user_id) {
    fetchCompanies(user_id)
        .then(data => {
            if (data.error) throw new Error(data.error);
            allCompanies = Array.isArray(data) ? data.map(parseCompanyData).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) : [];
            updateFilterOptions();
            applyFilters();
            renderPagination();
        })
        .catch(error => {
            console.error('Reload Error:', error);
            $('#company-list-container').html('<tr><td colspan="6" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
        });
}

function renderCompanies() {
    const container = $('#company-list-container');
    container.empty();

    if (filteredCompanies.length === 0) {
        container.html('<tr><td colspan="6" class="text-center py-5 text-muted">?쇱튂?섎뒗 湲곗뾽 ?뺣낫媛 ?놁뒿?덈떎.</td></tr>');
        return;
    }

    // Client-side Pagination Logic
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredCompanies.length);
    const pageItems = filteredCompanies.slice(startIndex, endIndex);

    pageItems.forEach(company => {
        // Format Dates
        const createdDate = new Date(company.created_at || Date.now());
        const updatedDate = company.updated_at ? new Date(company.updated_at) : null;
        const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });

        const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
            ? formatDate(updatedDate)
            : formatDate(createdDate);

        const authorData = userMap[company.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
        const metrics = getLatestMetrics(company);

        const isTemporary = !!company.is_temporary;
        const isFavorite = !!company.is_favorite;

        const rowHtml = `
            <tr onclick="showCompanyDetail('${company.id}')" style="cursor: pointer;">
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; background: ${isTemporary ? '#f1f5f9' : '#1A73E8'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <span class="material-symbols-outlined" style="font-size: 18px; color: ${isTemporary ? '#64748b' : '#ffffff'};">${getIndustryIcon(company.industry)}</span>
                        </div>
                        <span class="company-name-td" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px;">${escapeHtml(company.companyName || "")}</span>
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; white-space: nowrap;">
                    <span class="industry-tag-td" style="white-space: nowrap;">${escapeHtml((company.industry || "").startsWith('湲고?: ') ? company.industry.replace('湲고?: ', '') : (company.industry || "湲고?"))}</span>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="summary-td" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; max-height: 3em; margin-bottom: 4px;">${escapeHtml(company.summary || "")}</div>
                    ${company.managementStatus ? `<div><span class="badge bg-light text-primary border" style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">#${escapeHtml(company.managementStatus.replace(/\s+/g, ''))}</span></div>` : ''}
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div style="font-size: 13px; font-weight: 500; color: #1e293b;">
                        ${metrics.revenue.value !== '-' ? `${metrics.revenue.value}?? : '-'}
                        ${metrics.revenue.year ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 400; margin-top: 2px;">${metrics.revenue.year}</div>` : ''}
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div style="font-size: 13px; font-weight: 500; color: #1e293b;">
                        ${metrics.investment.value !== '-' ? `${metrics.investment.value}?? : '-'}
                        ${metrics.investment.year ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 400; margin-top: 2px;">${metrics.investment.year}</div>` : ''}
                    </div>
                </td>
                <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; white-space: nowrap;">
                    <div class="author-td" style="display: flex; align-items: center; gap: 8px;">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}" alt="Avatar" class="author-avatar-sm" style="flex-shrink: 0;">
                        <div style="line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <div style="font-size: 13px; font-weight: 600; color: #1e293b;">${escapeHtml(authorData.name)}</div>
                            <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(authorData.affiliation)}</div>
                        </div>
                    </div>
                </td>
                <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; text-align: left !important; white-space: nowrap;">${dateDisplay}</td>
                <td style="padding: 20px 24px !important; text-align: center !important; vertical-align: middle !important; white-space: nowrap;" onclick="event.stopPropagation();">
                    <button class="row-action-btn" style="margin-left: 0;" title="湲곗뾽 怨듭쑀?섍린" onclick="openShareModal('${company.id}')">
                        <span class="material-symbols-outlined" style="font-size: 18px;">share</span>
                    </button>
                </td>
            </tr>
        `;
        container.append(rowHtml);
    });
}

// Toggle Favorite Function


// Show Company Detail Modal (Refreshed White Theme)
window.showCompanyDetail = function (id) {
    const company = allCompanies.find(c => c.id === id);
    if (!company) return;

    const authorData = userMap[company.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
    const createdDate = new Date(company.created_at || Date.now());
    const updatedDate = company.updated_at ? new Date(company.updated_at) : null;
    const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `理쒖쥌 ?섏젙: ${formatDate(updatedDate)}`
        : `?깅줉?? ${formatDate(createdDate)}`;

    $('#detail-company-icon').text(getIndustryIcon(company.industry.startsWith('湲고?: ') ? '湲고?' : company.industry));
    $('#detail-company-name').text(company.companyName);

    // Re-parse summary if it contains detailed info to ensure managerMemo and status descriptions are available
    const parsedData = parseCompanyData(company);
    $('#detail-company-summary').text(parsedData.summary);

    // Industry Badge
    const industryContainer = $('#detail-industry-container');
    industryContainer.empty();
    if (company.industry) {
        const displayIndustry = company.industry.startsWith('湲고?: ') ? company.industry.replace('湲고?: ', '') : company.industry;
        industryContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px;">#${escapeHtml(displayIndustry)}</span>`);
    }

    // Author Info
    $('#detail-author-name').text(authorData.name);
    $('#detail-author-affiliation').text(authorData.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorData.name)}`);
    $('#detail-company-date').text(dateDisplay);

    // Dealbook Link
    $('#go-to-dealbook').off('click').on('click', () => {
        location.href = `./dealbook.html?id=${encodeURIComponent(company.id)}`;
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('company-detail-modal'));
    modal.show();
};

// Global Share Entry Point
window.openShareModal = function (companyId) {
    const company = allCompanies.find(c => String(c.id) === String(companyId));
    if (!company) {
        console.warn('Share Modal: Company not found', companyId);
        return;
    }

    const optionsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-options-modal'));

    // 1. Share with User Trigger
    $('#btn-share-with-user-trigger').off('click').on('click', () => {
        optionsModal.hide();
        setTimeout(() => openUserShareModal(companyId), 300);
    });

    // 2. URL Copy
    $('#btn-share-url').off('click').on('click', () => {
        // Construct the Dealbook URL (using the environment's base URL)
        const baseUrl = window.location.origin + window.location.pathname.replace('companies.html', 'dealbook.html');
        // 'from=totalstartup' ?뚮씪誘명꽣瑜?異붽??섏뿬 ?쎄린 ?꾩슜 紐⑤뱶濡??대━?꾨줉 ?ㅼ젙
        const dealbookUrl = `${baseUrl}?id=${encodeURIComponent(companyId)}&from=totalstartup`;

        navigator.clipboard.writeText(dealbookUrl).then(() => {
            alert('URL???대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            optionsModal.hide();
        }).catch(err => {
            console.error('URL copy failed', err);
            // Fallback for non-secure contexts if needed
            const tempInput = document.createElement('input');
            tempInput.value = dealbookUrl;
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

// --- Multi-User Share Logic ---
let selectedReceivers = []; // Store selected user IDs

window.openUserShareModal = function (companyId) {
    const company = allCompanies.find(c => String(c.id) === String(companyId));
    if (!company) return;

    // Reset multi-select state
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
            company_id: companyId
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

    // --- Search Logic ---
    $input.off('input').on('input', function() {
        const query = $(this).val().trim().toLowerCase();
        if (!query) {
            $results.hide();
            return;
        }

        // Filter users from userMap
        const matches = Object.keys(userMap).filter(uid => {
            if (selectedReceivers.includes(uid)) return false; // Exclude already selected
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

                item.on('mouseenter', function() { $(this).css('background', '#f1f5f9'); })
                    .on('mouseleave', function() { $(this).css('background', 'transparent'); });

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

    // Helper: Add User Tag
    function addUserToSelection(uid) {
        if (selectedReceivers.includes(uid)) return;
        
        selectedReceivers.push(uid);
        renderSelectedTags();
    }

    // Helper: Render Tags
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
                    style="background: #1A73E8; color: white; border-radius: 8px; font-weight: 500; font-size: 13px;">
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

    // Bind click event for submit
    $('#btn-submit-share').off('click').on('click', function () {
        submitShare(companyId, this);
    });

    // Close results when clicking outside
    $(document).off('click.userSearch').on('click.userSearch', function(e) {
        if (!$(e.target).closest('.position-relative').length) {
            $results.hide();
        }
    });

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('share-modal'));
    modal.show();
};


function submitShare(companyId, btnElement) {
    const memo = $('#share-memo').val().trim();

    if (selectedReceivers.length === 0) {
        alert('怨듭쑀????먯쓣 ??紐??댁긽 ?좏깮??二쇱꽭??');
        return;
    }

    const $btn = $(btnElement);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('?꾩넚 以?..');

    const selectedFileIds = $('.share-file-checkbox:checked').map(function() {
        return $(this).val();
    }).get();

    // Multiple inserts: Create an array of promises
    const sharePromises = selectedReceivers.map(uid => {
        const payload = {
            table: 'shared_companies',
            action: 'create',
            company_id: companyId,
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
                console.error('Partial Shared Errors:', errors);
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

// Edit Company
window.editCompany = function (id) {
    const company = allCompanies.find(c => c.id === id);
    if (!company) return;

    // Change modal title and button text
    $('#newCompanyModalLabel').text('湲곗뾽 ?뺣낫 ?섏젙');
    $('#save-new-company').text('???);

    // Fill form
    $('#new-company-name').val(company.companyName);
    $('#new-company-industry').val(company.industry);
    $('#new-company-summary').val(company.summary);
    $('#new-company-memo').val(company.managerMemo || company.manager_memo || "");

    // Update Icon Preview
    $('#new-company-icon-preview .material-symbols-outlined').text(getIndustryIcon(company.industry));

    // Open Modal
    const modal = new bootstrap.Modal(document.getElementById('new-company-modal'));
    modal.show();

    // Re-bind save button for UPDATE
    $('#save-new-company').off('click').on('click', function () {
        const userData = checkAuth();
        if (!userData) return;
        updateCompany(id, userData.id, $(this));
    });
};

function updateCompany(id, user_id, $btn) {
    const companyName = $('#new-company-name').val().trim();
    const industry = $('#new-company-industry').val().trim();
    const summary = $('#new-company-summary').val().trim();
    const managerMemo = $('#new-company-memo').val().trim();

    if (!companyName || !industry || !summary) {
        alert('紐⑤뱺 ?꾨뱶瑜??낅젰??二쇱꽭??');
        return;
    }

    // 蹂묓빀 泥섎━ (媛???꾨뱶)
    let mergedSummary = summary;
    if (managerMemo) {
        mergedSummary += "\n\n[?곸꽭 ?뺣낫]\n?대떦??硫붾え: " + managerMemo;
    }

    const payload = {
        id: id,
        companyName: companyName,
        industry: industry,
        summary: mergedSummary,
        attachments: [],
        table: 'companies',
        action: 'update',
        updated_at: new Date().toISOString()
    };

    const originalText = $btn.text();
    $btn.prop('disabled', true).text('???以?..');

    APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(response => response.json())
        .then(result => {
            if (result.error) alert('?섏젙 以??ㅻ쪟 諛쒖깮: ' + result.error);
            else {
                alert('?섏젙?섏뿀?듬땲??');
                bootstrap.Modal.getInstance(document.getElementById('new-company-modal')).hide();
                loadCompanies(user_id);
            }
        })
        .catch(error => {
            console.error('Update Error:', error);
            alert('?섏젙 ?붿껌 ?ㅽ뙣: ' + (error.message || '?ㅽ듃?뚰겕 ?ㅻ쪟'));
        })
        .finally(() => $btn.prop('disabled', false).text(originalText));
}

function renderPagination() {
    const container = $('#pagination-container');
    container.empty();

    const totalPages = Math.ceil(filteredCompanies.length / itemsPerPage);
    if (totalPages <= 1) return;

    // Previous Button
    const prevDisabled = currentPage === 1 ? 'disabled' : '';

    // First Page Button
    container.append(`
        <button class="btn btn-outline-light pagination-btn" ${prevDisabled} onclick="changePage(1)">
            <span class="material-symbols-outlined">keyboard_double_arrow_left</span>
        </button>
    `);

    // Prev Page Button
    container.append(`
        <button class="btn btn-outline-light pagination-btn" ${prevDisabled} onclick="changePage(${currentPage - 1})">
            <span class="material-symbols-outlined">chevron_left</span>
        </button>
    `);

    // Page Numbers (Simple logic: show all or max 5 window)
    // For simplicity, showing all or a simple window logic
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);

    // Adjust window if close to end
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        container.append(`
            <button class="btn btn-outline-light pagination-btn ${activeClass}" onclick="changePage(${i})">
                ${i}
            </button>
        `);
    }

    // Next Button
    const nextDisabled = currentPage === totalPages ? 'disabled' : '';

    // Next Page Button
    container.append(`
        <button class="btn btn-outline-light pagination-btn" ${nextDisabled} onclick="changePage(${currentPage + 1})">
            <span class="material-symbols-outlined">chevron_right</span>
        </button>
    `);

    // Last Page Button
    container.append(`
        <button class="btn btn-outline-light pagination-btn" ${nextDisabled} onclick="changePage(${totalPages})">
            <span class="material-symbols-outlined">keyboard_double_arrow_right</span>
        </button>
    `);
}

// Global function for onclick handlers in HTML string
window.changePage = function (page) {
    const totalPages = Math.ceil(filteredCompanies.length / itemsPerPage);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderCompanies();
    renderPagination();
    // Scroll to top of list
    document.querySelector('.search-and-actions').scrollIntoView({ behavior: 'smooth' });
};

function updateFilterOptions() {
    const $industryList = $('#filter-industry-list');
    const selectedIndustries = $('.industry-checkbox:checked').map(function () { return this.value; }).get();

    // Fixed industry categories
    const categories = [
        "AI", "IT쨌?뺣낫?듭떊", "SaaS쨌?붾（??, "寃뚯엫", "怨듦났쨌援?갑", "愿愿뫢룸젅?",
        "援먯쑁쨌?먮??뚰겕", "湲덉쑖쨌??뚰겕", "?띉룹엫쨌?댁뾽", "?쇱씠?꾩뒪???, "紐⑤퉴由ы떚",
        "臾명솕?덉닠쨌肄섑뀗痢?, "諛붿씠?ㅒ룻뿬?ㅼ???, "遺?숈궛", "酉고떚쨌?⑥뀡", "?먮꼫吏쨌?섍꼍",
        "?몄떇?끒룹냼?곴났??, "?곗＜쨌??났", "?좏넻쨌臾쇰쪟", "?쒖“쨌嫄댁꽕", "?뚮옯?셋룹빱裕ㅻ땲??, "湲고?"
    ];

    $industryList.empty();
    categories.forEach(ind => {
        const isChecked = selectedIndustries.includes(ind) ? 'checked' : '';
        $industryList.append(`
            <div class="filter-item">
                <input type="checkbox" class="btn-check industry-checkbox" id="filter-ind-${ind}" value="${ind}" ${isChecked} autocomplete="off">
                <label class="industry-checkbox-label" for="filter-ind-${ind}">${ind}</label>
            </div>
        `);
    });
}

function applyFilters() {
    const selectedIndustries = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const selectedMgmt = $('.mgmt-checkbox:checked').map(function () { return this.value; }).get();
    const selectedVisibility = $('.visibility-checkbox:checked').map(function () { return this.value; }).get();
    const keyword = ($('#search-input').val() || "").trim().toLowerCase();

    // Range values
    const minRev = parseFloat($('#filter-min-revenue').val()) || 0;
    const maxRev = parseFloat($('#filter-max-revenue').val()) || Infinity;
    const minInv = parseFloat($('#filter-min-investment').val()) || 0;
    const maxInv = parseFloat($('#filter-max-investment').val()) || Infinity;

    filteredCompanies = allCompanies.filter(company => {
        // Keyword match
        const matchesKeyword = !keyword ||
            company.companyName.toLowerCase().includes(keyword) ||
            company.industry.toLowerCase().includes(keyword) ||
            (company.summary && company.summary.toLowerCase().includes(keyword));

        // Industry match
        const matchesIndustry = selectedIndustries.length === 0 || selectedIndustries.some(ind => {
            if (ind === '湲고?') return company.industry && (company.industry === '湲고?' || company.industry.startsWith('湲고?: '));
            return company.industry === ind;
        });

        // Management Status match
        const matchesMgmt = selectedMgmt.length === 0 || (company.managementStatus && selectedMgmt.some(m => {
            if (m === '湲고?') return !['諛쒓뎬 湲곗뾽', '蹂댁쑁 湲곗뾽', '?ъ옄 湲곗뾽'].includes(company.managementStatus);
            return company.managementStatus === m;
        }));


        // Numeric range matches
        const metrics = getLatestMetrics(company);
        const revVal = extractNumber(metrics.revenue.value);
        const invVal = extractNumber(metrics.investment.value);
        const matchesRevenue = revVal >= minRev && revVal <= maxRev;
        const matchesInvestment = invVal >= minInv && invVal <= maxInv;

        // Visibility match (is_temporary field)
        const matchesVisibility = selectedVisibility.length === 0 || selectedVisibility.some(v => {
            if (v === 'private') return company.is_temporary === true;
            if (v === 'public') return company.is_temporary === false || company.is_temporary === undefined || company.is_temporary === null;
            return true;
        });

        return matchesKeyword && matchesIndustry && matchesMgmt && matchesVisibility && matchesRevenue && matchesInvestment;
    });

    // Re-apply sorting for the filtered set
    const currentSort = $('.sort-option.active').data('sort') || 'latest';
    applySort(currentSort, false); // Don't re-render yet, applySort will do it

    currentPage = 1;
    renderCompanies();
    renderPagination();
}

function applySort(type, shouldRender = true) {
    switch (type) {
        case 'name':
            filteredCompanies.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko-KR'));
            break;
        case 'revenue':
            filteredCompanies.sort((a, b) => {
                const aVal = extractNumber(getLatestMetrics(a).revenue.value);
                const bVal = extractNumber(getLatestMetrics(b).revenue.value);
                return bVal - aVal; // Descending
            });
            break;
        case 'investment':
            filteredCompanies.sort((a, b) => {
                const aVal = extractNumber(getLatestMetrics(a).investment.value);
                const bVal = extractNumber(getLatestMetrics(b).investment.value);
                return bVal - aVal; // Descending
            });
            break;
        case 'latest':
        default:
            filteredCompanies.sort((a, b) => {
                const dateA = new Date(a.updated_at || a.created_at);
                const dateB = new Date(b.updated_at || b.created_at);
                return dateB - dateA; // Descending
            });
            break;
    }

    if (shouldRender) {
        currentPage = 1;
        renderCompanies();
        renderPagination();
    }
}

function extractNumber(str) {
    if (!str || str === '-') return 0;
    // ?쇳몴 ?쒓굅 ???レ옄, ?뚯닔?? ?뚯닔 遺?몃쭔 異붿텧
    const sanitized = String(str).replace(/,/g, '');
    const match = sanitized.match(/-?[0-9.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function handleNewCompany(user_id, $btn) {
    const companyName = $('#new-company-name').val().trim();
    const industry = $('#new-company-industry').val().trim();
    const summary = $('#new-company-summary').val().trim();
    const managerMemo = $('#new-company-memo').val().trim();

    if (!companyName || !industry || !summary) {
        alert('紐⑤뱺 ?꾨뱶瑜??낅젰??二쇱꽭??');
        return;
    }

    // 蹂묓빀 泥섎━ (媛???꾨뱶)
    let mergedSummary = summary;
    if (managerMemo) {
        mergedSummary += "\n\n[?곸꽭 ?뺣낫]\n?대떦??硫붾え: " + managerMemo;
    }

    const payload = {
        action: 'create',
        table: 'companies',
        user_id: user_id,
        companyName: companyName,
        industry: industry,
        summary: mergedSummary,
        attachments: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const originalText = $btn.text();
    $btn.prop('disabled', true).text('?깅줉 以?..');

    APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
        .then(response => response.json())
        .then(result => {
            if (result.error) alert('?깅줉 以??ㅻ쪟 諛쒖깮: ' + result.error);
            else {
                alert('??湲곗뾽???깅줉?섏뿀?듬땲??');
                bootstrap.Modal.getInstance(document.getElementById('new-company-modal')).hide();
                $('#new-company-form')[0].reset();
                currentPage = 1;
                loadCompanies(user_id); // Reload list
            }
        })
        .catch(error => {
            console.error('Registration Error:', error);
            alert('?깅줉 ?붿껌 ?ㅽ뙣: ' + (error.message || '?ㅽ듃?뚰겕 ?ㅻ쪟'));
        })
        .finally(() => $btn.prop('disabled', false).text(originalText));
}



// Helper to parse merged data from summary
function parseCompanyData(company) {
    if (!company.summary) return company;

    const parsed = { ...company };
    const summaryText = company.summary;

    try {
        let mainSummary = "";
        let metaText = "";

        if (summaryText.includes('[?곸꽭 ?뺣낫]')) {
            const parts = summaryText.split('[?곸꽭 ?뺣낫]');
            mainSummary = parts[0].trim();
            metaText = parts[1] || "";
        } else {
            const metaKeywords = ["愿由??꾪솴:", "諛쒓뎬 寃쎈줈:", "?ъ옄 ?좊Т:", "?ъ옄 諛몃쪟:", "?ъ옄 湲덉븸:", "??쒖옄紐?", "?대찓??", "?ㅻ┰?쇱옄:", "二쇱냼:", "?ъ옄 ?꾪솴:", "?щТ ?꾪솴:", "?щТ 遺꾩꽍:", "?대떦??硫붾え:", "?대떦???섍껄:"];
            let firstIndex = -1;

            metaKeywords.forEach(kw => {
                const idx = summaryText.indexOf(kw);
                if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
                    firstIndex = idx;
                }
            });

            if (firstIndex !== -1) {
                mainSummary = summaryText.substring(0, firstIndex).trim();
                metaText = summaryText.substring(firstIndex);
            } else {
                mainSummary = summaryText;
                metaText = "";
            }
        }

        // ?붿빟?먯꽌 ?쒓렇 ?쒓굅 ([諛쒓뎬 湲곗뾽], #諛쒓뎬湲곗뾽 ??
        parsed.summary = mainSummary.replace(/^(\[.*?\]|#\S+)\s*/, '').trim();

        if (metaText) {
            const mgmtMatch = metaText.match(/愿由?s*?꾪솴\s*:\s*(.*)/);
            if (mgmtMatch) parsed.managementStatus = mgmtMatch[1].split('\n')[0].trim();

            const pathMatch = metaText.match(/諛쒓뎬\s*寃쎈줈\s*:\s*(.*)/);
            if (pathMatch) parsed.discoveryPath = pathMatch[1].split('\n')[0].trim();

            const investedMatch = metaText.match(/?ъ옄\s*?좊Т\s*:\s*(.*)/);
            if (investedMatch) {
                const val = investedMatch[1].split('\n')[0].trim();
                const isInvested = (val === '?? || val === 'true');
                parsed.isInvested = isInvested;
                parsed.investmentStatus = isInvested ? '?ъ옄?꾨즺' : '?ъ옄??;
            }

            const valMatch = metaText.match(/?ъ옄\s*諛몃쪟\s*:\s*(.*)/);
            if (valMatch) parsed.valuation = valMatch[1].split('\n')[0].trim();

            const amountMatch = metaText.match(/?ъ옄\s*湲덉븸\s*:\s*(.*)/);
            if (amountMatch) parsed.investmentAmount = amountMatch[1].split('\n')[0].trim();

            const ceoMatch = metaText.match(/??쒖옄紐?s*:\s*(.*)/);
            if (ceoMatch) parsed.ceoName = ceoMatch[1].split('\n')[0].trim();

            const emailMatch = metaText.match(/?대찓??s*:\s*(.*)/);
            if (emailMatch) parsed.companyEmail = emailMatch[1].split('\n')[0].trim();

            const dateMatch = metaText.match(/?ㅻ┰?쇱옄\s*:\s*(.*)/);
            if (dateMatch) parsed.establishmentDate = dateMatch[1].split('\n')[0].trim();

            const addressMatch = metaText.match(/二쇱냼\s*:\s*(.*)/);
            if (addressMatch) parsed.companyAddress = addressMatch[1].split('\n')[0].trim();

            const invStatusMatch = metaText.match(/?ъ옄\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?щТ ?꾪솴:|?щТ 遺꾩꽍:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (invStatusMatch) parsed.investmentStatusDesc = invStatusMatch[1].trim();

            const finStatusMatch = metaText.match(/?щТ\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?ъ옄 ?꾪솴:|?щТ 遺꾩꽍:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (finStatusMatch) parsed.financialStatusDesc = finStatusMatch[1].trim();

            const finAnalysisMatch = metaText.match(/?щТ\s*遺꾩꽍\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?ъ옄 ?꾪솴:|?щТ ?꾪솴:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (finAnalysisMatch) parsed.financialAnalysis = finAnalysisMatch[1].trim();

            const memoMatch = metaText.match(/?대떦??s*(?:硫붾え|?섍껄)\s*:\s*((?:.|\n)*)/);
            if (memoMatch) parsed.managerMemo = memoMatch[1].trim();
        }
    } catch (e) {
        console.error('Error parsing company summary:', e);
    }

    return parsed;
}

// Extract latest metrics (Revenue and Investment)
// ??Won) ?⑥쐞瑜??듭썝(Billion) ?⑥쐞濡?蹂?섑븯??諛섑솚
// Extract latest metrics (Revenue and Investment)
// ??Won) ?⑥쐞瑜??듭썝(Billion) ?⑥쐞濡?蹂?섑븯??諛섑솚
function getLatestMetrics(data) {
    const results = {
        revenue: { value: "-", year: "" },
        investment: { value: "-", year: "" }
    };
    if (!data.financialStatusDesc && !data.investmentStatusDesc) return results;

    // Helper: ??以꾩쓽 ?곗씠?곕? 媛앹껜??('Key: Value, Key: Value' ?뺤떇 ???
    const parseLineToObj = (line) => {
        const obj = {};
        if (!line) return obj;
        // ?쇳몴+怨듬갚(', ')?쇰줈 ?꾨뱶瑜?援щ텇?섏뿬 ?섏튂 ?댁쓽 ?쇳몴? ?쇰룞?섏? ?딄쾶 ??
        line.split(/,\s+/).forEach(part => {
            const colonIdx = part.indexOf(':');
            if (colonIdx !== -1) {
                const key = part.substring(0, colonIdx).trim();
                const val = part.substring(colonIdx + 1).trim();
                obj[key] = val;
            }
        });
        return obj;
    };

    // 留ㅼ텧?? 媛??理쒓렐 ?꾨룄??留ㅼ텧??
    if (data.financialStatusDesc) {
        const lines = data.financialStatusDesc.split(/\r?\n/).filter(l => l.trim());
        const sortedLines = lines.map(line => {
            const obj = parseLineToObj(line);
            return { year: parseInt(obj['?꾨룄']) || 0, data: obj };
        }).sort((a, b) => b.year - a.year);

        if (sortedLines.length > 0) {
            const top = sortedLines[0];
            const revValue = top.data['留ㅼ텧??];
            if (revValue) {
                const revInWon = extractNumber(revValue);
                // 10^8 (1???쇰줈 ?섎닎
                const revInBillion = (revInWon / 100000000).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
                results.revenue.value = revInBillion;
                results.revenue.year = top.year > 0 ? top.year.toString() : '';
            }
        }
    }

    // ?꾩쟻?ъ옄湲? 紐⑤뱺 ?꾨룄???ъ옄湲???
    if (data.investmentStatusDesc) {
        const lines = data.investmentStatusDesc.split(/\r?\n/).filter(l => l.trim());
        let totalInvestmentInWon = 0;
        let hasInvestmentData = false;

        lines.forEach(line => {
            const obj = parseLineToObj(line);
            const amountValue = obj['湲덉븸'];
            if (amountValue) {
                totalInvestmentInWon += extractNumber(amountValue);
                hasInvestmentData = true;
            }
        });

        if (hasInvestmentData) {
            const totalInBillion = (totalInvestmentInWon / 100000000).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            results.investment.value = totalInBillion;
            results.investment.year = "?꾩쟻";
        }
    }

    // fallback: investmentStatusDesc???곗씠?곌? ?놁쑝硫?parsed.investmentAmount ?꾨뱶 ?뺤씤 (?듭썝 ?⑥쐞濡?媛꾩＜)
    if (results.investment.value === '-' && data.investmentAmount) {
        results.investment.value = data.investmentAmount;
    }

    return results;
}

// ==========================================
// Inbox (?섏떊??/ 諛쒖떊?? Logic
// ==========================================
let inboxItems = []; // Received
let outboxItems = []; // Sent
let currentInboxTab = 'received';
let currentInboxSort = 'newest';
let selectedInboxItems = new Set();

window.fetchInbox = function () {
    if (!currentuser_id) return;

    // 1. ?섏떊??(receiver_id = ME)
    const receivedPayload = {
        table: 'shared_companies',
        action: 'get',
        receiver_id: currentuser_id
    };

    // 2. 諛쒖떊??(sender_id = ME)
    const sentPayload = {
        table: 'shared_companies',
        action: 'get',
        sender_id: currentuser_id
    };

    Promise.all([
        APIcall(receivedPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json()),
        APIcall(sentPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json())
    ]).then(([receivedData, sentData]) => {
        // Handle Received
        let rItems = [];
        if (Array.isArray(receivedData)) rItems = receivedData;
        else if (receivedData && Array.isArray(receivedData.data)) rItems = receivedData.data;
        rItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        inboxItems = rItems;

        // Handle Sent
        let sItems = [];
        if (Array.isArray(sentData)) sItems = sentData;
        else if (sentData && Array.isArray(sentData.data)) sItems = sentData.data;
        sItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        outboxItems = sItems;

        updateInboxBadge();
    }).catch(err => {
        console.warn('?섏떊??諛쒖떊???곗씠??議고쉶瑜??ㅽ뙣?덉뒿?덈떎.', err);
    });
};

function updateInboxBadge() {
    const unreadCount = inboxItems.filter(item => !item.is_read).length;
    const $badge = $('#inbox-badge');
    if (unreadCount > 0) {
        $badge.text(unreadCount > 99 ? '99+' : unreadCount).show();
    } else {
        $badge.hide();
    }
}

function updateInboxControls() {
    const isReceived = currentInboxTab === 'received';
    const items = isReceived ? inboxItems : outboxItems;
    
    // Update header labels
    $('#header-target-label').text(isReceived ? '蹂대궦 ?щ엺' : '諛쏅뒗 ?щ엺');
    $('#header-date-label').text(isReceived ? '?섏떊?쇱떆' : '諛쒖떊?쇱떆');

    // Update delete button
    const count = selectedInboxItems.size;
    $('#selected-count').text(count);
    $('#btn-delete-inbox').prop('disabled', count === 0);

    // Update select all checkbox state
    if (items.length === 0) {
        $('#inbox-select-all').prop('checked', false).prop('disabled', true);
    } else {
        $('#inbox-select-all').prop('disabled', false);
        $('#inbox-select-all').prop('checked', count === items.length && count > 0);
    }
}



function renderInbox() {
    const $list = $('#inbox-list');
    $list.empty();

    const isReceived = currentInboxTab === 'received';
    let items = isReceived ? [...inboxItems] : [...outboxItems];

    // Apply Sorting
    items.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        
        switch (currentInboxSort) {
            case 'oldest':
                return dateA - dateB;
            case 'status':
                // Unread first, then date
                if (a.is_read === b.is_read) {
                    return dateB - dateA;
                }
                return a.is_read ? 1 : -1;
            case 'newest':
            default:
                return dateB - dateA;
        }
    });
    
    updateInboxControls();

    if (items.length === 0) {
        $list.append(`<div class="text-center text-muted py-5" style="font-size: 14px; background: white; border-radius: 12px; border: 1px dashed #e2e8f0;">${isReceived ? '?섏떊?? : '諛쒖떊??} 怨듭쑀 ?댁뿭???놁뒿?덈떎.</div>`);
        return;
    }

    items.forEach(item => {
        const otherId = item.sender_id;
        const otherInfo = userMap[otherId] || { name: '?????놁쓬', affiliation: '' };
        const companyInfo = allCompanies.find(c => c.id === item.company_id);
        const companyName = companyInfo ? companyInfo.companyName : '??젣??湲곗뾽';
        const dateStr = new Date(item.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const industry = companyInfo ? companyInfo.industry : '湲고?';

        const isRead = item.is_read;
        const isChecked = selectedInboxItems.has(item.id);
        
        // Use uniform terms for read status
        const statusHtml = isRead 
            ? '<span style="color: #cbd5e1; font-size: 12px;">?뺤씤?꾨즺</span>'
            : '<span class="badge" style="background: #1A73E8; font-size: 11px;">誘명솗??/span>';

        // Row-based premium item
        const html = `
            <div class="inbox-row d-flex align-items-center px-3 py-3 mb-2" 
                style="border-radius: 16px; border: 1px solid #eef2f6; background: ${isReceived && !isRead ? '#f5faff' : '#ffffff'}; 
                cursor: pointer; transition: all 0.2s; position: relative;"
                onclick="handleInboxClick('${item.id}', '${item.company_id}', '${currentInboxTab}', event)">
                
                <!-- Checkbox Column (5%) -->
                <div style="width: 5%;" class="text-center" onclick="event.stopPropagation();">
                    <input class="form-check-input item-checkbox" type="checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
                </div>

                <!-- Company Column (30%) -->
                <div style="width: 30%;" class="d-flex align-items-center gap-2">
                    <div style="width: 32px; height: 32px; background: #f1f5f9; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-symbols-outlined" style="font-size: 18px; color: #64748b;">${getIndustryIcon(industry)}</span>
                    </div>
                    <div class="text-truncate fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(companyName)}</div>
                </div>

                <!-- User Column (20%) -->
                <div style="width: 20%;" class="d-flex align-items-center gap-2">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(otherInfo.name)}" 
                        style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid #e2e8f0;">
                    <div class="text-truncate" style="font-size: 13px; color: #475569;">${escapeHtml(otherInfo.name)}</div>
                </div>

                <!-- Date Column (25%) -->
                <div style="width: 25%; font-size: 13px; color: #94a3b8;">
                    ${dateStr}
                </div>

                <!-- Status Column (20%) -->
                <div style="width: 20%;" class="text-center">
                    ${statusHtml}
                </div>
            </div>
        `;
        $list.append(html);
    });
}

window.handleInboxClick = function (shareId, companyId, mode, event) {
    // If clicked exactly on a checkbox or its generic row, handled by global bindings below.
    // If row is clicked but not checkbox, open detail modal
    if ($(event.target).is('input[type="checkbox"]')) {
        return; // Event delegated handle
    }

    if (mode === 'received') {
        const itemIndex = inboxItems.findIndex(i => i.id === shareId);
        if (itemIndex > -1 && !inboxItems[itemIndex].is_read) {
            inboxItems[itemIndex].is_read = true;
            updateInboxBadge();
            renderInbox();

            APIcall({ table: 'shared_companies', action: 'update', id: shareId, is_read: true }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .catch(e => console.error('Failed to mark as read', e));
        }
    }

    // 紐⑤떖 ?リ린
    const inboxModalEl = document.getElementById('inbox-modal');
    const inboxModal = bootstrap.Modal.getInstance(inboxModalEl);
    if (inboxModal) inboxModal.hide();

    // ?ロ엳???좊땲硫붿씠?????곸꽭 ?앹뾽 ?ㅽ뵂 諛⑺빐 諛⑹?
    setTimeout(() => {
        if (!allCompanies.find(c => c.id === companyId)) {
            alert('?대떦 湲곗뾽 ?곗씠?곕? 李얠쓣 ???놁뒿?덈떎. (??젣?섏뿀嫄곕굹 ?묎렐 沅뚰븳???놁쓣 ???덉뒿?덈떎.)');
            return;
        }
        showCompanyDetail(companyId);
    }, 300);
};

// --- Inbox Events ---

$(document).ready(function() {
    // Tab Changes
    $('#received-tab, #sent-tab').on('click', function () {
        if ($(this).hasClass('active')) return;

        currentInboxTab = $(this).attr('id') === 'received-tab' ? 'received' : 'sent';
        selectedInboxItems.clear(); // Clear selections on tab change
        
        $('.inbox-tab-btn').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'box-shadow': 'none' });
        $(this).addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'box-shadow': '0 2px 4px rgba(0,0,0,0.05)' });

        renderInbox();
    });

    // Sort Dropdown
    $(document).on('click', '.inbox-sort-option', function(e) {
        e.preventDefault();
        const sortType = $(this).data('sort');
        const text = $(this).text();
        
        currentInboxSort = sortType;
        $('#current-inbox-sort').text(text);
        
        $('.inbox-sort-option').removeClass('active');
        $(this).addClass('active');
        
        renderInbox();
    });

    // Checkbox toggles
    $(document).on('change', '.item-checkbox', function(e) {
        e.stopPropagation();
        const val = $(this).val();
        if ($(this).is(':checked')) {
            selectedInboxItems.add(val);
        } else {
            selectedInboxItems.delete(val);
        }
        updateInboxControls();
    });

    // Select All
    $(document).on('change', '#inbox-select-all', function(e) {
        e.stopPropagation();
        const isChecked = $(this).is(':checked');
        const isReceived = currentInboxTab === 'received';
        const items = isReceived ? inboxItems : outboxItems;
        
        selectedInboxItems.clear();
        if (isChecked) {
            items.forEach(item => selectedInboxItems.add(item.id));
        }
        
        $('.item-checkbox').prop('checked', isChecked);
        updateInboxControls();
    });

    // Delete selected items
    $('#btn-delete-inbox').on('click', async function() {
        const count = selectedInboxItems.size;
        if (count === 0) return;
        
        const confirmMsg = `?좏깮?섏떊 ${count}媛쒖쓽 怨듭쑀 ?댁뿭???뺣쭚 ??젣?섏떆寃좎뒿?덇퉴?`;
        if (confirm(confirmMsg)) {
            const arr = Array.from(selectedInboxItems);
            let successCnt = 0;
            
            // Delete serially or parallelly (parallel chosen for speed)
            await Promise.all(arr.map(id => {
                return APIcall({ table: 'shared_companies', action: 'delete', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                    .then(() => successCnt++)
                    .catch(e => console.error('Delete fail', e));
            }));

            // Remap client arrays
            if (currentInboxTab === 'received') {
                inboxItems = inboxItems.filter(item => !selectedInboxItems.has(item.id));
            } else {
                outboxItems = outboxItems.filter(item => !selectedInboxItems.has(item.id));
            }

            selectedInboxItems.clear();
            updateInboxBadge();
            renderInbox();
            alert(`珥?${successCnt}媛쒖쓽 ?댁뿭???깃났?곸쑝濡???젣?섏뿀?듬땲??`);
        }
    });
});
