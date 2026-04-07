import { checkAuth, hideLoader, showLoader, resolveAvatarUrl } from './auth_utils.js';

const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

const NAVY = '#1E293B';
const NAVY_LIGHT = '#f1f5f9';
const NAVY_MID = '#334155';

let currentPage = 1;
const itemsPerPage = 15;
let allSharedItemsSent = [];
let allSharedItemsReceived = [];
let filteredItems = [];
let currentSort = 'newest';
let currentTypeFilter = 'all';
let currentDirFilter = 'received'; // 'received' or 'sent'
let userMap = {};
let currentuser_id = null;
let signedNdaSet = new Set();
let unreadOnly = false;

function escapeHtml(unsafe) {
    if (!unsafe && unsafe !== 0) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}.${day} ${hours}:${minutes}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

$(document).ready(function () {
    const userData = checkAuth();
    if (!userData) return;
    currentuser_id = userData.id;

    // 상단바 프로필 및 메뉴 인터랙션은 header_loader.js에서 통합 관리합니다.

    // URL 파라미터 확인 (예: ?tab=sent)
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam === 'sent') {
        currentDirFilter = 'sent';
        $('.dir-tab-btn').removeClass('active');
        $('#tab-sent').addClass('active');
        
        // 레이블 수동 업데이트 (클릭 핸들러 로직과 동일)
        $('#person-col-label').text('수신자');
        $('#confirm-col-label').text('발신 확인');
        $('#empty-title').text('공유한 항목이 없습니다');
        $('#empty-desc').text('바이어나 타인에게 정보를 공유하면 여기서 내역을 확인할 수 있습니다.');
    }

    loadData();

    // Direction (수신/발신) Tabs
    $(document).on('click', '.dir-tab-btn', function() {
        currentDirFilter = $(this).data('dir');
        $('.dir-tab-btn').removeClass('active');
        $(this).addClass('active');
        
        // Update labels
        if (currentDirFilter === 'received') {
            $('#person-col-label').text('발신자');
            $('#confirm-col-label').text('수신 확인');
            $('#empty-title').text('공유받은 항목이 없습니다');
            $('#empty-desc').text('타인이 기업·바이어·매도자 정보를 공유하면 여기서 확인할 수 있습니다.');
        } else {
            $('#person-col-label').text('수신자');
            $('#confirm-col-label').text('발신 확인');
            $('#empty-title').text('공유한 항목이 없습니다');
            $('#empty-desc').text('바이어나 타인에게 정보를 공유하면 여기서 내역을 확인할 수 있습니다.');
        }

        currentPage = 1;
        applyFilters();
    });

    // Search
    $('#search-btn').on('click', () => { currentPage = 1; applyFilters(); });
    $('#search-input').on('keypress', (e) => { if (e.which === 13) { currentPage = 1; applyFilters(); } });

    // Sort
    $(document).on('click', '.sort-option', function (e) {
        e.preventDefault();
        currentSort = $(this).data('sort');
        $('#current-sort-label').text($(this).text());
        $('.sort-option').removeClass('active');
        $(this).addClass('active');
        currentPage = 1;
        applyFilters();
    });

    // Type Tab Filters
    $(document).on('click', '.type-tab-btn', function () {
        currentTypeFilter = $(this).data('type');
        currentPage = 1;
        $('.type-tab-btn').each(function () {
            const isActive = $(this).data('type') === currentTypeFilter;
            $(this).toggleClass('active', isActive);
            $(this).css({
                background: isActive ? NAVY : '#ffffff',
                borderColor: isActive ? NAVY : '#e2e8f0',
                color: isActive ? '#ffffff' : '#64748b'
            });
        });
        applyFilters();
    });

    // Unread Only Toggle
    $(document).on('click', '#unread-only-btn', function() {
        unreadOnly = !unreadOnly;
        if (unreadOnly) {
            $(this).css({ background: '#ef4444', color: '#fff' }).find('.material-symbols-outlined').text('mail_outline');
        } else {
            $(this).css({ background: 'transparent', color: '#ef4444' }).find('.material-symbols-outlined').text('mail');
        }
        currentPage = 1;
        applyFilters();
    });
});

