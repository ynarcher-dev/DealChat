import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader, resolveAvatarUrl, DEFAULT_MANAGER } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

// 수파베이스 클라이언트 초기화 통합
const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

let currentPage = 1;
const itemsPerPage = 15;
let allCompanies = [];
let userMap = {};
let filteredCompanies = [];
let currentuser_id = null;
let currentSort = 'latest';

let shareTargetCompanyId = null;
let selectedReceivers = [];

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

    // Header profile and menu are now initialized globally by header_loader.js

    loadCompanies(user_id);

    $('#search-btn').on('click', () => { currentPage = 1; applyFilters(); });
    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) { currentPage = 1; applyFilters(); }
    });

    $('#filter-toggle-btn').on('click', function () {
        const $container = $('#filter-container');
        const isVisible = $container.is(':visible');
        $container.slideToggle();
        $(this).toggleClass('active', !isVisible);
    });

    $(document).on('change', '.industry-checkbox, .mgmt-checkbox, .visibility-checkbox', () => {
        currentPage = 1;
        applyFilters();
    });

    $(document).on('change', '.stage-checkbox', function () {
        const clickedValue = $(this).val();
        if (clickedValue === 'all' && $(this).is(':checked')) {
            $('.stage-checkbox').not(this).prop('checked', false);
        } else if (clickedValue !== 'all') {
            $('#filter-stage-all').prop('checked', false);
        }
        currentPage = 1;
        applyFilters();
    });

    $('#reset-filters').on('click', function () {
        $('.industry-checkbox, .mgmt-checkbox, .visibility-checkbox, .stage-checkbox').prop('checked', false);
        $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').val('');
        applyFilters();
    });

    $('#new-btn').on('click', () => {
        location.href = `./dealbook_companies.html?id=new`;
    });

    $('#filter-min-revenue, #filter-max-revenue, #filter-min-investment, #filter-max-investment').on('input', applyFilters);

    $(document).on('click', '.sort-option', function (e) {
        e.preventDefault();
        $('.sort-option').removeClass('active');
        $(this).addClass('active');
        $('#current-sort-label').text($(this).text());
        currentSort = $(this).data('sort');
        applyFilters();
    });

    $('#export-csv-btn').on('click', exportToCSV);

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
        if (selectedReceivers.length === 0) { alert('공유할 대상을 1명 이상 선택해 주세요.'); return; }
        const memo = $('#share-memo').val().trim();
        const btn = this;
        $(btn).prop('disabled', true).text('전송 중...');

        const selectedFileIds = [];
        $('.share-file-checkbox:checked').each(function() {
            selectedFileIds.push($(this).val());
        });

        const sharePromises = selectedReceivers.map(uid => {
            return APIcall({
                table: 'shares',
                action: 'create',
                item_type: 'company',
                item_id: shareTargetCompanyId,
                sender_id: currentuser_id,
                receiver_id: uid,
                memo: memo,
                file_ids: selectedFileIds,
                is_read: false
            }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(res => res.json());
        });
        Promise.all(sharePromises).then(results => {
            const errs = results.filter(r => r.error);
            if (errs.length > 0) alert(`${errs.length}건의 공유 중 오류 발생.`);
            else {
                alert(`${selectedReceivers.length}명의 대상에게 공유되었습니다.`);
                bootstrap.Modal.getInstance(document.getElementById('share-modal')).hide();
            }
        }).catch(e => { 
            console.error('Share Error', e); 
            alert('공유 요청 실패: ' + (e.message || '알 수 없는 오류')); 
        })
        .finally(() => $(btn).prop('disabled', false).text('보내기'));
    });

    $('#btn-share-with-user-trigger').on('click', function() {
        bootstrap.Modal.getInstance(document.getElementById('share-options-modal')).hide();
        const modal = new bootstrap.Modal(document.getElementById('share-modal'));
        modal.show();
    });

    $('#btn-share-url').on('click', function() {
        const url = `${window.location.origin}/html/dealbook_companies.html?id=${shareTargetCompanyId}&from=mystartup`;
        navigator.clipboard.writeText(url).then(() => {
            alert('URL이 클립보드에 복사되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('share-options-modal')).hide();
        });
    });
});

