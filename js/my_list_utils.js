import { escapeHtml } from './utils.js';
import { APIcall } from './APIcallFunction.js';

/**
 * 산업군에 따른 Material Icon 이름을 반환합니다.
 */
export function getIndustryIcon(industry) {
    const iconMap = {
        'AI': 'smart_toy',
        'IT·정보통신': 'computer',
        'SaaS·솔루션': 'cloud',
        '게임': 'sports_esports',
        '공공·국방': 'policy',
        '관광·레저': 'beach_access',
        '교육·에듀테크': 'school',
        '금융·핀테크': 'payments',
        '농축산·어업': 'agriculture',
        '농축수산·어업': 'agriculture',
        '농·임·어업': 'agriculture',
        '라이프스타일': 'person',
        '모빌리티': 'directions_car',
        '문화예술·콘텐츠': 'movie',
        '바이오·헬스케어': 'medical_services',
        '부동산': 'real_estate_agent',
        '뷰티·패션': 'content_cut',
        '에너지·환경': 'eco',
        '외식·중소상공인': 'restaurant',
        '외식업·소상공인': 'restaurant',
        '외식·음료·소상공인': 'restaurant',
        '우주·항공': 'rocket',
        '유통·물류': 'local_shipping',
        '제조·건설': 'factory',
        '플랫폼·커뮤니티': 'groups',
        '기타': 'corporate_fare'
    };
    return iconMap[industry] || 'corporate_fare';
}

/**
 * 산업군 명칭을 블라인드용 한글 가명으로 변환합니다.
 */
export function getIndustryBlindName(industry) {
    const mapping = {
        'AI': 'AI',
        'IT·정보통신': 'IT',
        'SaaS·솔루션': 'SaaS',
        '게임': '게임',
        '공공·국방': '공공',
        '관광·레저': '관광',
        '교육·에듀테크': '교육',
        '금융·핀테크': '금융',
        '농축산·어업': '농수산',
        '농축수산·어업': '농수산',
        '농·임·어업': '농수산',
        '라이프스타일': '생활',
        '모빌리티': '모빌리티',
        '문화예술·콘텐츠': '콘텐츠',
        '바이오·헬스케어': '바이오',
        '부동산': '부동산',
        '뷰티·패션': '뷰티패션',
        '에너지·환경': '에너지',
        '외식·중소상공인': '외식',
        '외식업·소상공인': '외식',
        '외식·음료·소상공인': '외식',
        '우주·항공': '우주항공',
        '유통·물류': '유통물류',
        '제조·건설': '제조건설',
        '플랫폼·커뮤니티': '플랫폼',
        '기타': '기타'
    };

    if (!industry) return '기타';
    if (industry.startsWith('기타: ')) {
        return industry.replace('기타: ', '');
    }
    return mapping[industry] || industry;
}

/**
 * 아이템 리스트를 받아 산업군별 등록 순서에 따라 'A-001' 형태의 가명을 부여합니다.
 */
export function assignBlindLabels(items) {
    if (!items || !Array.isArray(items) || items.length === 0) return;

    // 등록일시 순으로 정렬 (오름차순)하여 순번의 일관성 유지
    const sorted = [...items].sort((a, b) => {
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return dateA - dateB;
    });

    const counts = {}; // 각 산업군별 현재 순번 카운트

    sorted.forEach(item => {
        const ind = item.industry || '기타';
        if (!counts[ind]) counts[ind] = 0;
        counts[ind]++;

        const count = counts[ind];
        
        // 999개마다 알파벳 변경 (A, B, C...)
        const alphabetIdx = Math.floor((count - 1) / 999);
        const number = ((count - 1) % 999) + 1;

        let alphabet = "";
        let n = alphabetIdx;
        do {
            alphabet = String.fromCharCode(65 + (n % 26)) + alphabet;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);

        // 결과 저장 (A-001 형식)
        const label = `${alphabet}-${String(number).padStart(3, '0')}`;
        const blindName = `${getIndustryBlindName(ind)} ${label}`;

        // 원본 객체에 속성 추가
        item.blind_label = label;
        item.blind_name_structured = blindName;
    });
}