// ==========================================
// Data Loading
// ==========================================

async function loadData() {
    try {
        // 1. Load all users (to map sender/receiver names)
        const { data: users, error: usersError } = await _supabase.from('users').select('*');
        if (usersError) throw usersError;

        userMap = {};
        (users || []).forEach(u => {
            userMap[u.id] = {
                name: u.name || 'Unknown',
                affiliation: u.company || 'DealChat',
                avatar: u.avatar_url || u.avatar || null
            };
        });

        // 2. Load all shares where user is either sender or receiver
        const { data: shares, error: sharesError } = await _supabase
            .from('shares')
            .select('*')
            .or(`sender_id.eq.${currentuser_id},receiver_id.eq.${currentuser_id}`)
            .order('created_at', { ascending: false });

        if (sharesError) throw sharesError;

        // 3. Load NDA logs for the current user
        const { data: ndaLogs } = await _supabase.from('nda_logs').select('seller_id, item_id').eq('user_id', currentuser_id);
        signedNdaSet = new Set();
        (ndaLogs || []).forEach(log => {
            if (log.seller_id) signedNdaSet.add(String(log.seller_id));
            if (log.item_id) signedNdaSet.add(String(log.item_id));
        });

        if (!shares || shares.length === 0) {
            hideLoader();
            showEmpty();
            return;
        }

        // 3. Extract unique item IDs to fetch details
        const companyIds = [...new Set(shares.filter(s => s.item_type === 'company').map(s => s.item_id))];
        const buyerIds   = [...new Set(shares.filter(s => s.item_type === 'buyer').map(s => s.item_id))];
        const sellerIds  = [...new Set(shares.filter(s => s.item_type === 'seller').map(s => s.item_id))];

        const [companiesRes, buyersRes, sellersRes] = await Promise.all([
            companyIds.length > 0
                ? _supabase.from('companies').select('id, name, industry, summary, is_draft').in('id', companyIds).is('deleted_at', null)
                : Promise.resolve({ data: [], error: null }),
            buyerIds.length > 0
                ? _supabase.from('buyers').select('id, company_name, interest_industry, interest_summary, is_draft').in('id', buyerIds)
                : Promise.resolve({ data: [], error: null }),
            sellerIds.length > 0
                ? _supabase.from('sellers').select('id, name, industry, summary, is_draft').in('id', sellerIds)
                : Promise.resolve({ data: [], error: null }),
        ]);

        const companyMap = {};
        (companiesRes.data || []).forEach(c => { companyMap[String(c.id)] = c; });
        const buyerMap = {};
        (buyersRes.data || []).forEach(b => { buyerMap[String(b.id)] = b; });
        const sellerMap = {};
        (sellersRes.data || []).forEach(s => {
            s._displayName = s.name || '이름 없음';
            sellerMap[String(s.id)] = s;
        });

        // 4. Merge and Split into Sent/Received
        const processedShares = shares.map(share => {
            let itemDetail = null;
            let itemName = '대상 정보 없음';
            let industry = '';
            let itemSummary = '';

            const sid = String(share.item_id);
            const isSigned = signedNdaSet.has(sid);

            if (share.item_type === 'company') {
                itemDetail = companyMap[sid];
                industry = itemDetail?.industry || '';
                itemSummary = itemDetail?.summary || '';
                itemName = itemDetail?.name || '삭제된 기업';
                // 기업명은 일괄 공개 (유지 요청)
            } else if (share.item_type === 'buyer') {
                itemDetail = buyerMap[sid];
                industry = itemDetail?.interest_industry || itemDetail?.industry || '';
                itemSummary = itemDetail?.interest_summary || '';
                
                // 바이어는 !isSigned면 무조건 비공개(유지 요청)
                if (!isSigned && share.receiver_id === currentuser_id) {
                    itemName = 'NDA필요';
                } else {
                    itemName = itemDetail?.company_name || '삭제된 바이어';
                }
            } else if (share.item_type === 'seller') {
                itemDetail = sellerMap[sid];
                industry = itemDetail?.industry || '';
                itemSummary = itemDetail?.summary || '';
                
                // 매도자는 !isSigned면 무조건 비공개(유지 요청)
                if (!isSigned && share.receiver_id === currentuser_id) {
                    itemName = 'NDA필요';
                } else {
                    itemName = itemDetail?._displayName || '삭제된 매도자';
                }
            }

            const isDraft = !!itemDetail?.is_draft;
            return { 
                ...share, 
                itemName, 
                industry, 
                itemSummary, 
                itemFound: !!itemDetail, 
                is_draft: isDraft, 
                displayVisibility: isDraft ? '비공개' : '공개' 
            };
        });

        allSharedItemsReceived = processedShares.filter(s => s.receiver_id === currentuser_id && !s.receiver_deleted);
        allSharedItemsSent = processedShares.filter(s => s.sender_id === currentuser_id && !s.sender_deleted);

        applyFilters();
        updateDirectionBadges();

    } catch (err) {
        console.error('공유 목록 로드 실패:', err);
        $('#shared-items-list').html(
            `<div class="text-center text-danger py-5">데이터를 불러오는 중 오류가 발생했습니다.</div>`
        );
    } finally {
        hideLoader();
    }
}