async function fetchFiles(companyId) {
    const $fileList = $('#share-file-selection-list');
    $fileList.html('<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>');

    try {
        const { data, error } = await _supabase
            .from('files')
            .select('*')
            .eq('company_id', companyId)
            .is('deleted_at', null);

        if (error) throw error;

        $fileList.empty();
        if (!data || data.length === 0) {
            $fileList.html('<div class="text-muted p-1" style="font-size: 13px;">선택할 수 있는 파일이 없습니다.</div>');
            return;
        }

        data.forEach(file => {
            $fileList.append(`
                <div class="form-check mb-1">
                    <input class="form-check-input share-file-checkbox" type="checkbox" value="${file.id}" id="file-${file.id}">
                    <label class="form-check-label d-flex align-items-center gap-2" for="file-${file.id}" style="font-size: 13px; cursor: pointer;">
                        <span class="material-symbols-outlined" style="font-size: 16px; color: #64748b;">description</span>
                        <span class="text-truncate" style="max-width: 250px;">${escapeHtml(file.file_name || file.name)}</span>
                    </label>
                </div>
            `);
        });
    } catch (err) {
        console.error('Fetch Files Error:', err);
        $fileList.html('<div class="text-danger p-1" style="font-size: 13px;">파일을 불러오는 중 오류가 발생했습니다.</div>');
    }
}

function addSelectedUser(id, name) {
    if (selectedReceivers.includes(id)) return;
    selectedReceivers.push(id);
    renderSelectedTags();
}

