import { checkAuth, hideLoader, showLoader, resolveAvatarUrl } from './auth_utils.js';

const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

let currentUser = null;
let projectData = null;
let userMap = {};
let autoSaveTimers = {};

$(document).ready(async function () {
    currentUser = checkAuth();
    if (!currentUser) return;

    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');

    if (!projectId) {
        alert('잘못된 접근입니다.');
        location.href = 'total_projects.html';
        return;
    }

    showLoader();
    await loadProjectDashboard(projectId);
    hideLoader();

    // 일지 피드는 주기적으로 갱신
    setInterval(() => loadWorkLogs(projectId, false), 30000);
});

async function loadProjectDashboard(projectId) {
    try {
        // 1. 유저 맵 구성 (전체 유저 정보 로드)
        const { data: users } = await _supabase.from('users').select('id, name, company, avatar_url');
        users.forEach(u => userMap[u.id] = u);

        // 2. 프로젝트 기본 정보 조회
        const { data: project, error: pErr } = await _supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .is('deleted_at', null)
            .single();

        if (pErr || !project) {
            console.error('프로젝트 조회 오류:', pErr);
            throw new Error('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
        }

        // 3. 별도 쿼리로 멤버 정보 조회 (RLS 재귀 및 조인 이슈 방지)
        const { data: members, error: mErr } = await _supabase
            .from('project_members')
            .select('*')
            .eq('project_id', projectId);

        if (mErr) {
            console.warn('멤버 목록 조회 제한적 성공 (본인 정보만 보일 수 있음):', mErr);
        }

        const projectMembers = members || [];
        const myMemberInfo = projectMembers.find(m => String(m.user_id) === String(currentUser.id));

        if (!myMemberInfo) {
            alert('이 프로젝트의 참여 멤버가 아닙니다.');
            location.href = 'total_projects.html';
            return;
        }

        // 데이터 통합
        projectData = {
            ...project,
            project_members: projectMembers,
            myRole: myMemberInfo.role,
            entityType: project.entity_type
        };

        await renderAll();
        setupEventListeners(projectId);

    } catch (err) {
        console.error('대시보드 로드 오류:', err);
        alert(err.message);
        location.href = 'total_projects.html';
    }
}

async function renderAll() {
    renderProjectInfo();
    await renderLinkedStatus(); 
    renderAutoSaveFields();
    await renderIntegratedEntities(); // NEW: 연동 업체 및 티저 렌더링
    await loadWorkLogs(projectData.id);
    renderMemberList();
}

/**
 * 프로젝트 기본 정보 렌더링
 */
function renderProjectInfo() {
    $('#project-main-name').text(projectData.name);
    
    const type = projectData.entity_type;
    let typeLabel = type;
    if (type === 'SELLER') typeLabel = '매도 프로젝트';
    else if (type === 'BUYER') typeLabel = '매수 프로젝트';
    
    $('#badge-entity-type').text(typeLabel);

    // [NEW] 프로젝트 타입에 따른 정보 섹션 제어
    if (type === 'SELLER') {
        $('#info-seller-wrap').show();
        $('#info-buyer-wrap').hide();
    } else if (type === 'BUYER') {
        $('#info-seller-wrap').hide();
        $('#info-buyer-wrap').show();
    } else {
        // MATCHED 또는 기타인 경우 둘 다 보임
        $('#info-seller-wrap').show();
        $('#info-buyer-wrap').show();
    }

    if (projectData.started_at) {
        const d = new Date(projectData.started_at);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const date = `${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`;
        $('#start-date-val').text(date);
        $('#project-start-date').show();
    }
}

let entityModalInstance = null;
let selectedEntityIds = new Set();
let currentModalEntityType = null;

function openEntitySelectModal(type) {
    currentModalEntityType = type || projectData.entityType;
    const title = currentModalEntityType === 'SELLER' ? '매도 티저 추가' : '매수 티저 추가';
    
    $('#entitySelectTitle').text(title);
    $('#entity-list-search').val('');
    $('#entity-list-container').html('<div class="text-center py-5 text-muted small">검색어를 입력하여 추가할 티저를 찾으세요.</div>');
    
    selectedEntityIds.clear();
    updateModalSelectionUI();

    const modalEl = document.getElementById('entitySelectModal');
    if (!entityModalInstance) {
        entityModalInstance = new bootstrap.Modal(modalEl);
    }
    entityModalInstance.show();

    $('#entity-list-search').off('input').on('input', function() {
        const keyword = $(this).val().trim();
        if (keyword.length < 1) return;
        searchEntities(keyword, currentModalEntityType);
    });
}

function updateModalSelectionUI() {
    // Single select mode - UI footer not needed
}

async function searchEntities(keyword, type) {
    const $container = $('#entity-list-container');
    $container.html('<div class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm"></div></div>');

    try {
        const table = type === 'SELLER' ? 'sellers' : 'buyers';
        const searchQuery = keyword.toLowerCase();

        // 현재 프로젝트에 이미 추가된 티저들의 원본 ID 확인 (중복 방지)
        const { data: existingTeasers } = await _supabase
            .from('project_teasers')
            .select('source_entity_id')
            .eq('project_id', projectData.id);
        
        const existingIds = (existingTeasers || []).map(t => String(t.source_entity_id)).filter(id => id !== 'null');

        // 검색 (심플 쿼리)
        const { data, error } = await _supabase
            .from(table)
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const filteredData = (data || []).filter(item => {
            const name = (item.name || item.company_name || '').toLowerCase();
            const industry = (item.industry || item.interest_industry || '').toLowerCase();
            return (name.includes(searchQuery) || industry.includes(searchQuery)) && !existingIds.includes(String(item.id));
        });

        if (filteredData.length === 0) {
            $container.html('<div class="text-center py-5 text-muted small">검색 결과가 없거나 이미 추가된 업체입니다.</div>');
            return;
        }

        $container.empty();
        filteredData.forEach(item => {
            const entityName = item.name || item.company_name || '이름 없음';
            const industry = item.industry || item.interest_industry || '기타';

            const $itemHtml = $(`
                <div class="entity-list-item d-flex align-items-center gap-3 cursor-pointer">
                    <div class="flex-grow-1">
                        <div class="fw-bold" style="font-size: 14px; color: #1e293b;">${escapeHtml(entityName)}</div>
                        <div class="text-muted" style="font-size: 11px;">${escapeHtml(industry)}</div>
                    </div>
                    <span class="material-symbols-outlined text-primary" style="font-size: 20px;">add_circle</span>
                </div>
            `);

            $itemHtml.on('click', () => {
                linkEntity(item.id, entityName, currentModalEntityType);
                entityModalInstance.hide();
            });

            $container.append($itemHtml);
        });

    } catch (err) {
        console.error('검색 오류:', err);
        $container.html('<div class="text-center py-5 text-danger small">오류가 발생했습니다.</div>');
    }
}

async function linkEntity(id, name, type) {
    if (!confirm(`'${name}' 업체를 프로젝트에 연동하시겠습니까?`)) return;

    showLoader();
    try {
        const field = type === 'SELLER' ? 'seller_id' : 'buyer_id';
        
        // 1. 프로젝트 테이블 업데이트
        const { error: pErr } = await _supabase
            .from('projects')
            .update({ [field]: id, updated_at: new Date().toISOString() })
            .eq('id', projectData.id);
        if (pErr) throw pErr;

        // 2. 업체 상태 변경
        const table = type === 'SELLER' ? 'sellers' : 'buyers';
        await _supabase.from(table).update({ status: '진행중' }).eq('id', id);

        // 3. 시스템 로그 등록 (Timeline)
        await _supabase.from('work_logs').insert([{
            project_id: projectData.id,
            user_id: currentUser.id,
            content: `[시스템] '${name}' 업체가 프로젝트에 연동되었습니다.`
        }]);

        alert('업체가 연동되었습니다.');
        window.location.reload();
    } catch (err) {
        alert('연동 실패: ' + err.message);
    } finally {
        hideLoader();
    }
}

window.unlinkEntity = async function(type) {
    if (projectData.myRole !== 'MASTER') {
        alert('연동 해제 권한이 없습니다.');
        return;
    }
    
    if (!confirm('업체 연동을 해제하시겠습니까?')) return;

    showLoader();
    try {
        const field = type === 'SELLER' ? 'seller_id' : 'buyer_id';
        const linkedId = type === 'SELLER' ? projectData.seller_id : projectData.buyer_id;

        console.log(`Unlinking ${type}: field=${field}, id=${linkedId}, projectId=${projectData.id}`);

        // 1. 프로젝트 테이블 해제
        const { data: pData, error: pErr } = await _supabase
            .from('projects')
            .update({ 
                [field]: null, 
                status: '대기',
                updated_at: new Date().toISOString() 
            })
            .eq('id', projectData.id)
            .select();
        
        console.log('Project update results:', pData, pErr);

        if (pErr) throw pErr;
        
        // 권한이나 RLS로 인해 업데이트가 반영되지 않은 경우
        if (!pData || pData.length === 0) {
            throw new Error('프로젝트 수정을 위한 권한이 없거나 해당 프로젝트를 찾을 수 없습니다.');
        }

        // 2. 기존 업체 상태 복구 (성공 여부에 상관없이 진행하나 에러 로그는 남김)
        if (linkedId) {
            const table = type === 'SELLER' ? 'sellers' : 'buyers';
            await _supabase.from(table).update({ status: '대기' }).eq('id', linkedId);
        }

        // 3. 시스템 로그 등록
        await _supabase.from('work_logs').insert([{
            project_id: projectData.id,
            user_id: currentUser.id,
            content: `[시스템] 연동되었던 업체가 해제되었습니다.`
        }]);

        alert('연동이 해제되었습니다.');
        window.location.reload();
    } catch (err) {
        alert('해제 실패: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function renderIntegratedEntities() {
    const isMaster = projectData.myRole === 'MASTER';
    
    // 매도 측 처리
    await renderEntityCard('SELLER', projectData.seller_id, isMaster);
    // 매수 측 처리
    await renderEntityCard('BUYER', projectData.buyer_id, isMaster);

    // 티저 텍스트 주입
    $('#teaser-seller-input').val(projectData.teaser_seller || '');
    $('#teaser-buyer-input').val(projectData.teaser_buyer || '');

    if (!isMaster) {
        $('.pd-autosave-textarea').prop('readonly', true);
    }
}

async function renderEntityCard(type, entityId, isMaster) {
    try {
        const prefix = type.toLowerCase();
    const $container = $(`#${prefix}-integrated-card`);
    const $headerAction = $(`#${prefix}-header-actions`);
    const $logContainer = $(`#${prefix}-activity-log`);

    // 1. 업체 정보 로드 (없더라도 로그는 보여줘야 함)
    let entity = null;
    if (entityId) {
        const table = type === 'SELLER' ? 'sellers' : 'buyers';
        const { data: e } = await _supabase.from(table).select('*').eq('id', entityId).single();
        entity = e;
    }

    // 2. 관련 시스템 로그 로드 (연동 해제되었어도 이 프로젝트의 시스템 로그는 표시)
    const { data: logs } = await _supabase
        .from('work_logs')
        .select('*')
        .eq('project_id', projectData.id)
        .ilike('content', '%[시스템]%')
        .order('created_at', { ascending: false })
        .limit(4);

    let logHtml = `<div class="p-4 text-center text-muted small border rounded-3 bg-light opacity-50">시스템 활동 기록이 없습니다.</div>`;
    if (logs && logs.length > 0) {
        logHtml = `
            <div class="bg-light p-3 rounded-3 border" style="border-style: dashed !important;">
                <div class="small text-muted mb-3 fw-bold" style="font-size: 10px; text-transform: uppercase;">최근 활동 기록</div>
                <div class="activity-timeline">
                    ${logs.map(l => {
                        const d = new Date(l.created_at);
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const hh = String(d.getHours()).padStart(2, '0');
                        const min = String(d.getMinutes()).padStart(2, '0');
                        const time = `${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`;
                        return `
                        <div class="d-flex align-items-start mb-2 last-child-mb-0">
                            <span class="material-symbols-outlined text-primary me-2" style="font-size: 16px; margin-top: 2px;">history</span>
                            <div class="flex-grow-1 d-flex justify-content-between align-items-start">
                                <span style="font-size: 13px; color: #475569; font-weight: 500; line-height: 1.4;">${escapeHtml(l.content.replace('[시스템] ', ''))}</span>
                                <span class="text-muted text-nowrap ms-2" style="font-size: 11px; margin-top: 2px;">${time}</span>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    }
    $logContainer.html(logHtml);

    // 3. 업체 카드 또는 연동 대기 상태 렌더링
    if (!entity || !entityId) {
        $container.html(`
            <div class="d-flex align-items-center justify-content-center p-4 bg-light rounded-3 border border-dashed text-muted small" style="min-height: 120px;">
                연동된 ${type === 'SELLER' ? '매도' : '매수'} 업체가 없습니다. 상단 '업체 연동' 버튼을 이용하세요.
            </div>
        `);
        $headerAction.show();
        return;
    }

    const name = entity.name || entity.company_name || '이름 없음';
    const industry = entity.industry || '미지정';
    const summary = entity.summary || entity.interest_summary || '회사 소개 정보가 없습니다.';
    const status = entity.status || '대기';
    
    const author = userMap[entity.user_id] || { name: '알 수 없음', company: '정보 없음' };
    const authorAvatar = resolveAvatarUrl(author.avatar_url, 1);

    $headerAction.hide();
    $container.html(`
        <div class="p-4 bg-white border rounded-3 shadow-sm">
            <!-- 헤더: 아이콘 및 기본 정보 -->
            <div class="d-flex align-items-start justify-content-between mb-4">
                <div class="d-flex align-items-center gap-3">
                    <div style="width: 48px; height: 48px; background: #8b5cf6; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);">
                        <span class="material-symbols-outlined" style="color: #ffffff; font-size: 26px;">${getIndustryIcon(industry)}</span>
                    </div>
                    <div>
                        <div class="fw-bold text-dark" style="font-size: 19px; letter-spacing: -0.02em;">${escapeHtml(name)}</div>
                        <div class="mt-1 fw-bold" style="font-size: 12px; color: #64748b;">${escapeHtml(industry)}</div>
                    </div>
                </div>
                ${isMaster ? `
                <button class="btn btn-sm btn-link text-danger text-decoration-none p-0 fw-bold" onclick="unlinkEntity('${type}')" style="font-size: 11px; opacity: 0.8;">연동 해제</button>
                ` : ''}
            </div>

            <!-- 회사 소개 -->
            <div class="mb-4">
                <div class="small text-muted mb-2" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">회사 소개</div>
                </div>
            </div>

            <!-- 작성자 정보 -->
            <div class="mb-4 d-flex align-items-center justify-content-between p-3 rounded-3" style="background: #f8fafc; border: 1px solid #f1f5f9;">
                <div class="d-flex align-items-center gap-3">
                    <img src="${authorAvatar}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                    <div>
                        <div class="small text-muted" style="font-size: 10px; font-weight: 700; text-transform: uppercase;">티저 작성자</div>
                        <div class="fw-bold text-dark" style="font-size: 14px;">${escapeHtml(author.name)}</div>
                    </div>
                </div>
                <div class="text-end">
                    <div class="text-muted" style="font-size: 12px;">${escapeHtml(author.company || '정보 없음')}</div>
                </div>
            </div>

            <!-- 상태 관리 -->
                <div>
                    <div class="small text-muted mb-3" style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">기업 진행 현황</div>
                    <div class="d-flex gap-2 flex-wrap">
                        ${[
                            { key: 'PENDING', label: '대기' },
                            { key: 'ACTIVE', label: '진행중' },
                            { key: 'COMPLETED', label: '완료' }
                        ].map(s => {
                            const isActive = status === s.key || status === s.label;
                            const sellerColor = '#8b5cf6';
                            const buyerColor = '#0d9488';
                            const activeColor = type === 'SELLER' ? sellerColor : buyerColor;
                            
                            return `<button class="btn ${isActive ? '' : 'btn-outline-secondary'} flex-grow-1 rounded-pill" 
                                style="font-size: 12px; font-weight: 700; height: 34px; padding: 0 12px; min-width: 60px;
                                ${isActive ? `background-color: ${activeColor}; border-color: ${activeColor}; color: #fff;` : ''}" 
                                ${isMaster ? `onclick="updateEntityStatus('${type}', '${entityId}', '${s.key}', '${name}')"` : 'disabled'}>
                                ${s.label}
                            </button>`;
                        }).join('')}
                    </div>
                </div>
        </div>
    `);
    } catch (err) {
        console.error('업체 정보 로드 실패:', err);
    }
}

window.updateEntityStatus = async function(type, entityId, newStatus, entityName) {
    if (projectData.myRole !== 'MASTER') {
        alert('기업 진행 현황을 변경하려면 프로젝트 마스터 권한이 필요합니다.');
        return;
    }

    showLoader();
    try {
        const table = type === 'SELLER' ? 'sellers' : 'buyers';
        
        await _supabase.from(table).update({ status: newStatus }).eq('id', entityId);

        await _supabase.from('work_logs').insert([{
            project_id: projectData.id,
            user_id: currentUser.id,
            content: `[시스템] ${entityName} 상태 변경: ${newStatus}`
        }]);

        alert('상태가 변경되었습니다.');
        window.location.reload();
    } catch (err) {
        alert('상태 변경 실패: ' + err.message);
    } finally {
        hideLoader();
    }
};

function getIndustryIcon(industry) {
    const iconMap = {
        'AI': 'smart_toy',
        'IT·정보통신': 'computer',
        'SaaS·솔루션': 'cloud',
        '게임': 'sports_esports',
        '공공·국방': 'policy',
        '관광·레저': 'beach_access',
        '교육·에듀테크': 'school',
        '금융·핀테크': 'payments',
        '농축수산·어업': 'agriculture',
        '농·임·어업': 'agriculture',
        '라이프스타일': 'person',
        '모빌리티': 'directions_car',
        '문화예술·콘텐츠': 'movie',
        '바이오·헬스케어': 'medical_services',
        '부동산': 'real_estate_agent',
        '뷰티·패션': 'content_cut',
        '에너지·환경': 'eco',
        '외식업·소상공인': 'restaurant',
        '외식·음료·소상공인': 'restaurant',
        '우주·항공': 'rocket',
        '유통·물류': 'local_shipping',
        '제조·건설': 'factory',
        '플랫폼·커뮤니티': 'groups',
        '기타': 'storefront'
    };
    return iconMap[industry] || 'storefront';
}

function escapeHtml(unsafe) {
    if (!unsafe && unsafe !== 0) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 진행 현황 동기화 (Sellers/Buyers/Project)
 */
async function renderLinkedStatus() {
    let status = projectData.status || 'PENDING';

    // 구버전 한글 상태값 호환성 처리
    if (status === '진행중') status = 'ACTIVE';
    if (status === '완료') status = 'COMPLETED';
    if (status === '대기') status = 'PENDING';
    if (status === '중단' || status === '정지') status = 'STOPPED';

    $('.btn-status-chip').removeClass('active');
    $(`.btn-status-chip[data-status="${status}"]`).addClass('active');
}

/**
 * 자동 저장 필드 렌더링 및 권한 처리 + 리포트 링크
 */
function renderAutoSaveFields() {
    const isMaster = projectData.myRole === 'MASTER';
    
    // 1. Textareas (Description only now)
    const fields = [
        { id: 'project-desc-input', val: projectData.description }
    ];

    fields.forEach(f => {
        const $el = $(`#${f.id}`);
        $el.val(f.val || '');
        if (!isMaster) {
            $el.prop('disabled', true).attr('placeholder', '마스터만 편집 가능한 영역입니다.');
        }
    });

    // 2. Report Links (Teaser context)
    if (projectData.seller_id) {
        $('#btn-report-seller')
            .removeClass('no-link')
            .text('리포트 보기')
            .attr('href', `./dealbook_sellers.html?id=${projectData.seller_id}&from=totalseller&mode=read`)
            .attr('target', '_blank');
    } else {
        $('#btn-report-seller')
            .addClass('no-link')
            .text('연동된 업체 없음')
            .attr('href', '#')
            .removeAttr('target');
    }

    if (projectData.buyer_id) {
        $('#btn-report-buyer')
            .removeClass('no-link')
            .text('리포트 보기')
            .attr('href', `./dealbook_buyers.html?id=${projectData.buyer_id}&from=totalbuyer&mode=read`)
            .attr('target', '_blank');
    } else {
        $('#btn-report-buyer')
            .addClass('no-link')
            .text('연동된 업체 없음')
            .attr('href', '#')
            .removeAttr('target');
    }

    // 3. Status Group Permission
    if (!isMaster) {
        $('.btn-status-chip').prop('disabled', true);
        $('#btn-add-teaser-seller, #btn-add-teaser-buyer').hide();
    }
}

// Duplicated logic removed

function setupEventListeners(projectId) {
    // 업무 일지 등록
    $('#btn-save-work-log').off('click').on('click', () => saveWorkLog(projectId));

    // Ctrl + Enter로 등록 지원
    $('#work-log-input').on('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveWorkLog(projectId);
        }
    });

    // 자동 저장 리스너 (마스터 전용)
    if (projectData.myRole === 'MASTER') {
        $('.pd-autosave-textarea').on('input', function() {
            const fieldId = $(this).attr('id');
            const value = $(this).val();
            
            if (fieldId === 'project-desc-input') {
                debounceSave(projectId, 'description', value, 'desc');
            }
        });

        // 상태 수동 변경 리스너 (버튼식)
        $('.btn-status-chip').on('click', async function() {
            const newStatus = $(this).data('status');
            // Optimistically update UI
            $('.btn-status-chip').removeClass('active');
            $(this).addClass('active');
            
            // Sync with local data and update DB
            if (projectData) {
                projectData.status = newStatus;
                await updateLinkedStatus(projectId, newStatus);
            }
        });

        $('#btn-delete-project').off('click').on('click', () => deleteProject(projectId));
    } else {
        $('#btn-delete-project').hide();
        $('#btn-add-member').hide();
    }

    // 멤버 추가 버튼
    $('#btn-add-member').off('click').on('click', openInviteModal);

    // 티저 추가 버튼
    $('#btn-link-seller').off('click').on('click', () => openEntitySelectModal('SELLER'));
    $('#btn-link-buyer').off('click').on('click', () => openEntitySelectModal('BUYER'));
}

function openInviteModal() {
    $('#member-search-input').val('');
    $('#member-search-results').empty();
    const modalEl = document.getElementById('memberInviteModal');
    let modal = bootstrap.Modal.getInstance(modalEl);
    if (!modal) modal = new bootstrap.Modal(modalEl);
    modal.show();

    $('#member-search-input').off('input').on('input', function() {
        const query = $(this).val().toLowerCase().trim();
        renderSearchList(query);
    });
}

function renderSearchList(query) {
    const $results = $('#member-search-results');
    $results.empty();
    if (!query) return;

    const filtered = Object.values(userMap).filter(u => 
        u.name.toLowerCase().includes(query) || 
        (u.company && u.company.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        $results.append('<div class="p-3 text-center text-muted small">검색 결과가 없습니다.</div>');
        return;
    }

    filtered.forEach(user => {
        const isAlreadyMember = projectData.project_members.find(m => String(m.user_id) === String(user.id));
        const avatar = resolveAvatarUrl(user.avatar_url, 1);
        
        const $item = $(`
            <div class="member-search-item ${isAlreadyMember ? 'opacity-50' : ''}">
                <img src="${avatar}" class="member-search-avatar" alt="Avatar">
                <div class="flex-grow-1">
                    <div class="member-search-name">${user.name}</div>
                    <div class="member-search-company">${user.company || '소속 정보 없음'}</div>
                </div>
                ${isAlreadyMember ? '<span class="badge bg-label-secondary small">이미 참여중</span>' : 
                `<button class="btn btn-sm btn-outline-primary rounded-pill py-1" onclick="addMember('${user.id}')">초대</button>`}
            </div>
        `);
        $results.append($item);
    });
}

function debounceSave(projectId, field, value, indicatorId) {
    const $indicator = $(`#save-indicator-${indicatorId}`);
    $indicator.text('저장 중...').css('opacity', '1');

    if (autoSaveTimers[field]) clearTimeout(autoSaveTimers[field]);

    autoSaveTimers[field] = setTimeout(async () => {
        try {
            const { error } = await _supabase
                .from('projects')
                .update({ [field]: value, updated_at: new Date().toISOString() })
                .eq('id', projectId);

            if (error) throw error;
            $indicator.text('저장됨');
            setTimeout(() => $indicator.css('opacity', '0'), 2000);
        } catch (err) {
            console.error('자동 저장 오류:', err);
            $indicator.text('저장 실패');
        }
    }, 1000);
}

/**
 * 상태 변경 시 연동 테이블 동시 업데이트
 */
async function updateLinkedStatus(projectId, newStatus) {
    showLoader();
    try {
        const type = projectData.entity_type;
        const now = new Date().toISOString();
        const updatePayload = { status: newStatus, updated_at: now };

        if (newStatus === 'ACTIVE' && !projectData.started_at) {
            updatePayload.started_at = now;
            projectData.started_at = now;
            renderProjectInfo();
        }

        console.log('상태 업데이트 시작:', { targetId: projectData.id, newStatus, updatePayload });
        const { data, error: pErr } = await _supabase.from('projects').update(updatePayload).eq('id', projectData.id).select();
        
        if (pErr) {
            console.error('DB 업데이트 실패:', pErr);
            alert('상태 변경 실패: ' + (pErr.message || JSON.stringify(pErr)));
            throw pErr;
        }

        console.log('DB 업데이트 성공:', data);

        // 로컬 데이터 동기화
        projectData.status = newStatus;
        alert('프로젝트 상태가 변경되었습니다.'); // 사용자가 확인 가능하도록 알림 추가

        const $toast = $('<div style="position: fixed; top: 100px; left: 50%; transform: translateX(-50%); background: #1e293b; color: #fff; padding: 12px 24px; border-radius: 30px; z-index: 10000; font-size: 13px; font-weight: 700;">상태가 변경되었습니다.</div>');
        $('body').append($toast);
        setTimeout(() => $toast.fadeOut(500, () => $toast.remove()), 1500);

    } catch (err) {
        console.error('상태 업데이트 실패:', err);
        alert('상태 변경에 실패했습니다.');
    } finally {
        hideLoader();
    }
}

/**
 * 업무 일지
 */
async function saveWorkLog(projectId) {
    const $input = $('#work-log-input');
    const content = $input.val().trim();
    if (!content) return;

    const $btn = $('#btn-save-work-log');
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('등록 중...');

    try {
        const { error } = await _supabase.from('work_logs').insert([{
            project_id: projectId,
            user_id: currentUser.id,
            content: content
        }]);

        if (error) throw error;
        $input.val('');
        await loadWorkLogs(projectId);
    } catch (err) {
        console.error('일지 저장 오류:', err);
        alert('일지 저장에 실패했습니다.');
    } finally {
        $btn.prop('disabled', false).text(originalText);
    }
}

async function loadWorkLogs(projectId, showLoading = true) {
    const $feed = $('#work-log-feed');
    if (showLoading) $feed.html('<div class="text-center py-5 text-muted small">데이터를 불러오는 중...</div>');

    try {
        const { data: logs, error } = await _supabase
            .from('work_logs')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        $feed.empty();

        if (!logs || logs.length === 0) {
            $feed.append('<div class="text-center py-5 text-muted small">아직 등록된 업무 일지가 없습니다.</div>');
            return;
        }

        logs.forEach(log => {
            const u = userMap[log.user_id] || { name: '알 수 없음' };
            const isMyLog = String(log.user_id) === String(currentUser.id);
            const isMaster = projectData.myRole === 'MASTER';
            const memberInfo = projectData.project_members.find(m => String(m.user_id) === String(log.user_id));
            const badgeClass = (memberInfo?.role === 'MASTER') ? 'badge-master' : 'badge-member';
            const roleName = (memberInfo?.role === 'MASTER') ? 'MASTER' : 'MEMBER';
            const avatar = resolveAvatarUrl(u.avatar_url, 1);

            const isModified = log.updated_at && log.updated_at !== log.created_at;
            const _lt = new Date(log.created_at);
            const timeText = `${_lt.getFullYear()}.${String(_lt.getMonth()+1).padStart(2,'0')}.${String(_lt.getDate()).padStart(2,'0')} ${String(_lt.getHours()).padStart(2,'0')}:${String(_lt.getMinutes()).padStart(2,'0')}`;
            const modifiedText = isModified ? `<span class="ms-2" style="font-size: 10px; color: #94a3b8;">(수정됨: ${new Date(log.updated_at).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })})</span>` : '';

            const $card = $(`
                <div class="work-log-card" id="log-card-${log.id}">
                    <div class="log-header">
                        <div class="log-author-info">
                            <img src="${avatar}" class="log-author-avatar" alt="Avatar">
                            <div>
                                <div class="d-flex align-items-center" style="gap: 10px;">
                                    <span class="log-author-name">${u.name}</span>
                                    <span class="log-author-badge ${badgeClass}">${roleName}</span>
                                </div>
                                <span class="log-time">${timeText}${modifiedText}</span>
                            </div>
                        </div>
                        ${(isMyLog || isMaster) ? `
                        <div class="log-actions">
                            <span class="material-symbols-outlined btn-log-action" onclick="enterLogEditMode('${log.id}')">edit</span>
                            <span class="material-symbols-outlined btn-log-action delete" onclick="deleteWorkLog('${log.id}')">delete</span>
                        </div>
                        ` : ''}
                    </div>
                    <div class="log-content-area">
                        <p class="log-content">${log.content}</p>
                    </div>
                </div>
            `);
            $feed.append($card);
        });
    } catch (err) {
        console.error('일지 로드 오류:', err);
    }
}

window.enterLogEditMode = function(logId) {
    const $card = $(`#log-card-${logId}`);
    const $contentArea = $card.find('.log-content-area');
    const existingContent = $contentArea.find('.log-content').text();

    $contentArea.html(`
        <div class="log-edit-mode">
            <textarea id="edit-input-${logId}" rows="3">${existingContent}</textarea>
            <div class="d-flex justify-content-end gap-2">
                <button class="btn btn-sm btn-link text-muted text-decoration-none" onclick="exitLogEditMode('${logId}', '${existingContent.replace(/'/g, "\\'")}')">취소</button>
                <button class="btn btn-sm btn-primary rounded-pill px-3" onclick="updateWorkLog('${logId}')">저장</button>
            </div>
        </div>
    `);
};

window.exitLogEditMode = function(logId, content) {
    const $card = $(`#log-card-${logId}`);
    $card.find('.log-content-area').html(`<p class="log-content">${content}</p>`);
};

window.updateWorkLog = async function(logId) {
    const newContent = $(`#edit-input-${logId}`).val().trim();
    if (!newContent) return;

    try {
        const { error } = await _supabase
            .from('work_logs')
            .update({ content: newContent, updated_at: new Date().toISOString() })
            .eq('id', logId);

        if (error) throw error;
        await loadWorkLogs(projectData.id, false);
    } catch (err) {
        alert('수정 실패: ' + err.message);
    }
};

window.deleteWorkLog = async function(logId) {
    if (!confirm('업무 일지를 삭제하시겠습니까?')) return;

    try {
        const { error } = await _supabase
            .from('work_logs')
            .delete()
            .eq('id', logId);

        if (error) throw error;
        await loadWorkLogs(projectData.id, false);
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

/**
 * 멤버 관리
 */
function renderMemberList() {
    const $list = $('#member-list');
    $list.empty();
    const isIAmMaster = projectData.myRole === 'MASTER';

    projectData.project_members.forEach(m => {
        const u = userMap[m.user_id] || { name: 'Unknown', company: '' };
        const isMaster = m.role === 'MASTER';
        const badgeClass = isMaster ? 'badge-master' : 'badge-member';
        const avatar = resolveAvatarUrl(u.avatar_url, 1);

        const $item = $(`
            <div class="member-item">
                <div class="member-info">
                    <img src="${avatar}" class="member-avatar" alt="Avatar">
                    <div class="member-details">
                        <div class="d-flex align-items-center" style="gap: 6px;">
                            <span class="member-name">${u.name}</span>
                            <span class="badge ${badgeClass}" style="font-size: 9px; padding: 2px 6px;">${isMaster ? 'Master' : 'Member'}</span>
                        </div>
                        <div class="member-role" style="margin-top: 2px;">${u.company || '소속 정보 없음'}</div>
                    </div>
                </div>
                <div class="member-actions">
                    ${isIAmMaster && !isMaster ? `
                        <button class="btn-action" onclick="transferMaster('${m.user_id}', '${u.name}')" title="마스터 권한 양도">
                            <span class="material-symbols-outlined" style="font-size: 16px;">verified_user</span>
                        </button>
                        <button class="btn-action text-danger" onclick="removeMember('${m.user_id}', '${u.name}')" title="멤버 내보내기">
                            <span class="material-symbols-outlined" style="font-size: 16px;">person_remove</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `);
        $list.append($item);
    });

    // [특수 기능] 본인이 마스터인데 프로젝트 소유자(created_by)가 아닌 경우 (데이터 불일치 복구용)
    if (isIAmMaster && String(projectData.created_by) !== String(currentUser.id)) {
        const $repairArea = $(`
            <div class="mt-3 p-3 border rounded shadow-sm" style="background: #fff9f0; border-color: #ffe4b3 !important;">
                <div class="d-flex align-items-center gap-2 mb-2" style="color: #856404;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">info</span>
                    <span style="font-size: 13px; font-weight: 600;">권한 불일치 감지</span>
                </div>
                <p style="font-size: 12px; color: #666; margin-bottom: 12px; line-height: 1.5;">
                    마스터 권한은 있으나 프로젝트 소유권 정보가 동기화되지 않았습니다. 이로 인해 일부 기능(연동 해제 등)이 제한될 수 있습니다.
                </p>
                <button class="btn btn-sm w-100" style="background: #ff9800; color: white;" onclick="repairProjectOwnership()">
                    권한 정보 동기화 (복구)
                </button>
            </div>
        `);
        $list.append($repairArea);
    }
}

/**
 * 프로젝트 소유권 강제 동기화 (마스터 권한은 있으나 created_by가 다른 경우)
 */
window.repairProjectOwnership = async function() {
    if (!confirm('프로젝트 권한 정보를 현재 마스터 계정으로 동기화하시겠습니까?')) return;
    
    showLoader();
    try {
        const { error } = await _supabase
            .from('projects')
            .update({ created_by: currentUser.id })
            .eq('id', projectData.id);
            
        if (error) throw error;
        
        alert('권한 정보가 성공적으로 동기화되었습니다.');
        window.location.reload();
    } catch (err) {
        console.error('권한 복구 실패:', err);
        alert('복구 실패: ' + (err.message || '데이터베이스 정책에 의해 거부되었습니다. 이전 마스터가 직접 양도해 주어야 할 수도 있습니다.'));
    } finally {
        hideLoader();
    }
}

window.addMember = async function(userId) {
    if (projectData.project_members.find(m => String(m.user_id) === String(userId))) {
        alert('이미 참여 중인 멤버입니다.');
        return;
    }

    try {
        const { error } = await _supabase.from('project_members').insert([{
            project_id: projectData.id,
            user_id: userId,
            role: 'MEMBER'
        }]);

        if (error) throw error;
        
        const modalEl = document.getElementById('memberInviteModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        alert('멤버가 성공적으로 추가되었습니다.');
        window.location.reload();
    } catch (err) {
        alert('추가 실패: ' + err.message);
    }
};

window.removeMember = async function(userId, name) {
    if (!confirm(`${name}님을 프로젝트에서 내보내시겠습니까?`)) return;

    try {
        const { error } = await _supabase
            .from('project_members')
            .delete()
            .eq('project_id', projectData.id)
            .eq('user_id', userId);

        if (error) throw error;
        window.location.reload();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

window.transferMaster = async function(userId, name) {
    if (!confirm(`${name}님에게 마스터 권한을 양도하시겠습니까?\n양도 후 본인은 일반 MEMBER가 됩니다.`)) return;

    showLoader();
    try {
        // 1. 새로운 마스터 권한 부여 (가장 먼저 수행하여 권한 위임 준비)
        const { data: d1, error: e1 } = await _supabase
            .from('project_members')
            .update({ role: 'MASTER' })
            .eq('project_id', projectData.id)
            .eq('user_id', userId)
            .select();

        if (e1) {
            console.error('대상자 승격 실패:', e1);
            throw e1;
        }
        if (!d1 || d1.length === 0) {
            throw new Error('대상 멤버의 권한을 변경할 수 없습니다. DB 정책을 확인하세요.');
        }

        // 2. 프로젝트 소유권(created_by) 변경
        const { error: e2 } = await _supabase
            .from('projects')
            .update({ created_by: userId })
            .eq('id', projectData.id);

        if (e2) {
            console.warn('프로젝트 소유권(created_by) 이양 실패. 기능에 영향을 줄 수 있습니다:', e2);
        }

        // 3. 기존 마스터 권한 강등 (본인의 권한을 마지막에 내려놓음)
        const { data: d3, error: e3 } = await _supabase
            .from('project_members')
            .update({ role: 'MEMBER' })
            .eq('project_id', projectData.id)
            .eq('user_id', currentUser.id)
            .select();

        if (e3) {
            console.error('본인 권한 강등 실패:', e3);
            throw e3;
        }
        if (!d3 || d3.length === 0) {
            throw new Error('본인 권한 강등에 실패했습니다. DB 정책을 확인하세요.');
        }

        alert('마스터 권한이 성공적으로 양도되었습니다.');
        window.location.reload();
    } catch (err) {
        console.error('권한 양도 실행 오류:', err);
        alert('양도 과정에서 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
    } finally {
        hideLoader();
    }
};

async function deleteProject(projectId) {
    if (!confirm('정말로 이 프로젝트를 삭제하시겠습니까? 관련 데이터가 모두 접근 불가 처리됩니다.')) return;

    try {
        const { error } = await _supabase
            .from('projects')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', projectId);

        if (error) throw error;
        alert('프로젝트가 삭제되었습니다.');
        location.href = 'total_projects.html';
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
}