// ==========================================
// Filter & Sort
// ==========================================

function updateDirectionBadges() {
    const unreadReceived = allSharedItemsReceived.filter(s => !s.is_read).length;
    const unreadSent = allSharedItemsSent.filter(s => !s.is_read).length;
    
    const applyBadgeStyle = ($el, count) => {
        $el.text(count).show();
        if (count > 0) {
            $el.css({
                background: '#ef4444',
                color: '#fff',
                boxShadow: '0 2px 4px rgba(239,68,68,0.3)'
            });
        } else {
            $el.css({
                background: '#64748b',
                color: '#fff',
                boxShadow: 'none'
            });
        }
    };

    applyBadgeStyle($('#received-unread-badge'), unreadReceived);
    applyBadgeStyle($('#sent-unread-badge'), unreadSent);
}

function applyFilters() {
    const keyword = ($('#search-input').val() || '').trim().toLowerCase();
    let items = (currentDirFilter === 'received') ? [...allSharedItemsReceived] : [...allSharedItemsSent];

    if (currentTypeFilter !== 'all') {
        items = items.filter(item => item.item_type === currentTypeFilter);
    }

    if (unreadOnly) {
        items = items.filter(item => !item.is_read);
    }

    if (keyword) {
        items = items.filter(item => {
            const matchesName = item.itemName.toLowerCase().includes(keyword);
            const matchesMemo = (item.memo || '').toLowerCase().includes(keyword);
            const matchesInd = (item.industry || '').toLowerCase().includes(keyword);
            
            // For received, search sender. For sent, search receiver.
            const personId = (currentDirFilter === 'received') ? item.sender_id : item.receiver_id;
            const personName = (userMap[personId]?.name || '').toLowerCase();
            const matchesPerson = personName.includes(keyword);

            return matchesName || matchesMemo || matchesInd || matchesPerson;
        });
    }

    items.sort((a, b) => {
        const da = new Date(a.created_at), db = new Date(b.created_at);
        return currentSort === 'newest' ? db - da : da - db;
    });

    filteredItems = items;

    // 카운트 텍스트 삭제 (유지 요청)
    $('#total-count-badge').text('');

    if (filteredItems.length === 0) {
        showEmpty();
    } else {
        $('#empty-state').hide();
        renderList();
        renderPagination();
    }
}