function renderSelectedTags() {
    const $container = $('#selected-users-container');
    if (selectedReceivers.length === 0) {
        $container.html('<span class="text-muted p-1" style="font-size: 13px;">이름으로 대상을 검색하세요.</span>');
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

async function loadCompanies(user_id) {
    if (!user_id) return;
    $('#company-list-container').html('<tr><td colspan="8" class="text-center py-5">데이터를 불러오는 중...</td></tr>');

    try {
        // 내 기업 정보 및 전체 사용자 정보 로드
        const [usersRes, companiesRes] = await Promise.all([
            _supabase.from('users').select('*'),
            _supabase.from('companies').select('*').eq('user_id', user_id).is('deleted_at', null)
        ]);

        if (usersRes.error) throw usersRes.error;
        if (companiesRes.error) throw companiesRes.error;

        userMap = {};
        (usersRes.data || []).forEach(u => {
            userMap[u.id] = {
                name: u.name || "정보 없음",
                affiliation: u.company || 'DealChat',
                email: u.email || '',
                avatar: u.avatar_url || null
            };
        });

        allCompanies = companiesRes.data || [];
        updateFilterOptions();
        applyFilters();
    } catch (error) {
        console.error('Load Error:', error);
        $('#company-list-container').html('<tr><td colspan="8" class="text-center py-5 text-danger">오류가 발생했습니다.</td></tr>');
    } finally {
        hideLoader();
    }
}

function getLatestMetrics(data) {
    const res = { revenue: { value: "-", year: "" }, investment: { value: "-", year: "" } };
    
    // 매출액: 가장 최근 연도의 매출액
    if (data.financial_info && Array.isArray(data.financial_info) && data.financial_info.length > 0) {
        const sorted = data.financial_info
            .map(item => ({ year: parseInt(item.year) || 0, value: item.revenue || 0 }))
            .sort((a, b) => b.year - a.year);
        
        if (sorted.length > 0 && (sorted[0].value || sorted[0].value === 0)) {
            const revInWon = extractNumber(sorted[0].value);
            // 억 단위로 변환 (천만 단위 이하 절삭 후 소수점 첫째 자리까지)
            const revInBillion = Math.trunc(revInWon / 10000000) / 10;
            res.revenue.value = revInBillion.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            res.revenue.year = sorted[0].year > 0 ? sorted[0].year.toString() : '';
        }
    }

    // 누적투자금: 모든 연도의 투자금 합계 계산 + 가장 최근 단계 추출
    if (data.investment_info && Array.isArray(data.investment_info) && data.investment_info.length > 0) {
        let totalVal = 0;
        let hasData = false;
        
        const sortedInv = [...data.investment_info]
            .map(item => ({ year: parseInt(item.year) || 0, stage: item.stage || '', amount: item.amount || 0 }))
            .sort((a, b) => b.year - a.year);

        data.investment_info.forEach(item => {
            const val = extractNumber(item.amount || 0);
            if (val > 0) {
                totalVal += val;
                hasData = true;
            }
        });
        if (hasData) {
            // 천만 단위 이하 절삭
            const totalInBillion = Math.floor(totalVal / 10000000) / 10;
            res.investment.value = totalInBillion.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            res.investment.year = sortedInv.length > 0 && sortedInv[0].stage ? sortedInv[0].stage : "누적";
        }
    }
    return res;
}

function getIndustryIcon(ind) {
    const map = { 'AI': 'smart_toy', 'IT·정보통신': 'computer', 'SaaS·솔루션': 'cloud', '게임': 'sports_esports', '공공·국방': 'policy', '관광·레저': 'beach_access', '교육·에듀테크': 'school', '금융·핀테크': 'payments', '농축산·어업': 'agriculture', '라이프스타일': 'person', '모빌리티': 'directions_car', '문화예술·콘텐츠': 'movie', '바이오·헬스케어': 'medical_services', '부동산': 'real_estate_agent', '뷰티·패션': 'content_cut', '에너지·환경': 'eco', '외식·중소상공인': 'restaurant', '우주·항공': 'rocket', '유통·물류': 'local_shipping', '제조·건설': 'factory', '플랫폼·커뮤니티': 'groups' };
    return map[ind] || 'corporate_fare';
}

function renderCompanies() {
    const $container = $('#company-list-container');
    $container.empty();
    if (filteredCompanies.length === 0) { $container.html('<tr><td colspan="8" class="text-center py-5 text-muted">일치하는 기업 정보가 없습니다.</td></tr>'); return; }
    
    const start = (currentPage - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, filteredCompanies.length);
    const items = filteredCompanies.slice(start, end);

    items.forEach(c => {
        const date = new Date(c.updated_at || c.created_at).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
        const authorData = userMap[c.user_id] || DEFAULT_MANAGER;
        const metrics = getLatestMetrics(c);
        
        $container.append(`<tr onclick="showCompanyDetail('${c.id}')" style="cursor: pointer;">
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <div class="d-flex align-items-center gap-3">
                    <div style="width: 36px; height: 36px; background: ${c.is_draft ? '#94a3b8' : '#1A73E8'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-symbols-outlined" style="color: #ffffff; font-size: 20px;">${c.is_draft ? 'lock' : getIndustryIcon(c.industry)}</span>
                    </div>
                    <span class="company-name-td text-truncate ${c.is_draft ? 'text-muted' : ''}" style="max-width: 140px;">${escapeHtml(c.company_name || c.name)}</span>
                </div>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <span class="industry-tag-td" style="${c.is_draft ? 'background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;' : ''}">${escapeHtml(c.industry || "기타")}</span>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                <div style="font-size: 13px; font-weight: 500; color: #1e293b;">
                    ${metrics.revenue.value !== '-' ? `<span style="color: ${c.is_draft ? '#64748b' : '#000000'}; font-weight: 700;">${metrics.revenue.value}억</span>` : '-'}
                    ${metrics.revenue.year ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 400; margin-top: 2px;">${metrics.revenue.year}</div>` : ''}
                </div>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                <div style="font-size: 13px; font-weight: 500; color: #1e293b;">
                    ${metrics.investment.value !== '-' ? `<span style="color: ${c.is_draft ? '#64748b' : '#000000'}; font-weight: 700;">${metrics.investment.value}억</span>` : '-'}
                    ${metrics.investment.year ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 400; margin-top: 2px;">${metrics.investment.year}</div>` : ''}
                </div>
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc;">
                <div class="summary-td" style="${c.is_draft ? 'color: #cbd5e1;' : ''}">${escapeHtml(c.summary)}</div>
                ${c.mgmt_status ? `<div><span class="badge border" style="background: ${c.is_draft ? '#f8fafc' : '#f0f7ff'}; color: ${c.is_draft ? '#94a3b8' : '#1A73E8'}; border-color: ${c.is_draft ? '#e2e8f0' : '#dbeafe'} !important; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-top: 4px; display: inline-block;">#${escapeHtml(c.mgmt_status.replace(/\s+/g, ''))}</span></div>` : ''}
            </td>
            <td style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;" data-user-id="${c.user_id}" class="author-cell-clickable" onclick="event.stopPropagation(); if (window.showProfileModal) { window.showProfileModal('${c.user_id}'); }">
                <div class="author-td">
                    <img src="${resolveAvatarUrl(authorData.avatar || authorData.avatar_url, 1)}" class="author-avatar-sm">
                    <div class="author-info-wrap">
                        <div class="author-name-td" style="color: #000000; font-weight: 700;">${escapeHtml(authorData.name)}</div>
                        <div class="author-affiliation-td" style="margin-top: 2px;">${escapeHtml(authorData.affiliation)}</div>
                    </div>
                </div>
            </td>
            <td class="date-td" style="padding: 20px 24px !important; border-right: 1px solid #f8fafc; text-align: left !important; ${c.is_draft ? 'color: #cbd5e1;' : ''}">${date}</td>
            <td style="padding: 20px 24px !important;" onclick="event.stopPropagation();">
                <button class="row-action-btn btn-hover-blue" onclick="openShareOptions('${c.id}')"><span class="material-symbols-outlined" style="font-size: 18px;">share</span></button>
            </td>
        </tr>`);
    });
}

window.showCompanyDetail = function (id) {
    const c = allCompanies.find(x => x.id === id);
    if (!c) return;
    const authorData = userMap[c.user_id] || DEFAULT_MANAGER;

    $('#detail-company-icon').text(getIndustryIcon(c.industry));
    $('#detail-company-name').text(c.company_name || c.name);
    $('#detail-company-summary').text(c.summary);

    const indContainer = $('#detail-industry-container').empty();
    if (c.industry) indContainer.append(`<span class="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill" style="font-weight: 600; font-size: 13px;">#${escapeHtml(c.industry)}</span>`);

    const createdDate = new Date(c.created_at);
    const updatedDate = c.updated_at ? new Date(c.updated_at) : null;
    const formatDate = (date) => date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    
    const dateDisplay = (updatedDate && updatedDate.getTime() !== createdDate.getTime())
        ? `최종 수정: ${formatDate(updatedDate)}`
        : `등록일: ${formatDate(createdDate)}`;

    $('#detail-author-name').text(authorData.name || '정보 없음').css('color', '#1e293b').css('font-weight', '700');
    const authorSubInfo = authorData.affiliation || 'DealChat';
    $('#detail-author-affiliation').text(authorSubInfo);
    $('#detail-modified-date').text(dateDisplay);

    const avatarUrl = resolveAvatarUrl(authorData.avatar || authorData.avatar_url, 1);
    $('#detail-author-avatar').attr('src', avatarUrl);

    // Profile modal link disabled (요청에 따라 제거)
    $('#detail-author-info-box').css('cursor', 'default').off('click');

    $('#go-to-dealbook').off('click').on('click', () => {
        const $loader = $('#transition-loader');
        $loader.css('display', 'flex');
        setTimeout(() => {
            location.href = `./dealbook_companies.html?id=${encodeURIComponent(id)}`;
        }, 600);
    });

    bootstrap.Modal.getOrCreateInstance(document.getElementById('company-detail-modal')).show();
};

window.openShareOptions = function (id) {
    shareTargetCompanyId = id;
    selectedReceivers = [];
    renderSelectedTags();
    $('#share-memo').val('');
    fetchFiles(id);
    new bootstrap.Modal(document.getElementById('share-options-modal')).show();
};

function renderPagination() {
    const $container = $('#pagination-container').empty();
    const total = Math.ceil(filteredCompanies.length / itemsPerPage);
    if (total <= 1) return;
    const prevD = currentPage === 1 ? 'disabled' : '';
    const nextD = currentPage === total ? 'disabled' : '';
    
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${prevD} onclick="changePage(1)" style="width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; color: #64748b; display: flex; align-items: center; justify-content: center; padding: 0;"><span class="material-symbols-outlined" style="font-size: 18px;">keyboard_double_arrow_left</span></button>`);
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${prevD} onclick="changePage(${currentPage - 1})" style="width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; color: #64748b; display: flex; align-items: center; justify-content: center; padding: 0;"><span class="material-symbols-outlined" style="font-size: 18px;">chevron_left</span></button>`);
    
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    
    for (let i = start; i <= end; i++) {
        const activeStyle = i === currentPage ? 'background: #1A73E8; color: #ffffff; border-color: #1A73E8; font-weight: 600;' : 'background: #ffffff; color: #64748b; border-color: #e2e8f0;';
        $container.append(`<button class="btn btn-outline-light pagination-btn" onclick="changePage(${i})" style="width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; padding: 0; font-size: 13px; ${activeStyle}">${i}</button>`);
    }
    
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${nextD} onclick="changePage(${currentPage + 1})" style="width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; color: #64748b; display: flex; align-items: center; justify-content: center; padding: 0;"><span class="material-symbols-outlined" style="font-size: 18px;">chevron_right</span></button>`);
    $container.append(`<button class="btn btn-outline-light pagination-btn" ${nextD} onclick="changePage(${total})" style="width: 36px; height: 36px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; color: #64748b; display: flex; align-items: center; justify-content: center; padding: 0;"><span class="material-symbols-outlined" style="font-size: 18px;">keyboard_double_arrow_right</span></button>`);
}

window.changePage = function (p) {
    currentPage = p;
    renderCompanies();
    renderPagination();
};

function updateFilterOptions() {
    const $list = $('#filter-industry-list');
    const selected = $('.industry-checkbox:checked').map(function () { return this.value; }).get();
    const categories = ["AI", "IT·정보통신", "SaaS·솔루션", "게임", "공공·국방", "관광·레저", "교육·에듀테크", "금융·핀테크", "농축산·어업", "라이프스타일", "모빌리티", "문화예술·콘텐츠", "바이오·헬스케어", "부동산", "뷰티·패션", "에너지·환경", "외식·중소상공인", "우주·항공", "유통·물류", "제조·건설", "플랫폼·커뮤니티", "기타"];
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
    const keyword = ($('#search-input').val() || "").toLowerCase();
    const selectedIndustries = $('.industry-checkbox:checked').map(function() { return this.value; }).get();
    const selectedMgmt = $('.mgmt-checkbox:checked').map(function() { return this.value; }).get();
    const selectedStages = $('.stage-checkbox:checked').map(function() { return this.value; }).get();
    const selectedVis = $('.visibility-checkbox:checked').map(function() { return this.value; }).get();
    
    const minRev = parseFloat($('#filter-min-revenue').val()) || -Infinity;
    const maxRev = parseFloat($('#filter-max-revenue').val()) || Infinity;
    const minInv = parseFloat($('#filter-min-investment').val()) || -Infinity;
    const maxInv = parseFloat($('#filter-max-investment').val()) || Infinity;

    filteredCompanies = allCompanies.filter(c => {
        const matchesKeyword = !keyword || 
            (c.company_name && c.company_name.toLowerCase().includes(keyword)) ||
            (c.name && c.name.toLowerCase().includes(keyword)) ||
            (c.industry && c.industry.toLowerCase().includes(keyword)) ||
            (c.summary && c.summary.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;

        const companyIndustry = c.industry || "기타";
        const matchesInd = selectedIndustries.length === 0 || selectedIndustries.some(ind => {
            if (ind === '기타') return companyIndustry === '기타' || companyIndustry.startsWith('기타: ');
            return companyIndustry === ind;
        });
        if (!matchesInd) return false;

        const matchesMgmt = selectedMgmt.length === 0 || (c.mgmt_status && selectedMgmt.includes(c.mgmt_status));
        if (!matchesMgmt) return false;

        // Visibility match - public (!is_draft), private (is_draft)
        const matchesVis = selectedVis.length === 0 || selectedVis.some(v => {
            if (v === 'public') return !c.is_draft;
            if (v === 'private') return !!c.is_draft;
            return false;
        });
        if (!matchesVis) return false;

        // Investment Stage match - Bypass if 'all' is selected or nothing is selected
        if (selectedStages.length > 0 && !selectedStages.includes('all')) {
            const latestStage = getLatestStage(c);
            const matchesStage = selectedStages.some(s => matchStageFilter(latestStage, s));
            if (!matchesStage) return false;
        }
        
        const metrics = getLatestMetrics(c);
        const revVal = extractNumber(metrics.revenue.value);
        const invVal = extractNumber(metrics.investment.value);
        
        return revVal >= minRev && revVal <= maxRev && invVal >= minInv && invVal <= maxInv;
    });

    applySort(currentSort);
}

function applySort(type) {
    if (type === 'latest') {
        filteredCompanies.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    } else if (type === 'name') {
        filteredCompanies.sort((a, b) => (a.company_name || a.name || "").localeCompare(b.company_name || b.name || "", 'ko-KR'));
    } else if (type === 'revenue') {
        filteredCompanies.sort((a, b) => (parseFloat(getLatestMetrics(b).revenue.value) || 0) - (parseFloat(getLatestMetrics(a).revenue.value) || 0));
    } else if (type === 'investment') {
        filteredCompanies.sort((a, b) => (parseFloat(getLatestMetrics(b).investment.value) || 0) - (parseFloat(getLatestMetrics(a).investment.value) || 0));
    }
    
    currentPage = 1;
    renderCompanies();
    renderPagination();
}

function getLatestStage(company) {
    if (company.investment_info && Array.isArray(company.investment_info) && company.investment_info.length > 0) {
        const sorted = [...company.investment_info]
            .map(item => ({ year: parseInt(item.year) || 0, stage: (item.stage || '').trim() }))
            .sort((a, b) => b.year - a.year);
        if (sorted.length > 0 && sorted[0].stage) return sorted[0].stage;
    }
    return '';
}

function matchStageFilter(actualStage, filterValue) {
    if (!actualStage) return false;
    const s = actualStage.toLowerCase().replace(/\s+/g, '');
    const f = filterValue.toLowerCase().replace(/\s+/g, '');
    if (s === f) return true;
    switch (f) {
        case 'seed': return s.includes('seed') || s.includes('시드');
        case 'pre-a': return s.includes('pre-a') || s.includes('pre a') || s.includes('프리a') || s.includes('프리에이');
        case 'seriesa': return (s.includes('series') || s.includes('시리즈')) && s.includes('a') && !s.includes('pre') && !s.includes('프리');
        case 'seriesb+': return (s.includes('series') || s.includes('시리즈')) && /[bcd]/.test(s);
        case 'm&a': return s.includes('m&a') || s.includes('인수') || s.includes('합병');
        case 'ipo': return s.includes('ipo');
        default: return s.includes(f);
    }
}


function extractNumber(str) {
    if (!str || str === '-') return 0;
    const sanitized = String(str).replace(/,/g, '');
    const match = sanitized.match(/-?[0-9.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function exportToCSV() {
    if (filteredCompanies.length === 0) { alert('데이터가 없습니다.'); return; }
    const headers = ['기업명', '산업', '매출액(억)', '누적투자금(억)', '요약', '수정일'];
    const rows = filteredCompanies.map(c => {
        const metrics = getLatestMetrics(c);
        const summary = (c.summary || "").replace(/\n/g, ' ');
        const date = new Date(c.updated_at || c.created_at).toLocaleDateString('ko-KR');
        return [
            c.company_name || c.name, c.industry || "기타", 
            metrics.revenue.value || '0', metrics.investment.value || '0', 
            summary, date
        ].map(f => `"${String(f).replace(/"/g, '""')}"`);
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `DealChat_MyCompanies_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