/**
 * Supabase에서 사용자 데이터를 가져와 userMap 객체를 생성 및 반환합니다.
 */
export async function initUserMap(supabase) {
    const { data: users, error } = await supabase.from('users').select('*');
    if (error) throw error;

    const userMap = {};
    (users || []).forEach(u => {
        userMap[u.id] = {
            name: u.name || "정보 없음",
            affiliation: u.company || 'DealChat',
            email: u.email || '',
            avatar: u.avatar_url || u.avatar || null,
            role: u.role || 'reviewer'
        };
    });
    return userMap;
}

/**
 * 선택된 수신자 목록에 사용자를 추가합니다.
 */
export function addSelectedUser(selectedReceivers, id, name, renderCallback) {
    if (selectedReceivers.includes(id)) return selectedReceivers;
    selectedReceivers.push(id);
    if (typeof renderCallback === 'function') renderCallback();
    return selectedReceivers;
}

/**
 * 선택된 수신자 태그를 렌더링합니다.
 */
export function renderSelectedTags({
    containerSelector,
    selectedReceivers,
    userMap,
    theme = { bgColor: '#eef2ff', textColor: '#1A73E8', borderColor: '#e0e7ff' },
    onRemove
}) {
    const $container = $(containerSelector);
    if (selectedReceivers.length === 0) {
        $container.html('<span class="text-muted p-1" style="font-size: 13px;">이름으로 대상을 검색하세요.</span>');
        return;
    }
    $container.empty();
    selectedReceivers.forEach(uid => {
        const u = userMap[uid] || { name: 'Unknown' };
        const tag = $(`<span class="badge d-flex align-items-center gap-1 p-2" style="background: ${theme.bgColor}; color: ${theme.textColor}; border: 1px solid ${theme.borderColor || theme.textColor}; border-radius: 8px;">
            ${escapeHtml(u.name)} <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">close</span>
        </span>`);
        tag.find('span').on('click', () => {
            if (typeof onRemove === 'function') onRemove(uid);
        });
        $container.append(tag);
    });
}

/**
 * 사용자 검색 입력을 처리합니다. (초기화용)
 */
export function initShareUserSearch({
    inputSelector,
    resultsSelector,
    userMap, // Deprecated: Use getUserMap instead
    getUserMap,
    getSelectedReceivers,
    onSelect
}) {
    $(inputSelector).on('input', function() {
        const keyword = $(this).val().toLowerCase().trim();
        const $results = $(resultsSelector);
        if (!keyword) { $results.hide(); return; }

        const selectedReceivers = getSelectedReceivers ? getSelectedReceivers() : [];
        const currentMap = typeof getUserMap === 'function' ? getUserMap() : userMap;

        const matches = Object.entries(currentMap)
            .filter(([id, u]) => {
                if (selectedReceivers && selectedReceivers.includes(id)) return false;
                // [RBAC Filter] Only show Viewers (Reviewers) and Admins. Hide Buyers.
                if (u.role === 'buyer') return false;
                return u.name.toLowerCase().includes(keyword) || (u.affiliation && u.affiliation.toLowerCase().includes(keyword));
            })
            .slice(0, 10);

        if (matches.length === 0) {
            $results.html('<div class="p-3 text-muted text-center" style="font-size: 13px;">일치하는 검색 결과가 없습니다.</div>').show();
            return;
        }

        $results.empty().show();
        matches.forEach(([id, u]) => {
            $results.append(`<div class="p-3 border-bottom user-search-item" style="cursor: pointer; transition: background 0.2s;" data-id="${id}" data-name="${u.name}">
                <div class="fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(u.name)}</div>
                <div style="font-size: 11px; color: #64748b;">${escapeHtml(u.affiliation)}</div>
            </div>`);
        });
    });

    $(document).off('click', '.user-search-item').on('click', '.user-search-item', function() {
        const id = $(this).data('id');
        const name = $(this).data('name');
        if (typeof onSelect === 'function') onSelect(id, name);
        $(inputSelector).val('');
        $(resultsSelector).hide();
    });

    // 외부 클릭 시 결과창 닫기
    $(document).on('click.userSearchOutside', function(e) {
        if (!$(e.target).closest(inputSelector).length && !$(e.target).closest(resultsSelector).length) {
            $(resultsSelector).hide();
        }
    });
}