// ==========================================
// Rendering
// ==========================================

function getTypeConfig(type) {
    return {
        company: { label: 'Company', icon: 'corporate_fare', color: '#1d4ed8', bg: '#dbeafe', detailPage: 'dealbook_companies.html' },
        buyer:   { label: 'Buyer', icon: 'person_search', color: '#0f766e', bg: '#ccfbf1', detailPage: 'dealbook_buyers.html' },
        seller:  { label: 'Seller', icon: 'storefront', color: '#7c3aed', bg: '#ede9fe', detailPage: 'dealbook_sellers.html' },
    }[type] || { label: type, icon: 'info', color: '#64748b', bg: '#f1f5f9', detailPage: 'index.html' };
}

function renderList() {
    const $list = $('#shared-items-list');
    $list.empty();

    const start = (currentPage - 1) * itemsPerPage;
    const pageItems = filteredItems.slice(start, start + itemsPerPage);

    pageItems.forEach(item => {
        const cfg = getTypeConfig(item.item_type);
        
        // Person info (Sender for received, Receiver for sent)
        const personId = (currentDirFilter === 'received') ? item.sender_id : item.receiver_id;
        const person = userMap[personId] || { name: '정보 없음', avatar: null, affiliation: '-' };
        const personAvatar = resolveAvatarUrl(person.avatar);
        
        const isUnread = !item.is_read;
        const isReceived = (currentDirFilter === 'received');

        // Item name display: simple name
        let nameDisplay = `<span style="color:#000000; font-weight:700;">${escapeHtml(item.itemName)}</span>`;
        if (isReceived && isUnread) {
            // For received unread, keep name '비공개' but we can show it now as per request change? 
            // Actually instructions said fix item name generic issue.
            // If they read it, they see it. If not, maybe still hidden but let's see.
            // User said: "대상명(정보없는 매도자가 나오는데 이유 확인)" - this implies they WANT to see the name or at least know why it's missing.
            // Let's keep the '비공개' logic for NDA items if unread, but if it's not NDA, maybe show it?
            // Actually, let's simplify as requested: "읽지 않았을 경우 유형 앞에 빨간 점으로 표시"
            // So I'll show the name now but with a red dot on type.
        }

        // Show industry tag for all types
        const industryDisplay = (item.industry)
            ? `<div style="font-size:12px;color:${cfg.color};margin-top:3px;font-weight:600;">${escapeHtml(item.industry)}</div>`
            : '';

        const memoDisplay = item.memo
            ? escapeHtml(item.memo)
            : `<span style="color:#cbd5e1; font-style:italic;">메모 없음</span>`;

        // Confirmation Column
        let confirmDisplay = '';
        if (isUnread) {
            confirmDisplay = `<span style="color:#ef4444; font-weight:700;">읽지 않음</span>`;
        } else {
            // If read, show time. Same color as shared date (#94a3b8)
            confirmDisplay = `<span style="color:#94a3b8; font-weight:600;">${formatDateTime(item.updated_at || item.created_at)}</span>`;
        }

        const row = $(`
            <div class="shared-list-row" data-id="${escapeHtml(item.id)}">
                <div style="width:100px; flex-shrink:0;">
                    <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${cfg.bg};color:${cfg.color};">
                        <span class="material-symbols-outlined" style="font-size:12px;">${cfg.icon}</span>
                        ${cfg.label}
                    </span>
                </div>

                <!-- Item name -->
                <div style="width:200px; flex-shrink:0; padding-right:16px; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span style="color:#000000; font-weight:600;" title="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)}</span>
                    ${industryDisplay}
                </div>

                <!-- Visibility Status (공개/비공개) -->
                <div style="width:120px; flex-shrink:0; font-size:13px; color:#1e293b; display:flex; align-items:center; text-align:left; font-weight:700;">
                    ${item.displayVisibility}
                </div>

                <!-- Memo -->
                <div style="flex:1; min-width:0; padding-right:16px; font-size:13px; color:#000000; overflow:hidden; display:-webkit-box; -webkit-line-clamp:1; line-clamp:1; -webkit-box-orient:vertical;">
                    ${memoDisplay}
                </div>

                <!-- Person (Sender/Receiver) -->
                <div style="width:180px; flex-shrink:0; display:flex; align-items:center; gap:8px; padding-right:16px; min-width:0;">
                    <img src="${personAvatar}" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;object-fit:cover;" alt="">
                    <div style="min-width:0; flex:1;">
                        <div style="font-size:13px;font-weight:600;color:#000000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(person.name)}</div>
                        <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(person.affiliation)}">${escapeHtml(person.affiliation)}</div>
                    </div>
                </div>

                <!-- Date -->
                <div style="width:110px; flex-shrink:0; font-size:12px; color:#94a3b8; text-align:left; display:flex; align-items:center;">${formatDateTime(item.created_at)}</div>

                <!-- Confirmation status -->
                <div style="width:120px; flex-shrink:0; font-size:12px; text-align:left; display:flex; align-items:center;">
                    ${confirmDisplay}
                </div>

                <!-- Actions (Delete) -->
                <div style="width:40px; flex-shrink:0; display:flex; align-items:center; justify-content:flex-start;">
                    <button class="delete-share-btn" data-id="${escapeHtml(item.id)}" style="background:none; border:none; color:#cbd5e1; cursor:pointer; padding:4px; display:flex; align-items:center; justify-content:center; transition:color 0.2s;">
                        <span class="material-symbols-outlined" style="font-size:18px;">close</span>
                    </button>
                </div>
            </div>
        `);

        row.find('.delete-share-btn').on('click', function(e) {
            e.stopPropagation();
            const shareId = $(this).data('id');
            handleDeleteShare(shareId);
        });

        row.on('click', function () {
            handleItemClick(item);
        });

        $list.append(row);
    });
}

