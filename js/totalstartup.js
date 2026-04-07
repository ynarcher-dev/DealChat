import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let allCompanies = [];
let filteredCompanies = [];
let userMap = {};
let currentuser_id = null;

let currentSort = 'latest'; // 'latest', 'name', 'revenue', 'investment'

// Inbox state
let inboxItems = []; // Received
let outboxItems = []; // Sent
let currentInboxTab = 'received';
let currentInboxSort = 'newest';
let selectedInboxItems = new Set();
let shareTargetCompanyId = null;
let selectedReceivers = [];

$(document).ready(function () {
    const userData = checkAuth();
    if (!userData) return;
    currentuser_id = userData.id;

    updateHeaderProfile(userData);
    initUserMenu();

    loadInitialData();
    fetchInbox();

    // --- Search & Filters ---
    $('#search-btn').on('click', () => { applyFilters(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { applyFilters(); }
    });

    $('#filter-toggle-btn').on('click', function () {
        const $container = $('#filter-container');
        const isVisible = $container.is(':visible');
        $container.slideToggle();
        $(this).toggleClass('active', !isVisible);
    });

    $(document).on('change', '.industry-checkbox, .mgmt-checkbox', () => {
        applyFilters();
    });

    $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').on('input', () => {
        applyFilters();
    });

    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .mgmt-checkbox').prop('checked', false);
        $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').val('');
        applyFilters();
    });

    // --- Sorting ---
    $('.sort-option').on('click', function (e) {
        e.preventDefault();
        const sortType = $(this).data('sort');
        currentSort = sortType;
        $('#current-sort-label').text($(this).text());
        $('.sort-option').removeClass('active');
        $(this).addClass('active');
        applyFilters();
    });

    // --- Export ---
    $('#export-csv-btn').on('click', exportToCSV);

    // --- Inbox & Share ---
    $('#inbox-btn').on('click', function () {
        currentInboxTab = 'received';
        $('#received-tab').addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'box-shadow': '0 2px 4px rgba(0,0,0,0.05)' });
        $('#sent-tab').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'box-shadow': 'none' });
        renderInbox();
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('inbox-modal'));
        modal.show();
    });

    $('#received-tab, #sent-tab').on('click', function () {
        if ($(this).hasClass('active')) return;
        currentInboxTab = $(this).attr('id') === 'received-tab' ? 'received' : 'sent';
        selectedInboxItems.clear();
        $('.inbox-tab-btn').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'box-shadow': 'none' });
        $(this).addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'box-shadow': '0 2px 4px rgba(0,0,0,0.05)' });
        renderInbox();
    });

    $(document).on('click', '.inbox-sort-option', function(e) {
        e.preventDefault();
        currentInboxSort = $(this).data('sort');
        $('#current-inbox-sort').text($(this).text());
        $('.inbox-sort-option').removeClass('active');
        $(this).addClass('active');
        renderInbox();
    });

    $(document).on('change', '.item-checkbox', function(e) {
        e.stopPropagation();
        const val = $(this).val();
        if ($(this).is(':checked')) selectedInboxItems.add(val);
        else selectedInboxItems.delete(val);
        updateInboxControls();
    });

    $(document).on('change', '#inbox-select-all', function(e) {
        e.stopPropagation();
        const isChecked = $(this).is(':checked');
        const items = currentInboxTab === 'received' ? inboxItems : outboxItems;
        selectedInboxItems.clear();
        if (isChecked) items.forEach(item => selectedInboxItems.add(item.id));
        $('.item-checkbox').prop('checked', isChecked);
        updateInboxControls();
    });

    $('#btn-delete-inbox').on('click', async function() {
        const count = selectedInboxItems.size;
        if (count === 0) return;
        if (confirm(`?좏깮?섏떊 ${count}媛쒖쓽 怨듭쑀 ?댁뿭???뺣쭚 ??젣?섏떆寃좎뒿?덇퉴?`)) {
            const arr = Array.from(selectedInboxItems);
            await Promise.all(arr.map(id => {
                return APIcall({ table: 'shared_companies', action: 'delete', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                    .catch(e => console.error('Delete fail', e));
            }));
            if (currentInboxTab === 'received') inboxItems = inboxItems.filter(item => !selectedInboxItems.has(item.id));
            else outboxItems = outboxItems.filter(item => !selectedInboxItems.has(item.id));
            selectedInboxItems.clear();
            updateInboxBadge();
            renderInbox();
            alert('??젣?섏뿀?듬땲??');
        }
    });

    // --- Share Logic ---
    $('#share-user-search').on('input', function() {
        const keyword = $(this).val().toLowerCase().trim();
        const $results = $('#user-search-results');
        if (!keyword) { $results.hide(); return; }
        const matches = Object.entries(userMap)
            .filter(([id, u]) => u.name.toLowerCase().includes(keyword) || (u.affiliation && u.affiliation.toLowerCase().includes(keyword)))
            .slice(0, 10);
        if (matches.length === 0) { $results.hide(); return; }
        $results.empty().show();
        matches.forEach(([id, u]) => {
            $results.append(`<div class="p-3 border-bottom user-search-item" style="cursor: pointer; transition: background 0.2s;" data-id="${id}" data-name="${u.name}">
                <div class="fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(u.name)}</div>
                <div style="font-size: 11px; color: #64748b;">${escapeHtml(u.affiliation)}</div>
            </div>`);
        });
    });

    $(document).on('click', '.user-search-item', function() {
        const user_id = $(this).data('id');
        const userName = $(this).data('name');
        addSelectedUser(user_id, userName);
        $('#share-user-search').val('');
        $('#user-search-results').hide();
    });

    $('#btn-submit-share').on('click', async function() {
        if (selectedReceivers.length === 0) { alert('怨듭쑀????먯쓣 ??紐??댁긽 ?좏깮??二쇱꽭??'); return; }
        const memo = $('#share-memo').val().trim();
        const btn = this;
        $(btn).prop('disabled', true).text('?꾩넚 以?..');
        const sharePromises = selectedReceivers.map(uid => {
            return APIcall({
                table: 'shared_companies',
                action: 'create',
                company_id: shareTargetCompanyId,
                sender_id: currentuser_id,
                receiver_id: uid,
                memo: memo,
                is_read: false
            }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json());
        });
        Promise.all(sharePromises).then(results => {
            const errs = results.filter(r => r.error);
            if (errs.length > 0) alert(`${errs.length}嫄댁쓽 怨듭쑀 以??ㅻ쪟 諛쒖깮.`);
            else {
                alert(`${selectedReceivers.length}紐낆쓽 ??먯뿉寃?怨듭쑀?섏뿀?듬땲??`);
                bootstrap.Modal.getInstance(document.getElementById('share-modal')).hide();
                fetchInbox();
            }
        }).catch(e => { 
            console.error('Share Error', e); 
            alert('怨듭쑀 ?붿껌 ?ㅽ뙣: ' + (e.message || '?????녿뒗 ?ㅻ쪟')); 
        })
        .finally(() => $(btn).prop('disabled', false).text('蹂대궡湲?));
    });

    $('#btn-share-with-user-trigger').on('click', function() {
        bootstrap.Modal.getInstance(document.getElementById('share-options-modal')).hide();
        const modal = new bootstrap.Modal(document.getElementById('share-modal'));
        modal.show();
    });

    $('#btn-share-url').on('click', function() {
        // Construct the Dealbook URL with read-only parameter
        const url = `${window.location.origin}/html/dealbook.html?id=${shareTargetCompanyId}&from=totalstartup`;
        navigator.clipboard.writeText(url).then(() => {
            alert('URL???대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            bootstrap.Modal.getInstance(document.getElementById('share-options-modal')).hide();
        });
    });
});

function addSelectedUser(id, name) {
    if (selectedReceivers.includes(id)) return;
    selectedReceivers.push(id);
    renderSelectedTags();
}

function renderSelectedTags() {
    const $container = $('#selected-users-container');
    if (selectedReceivers.length === 0) {
        $container.html('<span class="text-muted p-1" style="font-size: 13px;">?대쫫?쇰줈 ??먯쓣 寃?됲븯?몄슂.</span>');
        return;
    }
    $container.empty();
    selectedReceivers.forEach(uid => {
        const u = userMap[uid];
        const tag = $(`<span class="badge d-flex align-items-center gap-1 p-2" style="background: #eef2ff; color: #1A73E8; border: 1px solid #e0e7ff; border-radius: 8px;">
            ${escapeHtml(u.name)} <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">close</span>
        </span>`);
        tag.find('span').on('click', () => {
            selectedReceivers = selectedReceivers.filter(x => x !== uid);
            renderSelectedTags();
        });
        $container.append(tag);
    });
}

function loadInitialData() {
    $('#company-list-container').html('<tr><td colspan="8" class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><div class="mt-2 text-muted">?곗씠?곕? 遺덈윭?ㅻ뒗 以?..</div></td></tr>');
    Promise.all([
        APIcall({ action: 'get', table: 'users' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json()),
        APIcall({ action: 'get', table: 'companies', user_id: "" }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json())
    ]).then(([users, companies]) => {
        userMap = {};
        if (Array.isArray(users)) {
            users.forEach(u => { userMap[u.id] = { name: u.name, affiliation: u.company || 'DealChat' }; });
        }
        allCompanies = Array.isArray(companies) ? companies.map(parseCompanyData) : [];
        updateFilterOptions();
        applyFilters();
    }).catch(err => {
        console.error('Load Error:', err);
        $('#company-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.</td></tr>');
    }).finally(() => {
        hideLoader();
        $('#transition-loader').hide();
    });
}

function fetchInbox() {
    if (!currentuser_id) return;
    const rPayload = { table: 'shared_companies', action: 'get', receiver_id: currentuser_id };
    const sPayload = { table: 'shared_companies', action: 'get', sender_id: currentuser_id };
    Promise.all([
        APIcall(rPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json()),
        APIcall(sPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json())
    ]).then(([rData, sData]) => {
        inboxItems = (Array.isArray(rData) ? rData : rData?.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        outboxItems = (Array.isArray(sData) ? sData : sData?.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        updateInboxBadge();
    }).catch(e => console.error('Inbox Error', e));
}

function updateInboxBadge() {
    const unread = inboxItems.filter(i => !i.is_read).length;
    const $badge = $('#inbox-badge');
    if (unread > 0) $badge.text(unread > 99 ? '99+' : unread).show();
    else $badge.hide();
}

function updateFilterOptions() {
    const $list = $('#filter-industry-list');
    const selected = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const categories = ["AI", "IT쨌?뺣낫?듭떊", "SaaS쨌?붾（??, "寃뚯엫", "怨듦났쨌援?갑", "愿愿뫢룸젅?", "援먯쑁쨌?먮??뚰겕", "湲덉쑖쨌??뚰겕", "?띉룹엫쨌?댁뾽", "?쇱씠?꾩뒪???, "紐⑤퉴由ы떚", "臾명솕?덉닠쨌肄섑뀗痢?, "諛붿씠?ㅒ룻뿬?ㅼ???, "遺?숈궛", "酉고떚쨌?⑥뀡", "?먮꼫吏쨌?섍꼍", "?몄떇?끒룹냼?곴났??, "?곗＜쨌??났", "?좏넻쨌臾쇰쪟", "?쒖“쨌嫄댁꽕", "?뚮옯?셋룹빱裕ㅻ땲??, "湲고?"];
    $list.empty();
    categories.forEach(ind => {
        const isChecked = selected.includes(ind) ? 'checked' : '';
        $list.append(`<div class="filter-item">
            <input type="checkbox" class="btn-check industry-checkbox" id="filter-ind-${ind}" value="${ind}" ${isChecked} autocomplete="off">
            <label class="industry-checkbox-label" for="filter-ind-${ind}">${ind}</label>
        </div>`);
    });
}

function applyFilters() {
    const selInd = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const selMgmt = $('.mgmt-checkbox:checked').map(function () { return this.value; }).get();
    
    const minRev = parseFloat($('#filter-min-revenue').val()) || -Infinity;
    const maxRev = parseFloat($('#filter-max-revenue').val()) || Infinity;
    const minInv = parseFloat($('#filter-min-investment').val()) || -Infinity;
    const maxInv = parseFloat($('#filter-max-investment').val()) || Infinity;
    
    const keyword = ($('#search-input').val() || "").trim().toLowerCase();

    filteredCompanies = allCompanies.filter(c => {
        const metrics = getLatestMetrics(c);
        const revVal = extractNumber(metrics.revenue.value);
        const invVal = extractNumber(metrics.investment.value);

        const matchesKeyword = !keyword || c.companyName.toLowerCase().includes(keyword) || (c.industry && c.industry.toLowerCase().includes(keyword)) || (c.summary && c.summary.toLowerCase().includes(keyword));
        const matchesInd = selInd.length === 0 || selInd.some(ind => ind === '湲고?' ? (c.industry === '湲고?' || (c.industry && c.industry.startsWith('湲고?: '))) : c.industry === ind);
        const matchesMgmt = selMgmt.length === 0 || (c.managementStatus && selMgmt.includes(c.managementStatus));
        
        const matchesRev = revVal >= minRev && revVal <= maxRev;
        const matchesInv = invVal >= minInv && invVal <= maxInv;

        return matchesKeyword && matchesInd && matchesMgmt && matchesRev && matchesInv;
    });

    // Sort
    if (currentSort === 'latest') {
        filteredCompanies.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    } else if (currentSort === 'name') {
        filteredCompanies.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko-KR'));
    } else if (currentSort === 'revenue') {
        filteredCompanies.sort((a, b) => extractNumber(getLatestMetrics(b).revenue.value) - extractNumber(getLatestMetrics(a).revenue.value));
    } else if (currentSort === 'investment') {
        filteredCompanies.sort((a, b) => extractNumber(getLatestMetrics(b).investment.value) - extractNumber(getLatestMetrics(a).investment.value));
    }

    currentPage = 1;
    renderCompanies();
    renderPagination();
}

function renderCompanies() {
    const $container = $('#company-list-container');
    $container.empty();
    if (filteredCompanies.length === 0) { $container.html('<tr><td colspan="8" class="text-center py-5 text-muted">?쇱튂?섎뒗 湲곗뾽 ?뺣낫媛 ?놁뒿?덈떎.</td></tr>'); return; }
    
    const start = (currentPage - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, filteredCompanies.length);
    const items = filteredCompanies.slice(start, end);

    items.forEach(c => {
        const date = new Date(c.updated_at || c.created_at).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
        const author = userMap[c.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
        const metrics = getLatestMetrics(c);
        
        $container.append(`<tr onclick="showCompanyDetail('${c.id}')" style="cursor: pointer;">
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <div class="d-flex align-items-center gap-3">
                    <div style="width: 36px; height: 36px; background: #1A73E8; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${getIndustryIcon(c.industry)}</span>
                    </div>
                    <span class="company-name-td text-truncate" style="max-width: 140px;">${escapeHtml(c.companyName)}</span>
                </div>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <span class="industry-tag-td">${escapeHtml(c.industry)}</span>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <div class="summary-td">${escapeHtml(c.summary)}</div>
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
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                <div class="author-td" style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(author.name)}" class="author-avatar-sm" style="flex-shrink: 0;">
                    <div style="line-height: 1.2; min-width: 0; overflow: hidden;">
                        <div class="fw-bold text-truncate" style="font-size: 13px;">${escapeHtml(author.name)}</div>
                        <div class="text-truncate" style="font-size: 11px; color: #94a3b8;">${escapeHtml(author.affiliation)}</div>
                    </div>
                </div>
            </td>
            <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; text-align: left !important;">${date}</td>
            <td style="padding: 20px 24px !important;" onclick="event.stopPropagation();">
                <button class="row-action-btn" onclick="openShareOptions('${c.id}')"><span class="material-symbols-outlined" style="font-size: 18px;">share</span></button>
            </td>
        </tr>`);
    });
}

window.showCompanyDetail = function (id) {
    const c = allCompanies.find(x => x.id === id);
    if (!c) return;
    const author = userMap[c.user_id] || { name: 'Unknown', affiliation: 'DealChat' };
    const dateStr = `?깅줉?? ${new Date(c.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}`;

    $('#detail-company-icon').text(getIndustryIcon(c.industry));
    $('#detail-company-name').text(c.companyName);
    $('#detail-company-summary').text(c.summary);

    const indContainer = $('#detail-industry-container').empty();
    if (c.industry) indContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill">#${escapeHtml(c.industry)}</span>`);
    
    const truncatedName = (author.name || '').length > 4 ? (author.name || '').substring(0, 4) + '...' : (author.name || '');
    $('#detail-author-name').text(truncatedName);
    $('#detail-author-affiliation').text(author.affiliation);
    $('#detail-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(author.name)}`);
    $('#detail-company-date').text(dateStr);

    $('#btn-go-to-dealbook').off('click').on('click', () => {
        const $loader = $('#transition-loader');
        $loader.css('display', 'flex'); // Show loading overlay
        
        setTimeout(() => {
            location.href = `./dealbook.html?id=${encodeURIComponent(id)}&from=totalstartup`;
        }, 600);
    });

    bootstrap.Modal.getOrCreateInstance(document.getElementById('company-detail-modal')).show();
};

window.openShareOptions = function (id) {
    shareTargetCompanyId = id;
    selectedReceivers = [];
    renderSelectedTags();
    $('#share-memo').val('');
    new bootstrap.Modal(document.getElementById('share-options-modal')).show();
};

window.handleInboxClick = function (shareId, companyId, mode, event) {
    if ($(event.target).is('input[type="checkbox"]')) return;
    if (mode === 'received') {
        const item = inboxItems.find(i => i.id === shareId);
        if (item && !item.is_read) {
            item.is_read = true;
            updateInboxBadge();
            renderInbox();
            APIcall({ table: 'shared_companies', action: 'update', id: shareId, is_read: true }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
        }
    }
    bootstrap.Modal.getInstance(document.getElementById('inbox-modal')).hide();
    setTimeout(() => { if (allCompanies.find(c => c.id === companyId)) showCompanyDetail(companyId); else alert('?곗씠?곕? 李얠쓣 ???놁뒿?덈떎.'); }, 300);
};

function renderInbox() {
    const $list = $('#inbox-list').empty();
    const isR = currentInboxTab === 'received';
    let items = [...(isR ? inboxItems : outboxItems)];

    items.sort((a, b) => {
        const dA = new Date(a.created_at);
        const dB = new Date(b.created_at);
        if (currentInboxSort === 'oldest') return dA - dB;
        if (currentInboxSort === 'status') return a.is_read === b.is_read ? dB - dA : (a.is_read ? 1 : -1);
        return dB - dA;
    });

    updateInboxControls();

    if (items.length === 0) { $list.append(`<div class="text-center text-muted py-5">${isR ? '?섏떊?? : '諛쒖떊??} ?댁뿭???놁뒿?덈떎.</div>`); return; }

    items.forEach(item => {
        const otherId = isR ? item.sender_id : item.receiver_id;
        const other = userMap[otherId] || { name: '?????놁쓬' };
        const company = allCompanies.find(c => c.id === item.company_id) || { companyName: '??젣??湲곗뾽', industry: '湲고?' };
        const date = new Date(item.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const check = selectedInboxItems.has(item.id) ? 'checked' : '';
        const statusHtml = item.is_read ? '<span style="color: #cbd5e1; font-size: 12px;">?뺤씤?꾨즺</span>' : '<span class="badge" style="background: #1A73E8; font-size: 11px;">誘명솗??/span>';

        $list.append(`<div class="inbox-row d-flex align-items-center px-3 py-3 mb-2" style="border-radius: 16px; border: 1px solid #eef2f6; background: ${isR && !item.is_read ? '#f5faff' : '#ffffff'}; cursor: pointer;" onclick="handleInboxClick('${item.id}', '${item.company_id}', '${currentInboxTab}', event)">
            <div style="width: 5%;" class="text-center" onclick="event.stopPropagation();"><input class="form-check-input item-checkbox" type="checkbox" value="${item.id}" ${check}></div>
            <div style="width: 30%;" class="d-flex align-items-center gap-2">
                <div style="width: 32px; height: 32px; background: #f1f5f9; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 18px; color: #64748b;">${getIndustryIcon(company.industry)}</span></div>
                <div class="text-truncate fw-bold" style="font-size: 14px;">${escapeHtml(company.companyName)}</div>
            </div>
            <div style="width: 20%;" class="d-flex align-items-center gap-2">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(other.name)}" style="width: 24px; height: 24px; border-radius: 50%;">
                <div class="text-truncate" style="font-size: 13px;">${escapeHtml(other.name)}</div>
            </div>
            <div style="width: 25%; font-size: 13px; color: #94a3b8;">${date}</div>
            <div style="width: 20%;" class="text-center">${statusHtml}</div>
        </div>`);
    });
}

function updateInboxControls() {
    const items = currentInboxTab === 'received' ? inboxItems : outboxItems;
    $('#header-target-label').text(currentInboxTab === 'received' ? '蹂대궦 ?щ엺' : '諛쏅뒗 ?щ엺');
    $('#header-date-label').text(currentInboxTab === 'received' ? '?섏떊?쇱떆' : '諛쒖떊?쇱떆');
    const count = selectedInboxItems.size;
    $('#selected-count').text(count);
    $('#btn-delete-inbox').prop('disabled', count === 0);
    $('#inbox-select-all').prop('disabled', items.length === 0).prop('checked', items.length > 0 && count === items.length);
}

function renderPagination() {
    const $container = $('#pagination-container').empty();
    const total = Math.ceil(filteredCompanies.length / itemsPerPage);
    if (total <= 1) return;
    const prevD = currentPage === 1 ? 'disabled' : '';
    const nextD = currentPage === total ? 'disabled' : '';
    
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${prevD} onclick="changePage(1)"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button>`);
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${prevD} onclick="changePage(${currentPage - 1})"><span class="material-symbols-outlined">chevron_left</span></button>`);
    
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    
    for (let i = start; i <= end; i++) {
        $container.append(`<button class="btn btn-outline-light pagination-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`);
    }
    
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${nextD} onclick="changePage(${currentPage + 1})"><span class="material-symbols-outlined">chevron_right</span></button>`);
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${nextD} onclick="changePage(${total})"><span class="material-symbols-outlined">keyboard_double_arrow_right</span></button>`);
}

window.changePage = function (p) {
    currentPage = p;
    renderCompanies();
    renderPagination();
    document.querySelector('.search-and-actions').scrollIntoView({ behavior: 'smooth' });
};

function parseCompanyData(company) {
    if (!company.summary) return company;
    const parsed = { ...company };
    const summaryText = company.summary;
    try {
        let mainSummary = ""; let metaText = "";
        if (summaryText.includes('[?곸꽭 ?뺣낫]')) {
            const parts = summaryText.split('[?곸꽭 ?뺣낫]');
            mainSummary = parts[0].trim(); metaText = parts[1] || "";
        } else {
            const metaKeywords = ["愿由??꾪솴:", "諛쒓뎬 寃쎈줈:", "?ъ옄 ?좊Т:", "?ъ옄 諛몃쪟:", "?ъ옄 湲덉븸:", "??쒖옄紐?", "?대찓??", "?ㅻ┰?쇱옄:", "二쇱냼:", "?ъ옄 ?꾪솴:", "?щТ ?꾪솴:", "?щТ 遺꾩꽍:", "?대떦??硫붾え:", "?대떦???섍껄:"];
            let firstIndex = -1;
            metaKeywords.forEach(kw => {
                const idx = summaryText.indexOf(kw);
                if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
            });
            if (firstIndex !== -1) { mainSummary = summaryText.substring(0, firstIndex).trim(); metaText = summaryText.substring(firstIndex); }
            else { mainSummary = summaryText; metaText = ""; }
        }
        parsed.summary = mainSummary.replace(/^(\[.*?\]|#\S+)\s*/, '').trim();
        if (metaText) {
            const mgmtMatch = metaText.match(/愿由?s*?꾪솴\s*:\s*(.*)/); if (mgmtMatch) parsed.managementStatus = mgmtMatch[1].split('\n')[0].trim();
            const invStatusMatch = metaText.match(/?ъ옄\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?щТ ?꾪솴:|?щТ 遺꾩꽍:|?대떦??硫붾え:|?대떦???섍껄:|$))/); if (invStatusMatch) parsed.investmentStatusDesc = invStatusMatch[1].trim();
            const finStatusMatch = metaText.match(/?щТ\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?ъ옄 ?꾪솴:|?щТ 遺꾩꽍:|?대떦??硫붾え:|?대떦???섍껄:|$))/); if (finStatusMatch) parsed.financialStatusDesc = finStatusMatch[1].trim();
            const amountMatch = metaText.match(/?ъ옄\s*湲덉븸\s*:\s*(.*)/); if (amountMatch) parsed.investmentAmount = amountMatch[1].split('\n')[0].trim();
        }
    } catch (e) { console.error('Error parsing company summary:', e); }
    return parsed;
}

function getLatestMetrics(data) {
    const res = { revenue: { value: "-", year: "" }, investment: { value: "-", year: "" } };
    const parseLineToObj = (line) => {
        const obj = {}; if (!line) return obj;
        line.split(/,\s+/).forEach(part => {
            const colonIdx = part.indexOf(':');
            if (colonIdx !== -1) { const key = part.substring(0, colonIdx).trim(); const val = part.substring(colonIdx + 1).trim(); obj[key] = val; }
        });
        return obj;
    };
    if (data.financialStatusDesc) {
        const lines = data.financialStatusDesc.split(/\r?\n/).filter(l => l.trim());
        const sortedLines = lines.map(line => { const obj = parseLineToObj(line); return { year: parseInt(obj['?꾨룄']) || 0, data: obj }; }).sort((a, b) => b.year - a.year);
        if (sortedLines.length > 0) {
            const top = sortedLines[0]; const revValue = top.data['留ㅼ텧??];
            if (revValue) {
                const revInBillion = (extractNumber(revValue) / 100000000).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
                res.revenue.value = revInBillion; res.revenue.year = top.year > 0 ? top.year.toString() : '';
            }
        }
    }
    if (data.investmentStatusDesc) {
        const lines = data.investmentStatusDesc.split(/\r?\n/).filter(l => l.trim());
        let totalVal = 0; let hasData = false;
        lines.forEach(line => { const obj = parseLineToObj(line); if (obj['湲덉븸']) { totalVal += extractNumber(obj['湲덉븸']); hasData = true; } });
        if (hasData) {
            const totalInBillion = (totalVal / 100000000).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            res.investment.value = totalInBillion; res.investment.year = "?꾩쟻";
        }
    }
    if (res.investment.value === '-' && data.investmentAmount) res.investment.value = data.investmentAmount;
    return res;
}

function extractNumber(str) {
    if (!str || str === '-') return 0;
    const sanitized = String(str).replace(/,/g, '');
    const match = sanitized.match(/-?[0-9.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function getIndustryIcon(ind) {
    const map = { 'AI': 'smart_toy', 'IT쨌?뺣낫?듭떊': 'computer', 'SaaS쨌?붾（??: 'cloud', '寃뚯엫': 'sports_esports', '怨듦났쨌援?갑': 'policy', '愿愿뫢룸젅?': 'beach_access', '援먯쑁쨌?먮??뚰겕': 'school', '湲덉쑖쨌??뚰겕': 'payments', '?띉룹엫쨌?댁뾽': 'agriculture', '?쇱씠?꾩뒪???: 'person', '紐⑤퉴由ы떚': 'directions_car', '臾명솕?덉닠쨌肄섑뀗痢?: 'movie', '諛붿씠?ㅒ룻뿬?ㅼ???: 'medical_services', '遺?숈궛': 'real_estate_agent', '酉고떚쨌?⑥뀡': 'content_cut', '?먮꼫吏쨌?섍꼍': 'eco', '?몄떇?끒룹냼?곴났??: 'restaurant', '?곗＜쨌??났': 'rocket', '?좏넻쨌臾쇰쪟': 'local_shipping', '?쒖“쨌嫄댁꽕': 'factory', '?뚮옯?셋룹빱裕ㅻ땲??: 'groups' };
    return map[ind] || 'corporate_fare';
}

function escapeHtml(t) {
    if (!t) return "";
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function exportToCSV() {
    if (filteredCompanies.length === 0) { alert('?곗씠?곌? ?놁뒿?덈떎.'); return; }
    const headers = ['湲곗뾽紐?, '?곗뾽', '?붿빟', '留ㅼ텧????', '?꾩쟻?ъ옄湲???', '?대떦??, '?섏젙??];
    const rows = filteredCompanies.map(c => {
        const metrics = getLatestMetrics(c);
        const summary = (c.summary || "").replace(/\n/g, ' ');
        return [
            c.companyName, c.industry, summary, metrics.revenue.value || '0', metrics.investment.value || '0',
            userMap[c.user_id]?.name || 'Unknown', new Date(c.updated_at || c.created_at).toLocaleDateString()
        ].map(f => `"${String(f).replace(/"/g, '""')}"`);
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `DealChat_TotalStartupHub_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