/**
 * 공유 요청을 제출합니다. (핸들러용)
 */
export async function submitShareHandler({
    itemId,
    itemType,
    senderId,
    selectedReceivers,
    memoSelector = '#share-memo',
    fileCheckboxSelector = '.share-file-checkbox',
    btnElement,
    supabaseEndpoint,
    onSuccess
}) {
    if (selectedReceivers.length === 0) { alert('공유할 대상을 한 명 이상 선택해 주세요.'); return; }
    
    const memo = $(memoSelector).val().trim();
    const $btn = $(btnElement);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('전송 중...');

    const selectedFileIds = $(`${fileCheckboxSelector}:checked`).map(function() {
        return $(this).val();
    }).get();

    try {
        const sharePromises = selectedReceivers.map(uid => {
            return APIcall({
                table: 'shares',
                action: 'create',
                item_type: itemType,
                item_id: itemId,
                sender_id: senderId,
                receiver_id: uid,
                memo: memo,
                file_ids: selectedFileIds,
                is_read: false
            }, supabaseEndpoint, { 'Content-Type': 'application/json' }).then(res => res.json());
        });

        const results = await Promise.all(sharePromises);
        const errs = results.filter(r => r.error);
        if (errs.length > 0) {
            alert(`${errs.length}건의 공유 중 오류 발생.`);
        } else {
            if (typeof onSuccess === 'function') onSuccess();
            else alert('공유되었습니다.');
        }
    } catch (e) {
        console.error('Share Error', e);
        alert('공유 요청 실패: ' + (e.message || '알 수 없는 오류'));
    } finally {
        $btn.prop('disabled', false).text(originalText);
    }
}

/**
 * 파일 목록을 가져와서 렌더링합니다.
 */
export async function fetchFiles({
    supabase,
    entityType,
    entityId,
    companyId, // Sellers용 (company_id)
    containerSelector = '#share-file-selection-list'
}) {
    const $fileList = $(containerSelector);
    $fileList.html('<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>');

    try {
        let query = supabase.from('files').select('*');
        
        if (entityType === 'seller' && companyId && entityId) {
             query = query.or(`and(entity_type.eq.company,entity_id.eq.${companyId}),and(entity_type.eq.seller,entity_id.eq.${entityId})`);
        } else if (entityType === 'buyer' && companyId && entityId) {
             // 바이어의 경우 1단계: entity_id로 시도 (보통 company_id가 들어옴)
             query = query.eq('entity_id', entityId);
        } else {
             query = query.eq('entity_id', entityId);
             if (entityType) query = query.eq('entity_type', entityType);
        }

        const { data, error } = await query;
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

/**
 * 테이블 본문(tbody) 내에 표시될 표준화된 로더 HTML을 반환합니다.
 */
export function renderListLoader(colspan = 8, themeColor = '#1A73E8') {
    return `<tr>
        <td colspan="${colspan}" class="text-center py-5">
            <div class="spinner-border" role="status" style="color: ${themeColor} !important; width: 1.5rem; height: 1.5rem; border-width: 0.2em;">
                <span class="visually-hidden">Loading...</span>
            </div>
            <div class="mt-3 text-muted" style="font-size: 13px; font-weight: 500;">데이터를 불러오는 중...</div>
        </td>
    </tr>`;
}