/**
 * Click handler for list items - Shows Summary Modal
 */
async function handleItemClick(item) {
    showItemSummaryModal(item);
}

/**
 * Show Item Summary Modal
 */
function showItemSummaryModal(item) {
    const $modal = $('#item-summary-modal');
    const isReceived = (currentDirFilter === 'received');
    const personId = isReceived ? item.sender_id : item.receiver_id;
    const person = userMap[personId] || { name: 'Unknown', affiliation: 'DealChat' };

    // Populate data
    $('#summary-item-name').text(item.itemName);
    $('#summary-visibility').text(item.displayVisibility);
    $('#summary-type').text(getTypeConfig(item.item_type).label);
    $('#summary-memo').text(item.memo || '메모 없음');

    // --- Fetch and Render Attached Files (Added) ---
    const $filesArea = $('#summary-files-area');
    const $filesList = $('#summary-files-list');
    
    if (item.file_ids && Array.isArray(item.file_ids) && item.file_ids.length > 0) {
        $filesArea.css('display', 'flex');
        $filesList.html('<div class="text-muted" style="font-size:12px;">파일 정보를 불러오는 중...</div>');

        _supabase.from('files')
            .select('id, file_name, file_path')
            .in('id', item.file_ids)
            .then(({ data: files, error }) => {
                if (error) throw error;
                $filesList.empty();
                if (files && files.length > 0) {
                    files.forEach(file => {
                        const fileHtml = `
                            <a href="${file.file_path}" target="_blank" download="${file.file_name}" 
                               style="display:flex; align-items:center; gap:8px; text-decoration:none; padding:8px; border-radius:8px; background:#fff; border:1px solid #fed7aa; transition:all 0.2s; color:#c2410c;">
                                <span class="material-symbols-outlined" style="font-size:18px;">download</span>
                                <span style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px;">${escapeHtml(file.file_name)}</span>
                            </a>
                        `;
                        $filesList.append(fileHtml);
                    });
                } else {
                    $filesList.html('<div class="text-muted" style="font-size:12px;">첨부된 파일 정보를 찾을 수 없습니다.</div>');
                }
            })
            .catch(err => {
                console.error('Fetch shared files error:', err);
                $filesList.html('<div class="text-danger" style="font-size:12px;">파일 목록 로드 실패</div>');
            });
    } else {
        $filesArea.hide();
        $filesList.empty();
    }
    $('#summary-sender').text(`${person.name} (${person.affiliation})`);
    $('#summary-date').text(formatDateTime(item.created_at));

    // Button Events
    $('#btn-close-summary').off('click').on('click', () => $modal.hide());
    $('#btn-go-detail').off('click').on('click', async () => {
        $modal.hide();

        const isReceived = (currentDirFilter === 'received');
        const isSigned = signedNdaSet.has(String(item.item_id));
        const needsNda = (item.item_type === 'seller' || item.item_type === 'buyer') && !isSigned && isReceived;

        if (needsNda) {
            showNdaGateInSharedItems(item);
        } else {
            await proceedToDetail(item);
        }
    });

    $modal.css('display', 'flex');
}

/**
 * Show NDA Gate Modal inside shared_items.html
 */
function showNdaGateInSharedItems(item) {
    const ndaModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('nda-modal'), {
        backdrop: 'static',
        keyboard: false
    });

    const localUser = JSON.parse(localStorage.getItem('dealchat_users')) || {};
    const currentUserName = localUser.name || localUser.email?.split('@')[0] || '사용자';
    $('#logged-in-user-name').text(currentUserName);
    
    // 모달 초기화
    $('#nda-signature-name').val('');
    $('#nda-confirmation-text').val('');
    const $confirmBtn = $('#btn-confirm-nda');
    $confirmBtn.prop('disabled', true).css('opacity', '0.5');

    const validateNda = () => {
        const signature = $('#nda-signature-name').val().trim();
        const confirmTxt = $('#nda-confirmation-text').val().trim();
        const REQUIRED_TXT = "본 사항을 위반하지 않을 것을 약속합니다";
        
        if (signature === currentUserName && confirmTxt === REQUIRED_TXT) {
            $confirmBtn.prop('disabled', false).css('opacity', '1');
        } else {
            $confirmBtn.prop('disabled', true).css('opacity', '0.5');
        }
    };

    $('#nda-signature-name, #nda-confirmation-text').off('input').on('input', validateNda);

    $confirmBtn.off('click').on('click', async () => {
        const signature = $('#nda-signature-name').val().trim();
        
        try {
            showLoader();
            
            // 공통 컬럼 item_id 추가 (nda_logs 테이블 구조에 따라 다르게 넣음)
            // _supabase.from('nda_logs')
            const logEntry = {
                user_id: currentuser_id,
                item_id: item.item_id,
                item_type: item.item_type,
                signature: signature
            };
            if (item.item_type === 'seller') logEntry.seller_id = item.item_id;
            else if (item.item_type === 'buyer') logEntry.buyer_id = item.item_id;
            else if (item.item_type === 'company') logEntry.company_id = item.item_id;

            const { error } = await _supabase.from('nda_logs').insert(logEntry);
            
            if (error) throw error;
            
            // 로컬 서명 상태 업데이트
            saveSignedNdaLocal(item.item_id);
            signedNdaSet.add(String(item.item_id));
            
            ndaModal.hide();
            
            // NDA 로깅 완료 후 즉시 상세 보기(읽기 모드) 진입
            await proceedToDetail(item);
            
        } catch (e) {
            console.error('Failed to save NDA log', e);
            alert('NDA 체결 중 오류가 발생했습니다: ' + e.message);
        } finally {
            hideLoader();
        }
    });

    // 닫기 시 모달 닫기
    $('#nda-modal .btn-close, #nda-modal [data-bs-dismiss="modal"]').off('click').on('click', () => {
        ndaModal.hide();
    });

    ndaModal.show();
}

/**
 * Mark as read and Navigate
 */
async function proceedToDetail(item) {
    const isReceived = (currentDirFilter === 'received');
    
    // 1. Mark as read in DB if unread AND it's a received item
    if (isReceived && !item.is_read) {
        try {
            await _supabase.from('shares').update({ is_read: true }).eq('id', item.id);
        } catch (err) {
            console.error('Failed to update read status:', err);
        }
    }

    // 2. Navigate (Pass mode=read for shared view)
    const cfg = getTypeConfig(item.item_type);
    window.location.href = `./${cfg.detailPage}?id=${encodeURIComponent(item.item_id)}&from=shared&mode=read`;
}

/**
 * Local storage NDA helper
 */
function saveSignedNdaLocal(itemId) {
    const key = `dealchat_signed_ndas_${currentuser_id}`;
    try {
        const stored = localStorage.getItem(key);
        let signed = stored ? JSON.parse(stored) : [];
        if (!signed.includes(String(itemId))) {
            signed.push(String(itemId));
            localStorage.setItem(key, JSON.stringify(signed));
        }
    } catch (e) { console.warn('Local NDA save failed:', e); }
}

function showEmpty() {
    $('#shared-items-list').empty();
    $('#pagination-container').empty();
    $('#empty-state').css('display', 'flex');
}

// ==========================================
// Pagination
// ==========================================

function renderPagination() {
    const $c = $('#pagination-container');
    $c.empty();

    const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
    if (totalPages <= 1) return;

    const prev = currentPage === 1 ? 'disabled' : '';
    $c.append(`<button class="pg-btn" ${prev} onclick="changePage(1)"><span class="material-symbols-outlined">keyboard_double_arrow_left</span></button>`);
    $c.append(`<button class="pg-btn" ${prev} onclick="changePage(${currentPage - 1})"><span class="material-symbols-outlined">chevron_left</span></button>`);

    let s = Math.max(1, currentPage - 2);
    let e = Math.min(totalPages, s + 4);
    if (e - s < 4) s = Math.max(1, e - 4);

    for (let i = s; i <= e; i++) {
        $c.append(`<button class="pg-btn${i === currentPage ? ' active' : ''}" onclick="changePage(${i})">${i}</button>`);
    }

    const next = currentPage === totalPages ? 'disabled' : '';
    $c.append(`<button class="pg-btn" ${next} onclick="changePage(${currentPage + 1})"><span class="material-symbols-outlined">chevron_right</span></button>`);
    $c.append(`<button class="pg-btn" ${next} onclick="changePage(${totalPages})"><span class="material-symbols-outlined">keyboard_double_arrow_right</span></button>`);
}

window.changePage = function (page) {
    const total = Math.ceil(filteredItems.length / itemsPerPage);
    if (page < 1 || page > total) return;
    currentPage = page;
    renderList();
    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function handleDeleteShare(shareId) {
    if (!confirm('이 공유 내역을 목록에서 삭제하시겠습니까?\n(데이터베이스에는 보존되지만 목록에서만 사라집니다.)')) return;

    try {
        // Determine which flag to update based on current tab
        const updateField = (currentDirFilter === 'received') ? 'receiver_deleted' : 'sender_deleted';
        
        const { error, status } = await _supabase
            .from('shares')
            .update({ [updateField]: true })
            .eq('id', shareId);
        
        console.log('Soft delete attempt:', { shareId, updateField, status, error });

        if (error) throw error;

        // Update local arrays for immediate UI feedback
        if (currentDirFilter === 'received') {
            allSharedItemsReceived = allSharedItemsReceived.filter(s => s.id !== shareId);
        } else {
            allSharedItemsSent = allSharedItemsSent.filter(s => s.id !== shareId);
        }
        
        applyFilters();
    } catch (err) {
        console.error('삭제 오류:', err);
        alert('삭제 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
    }
}
