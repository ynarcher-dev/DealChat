import { checkAuth, hideLoader, resolveAvatarUrl } from './auth_utils.js';

const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

let allProjects = [];
let filteredProjects = [];
let currentUser = null;
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let currentSort = 'updated_desc';

// Editor States
let projectToEdit = null;
let selectedMembers = []; // { id, name, role }
let userMap = {};
let linkedSeller = null;
let linkedBuyer = null;

function escapeHtml(unsafe) {
    if (!unsafe && unsafe !== 0) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

$(document).ready(async function () {
    currentUser = checkAuth();
    if (!currentUser) return;

    await loadAllUsers();
    await loadProjects();
    setupEditorEvents();

    // URL 파라미터 확인 (수정 모드 지원)
    const urlParams = new URLSearchParams(window.location.search);
    const editProjectId = urlParams.get('project_id');
    if (editProjectId) {
        openProjectModal(editProjectId);
    }

    // Filter events (from hidden selects, synced by radio buttons in HTML)
    $('#filter-type, #filter-status').on('change', function () {
        currentPage = 1;
        applyFilters();
    });

    // Search
    $('#search-icon-btn').on('click', function () { currentPage = 1; applyFilters(); });
    $('#search-project').on('keypress', function (e) {
        if (e.which === 13) { currentPage = 1; applyFilters(); }
    });
    $('#search-project').on('input', function () { currentPage = 1; applyFilters(); });

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

    $('#btn-add-project').on('click', function() {
        openProjectModal();
    });

    hideLoader();
});

async function loadAllUsers() {
    try {
        const { data: users, error } = await _supabase.from('users').select('id, name, company, avatar_url');
        if (error) throw error;
        users.forEach(u => userMap[u.id] = u);
    } catch (err) {
        console.error('유저 로드 오류:', err);
    }
}

async function loadProjects() {
    const $container = $('#project-list-container');
    $container.html('<tr><td colspan="7" class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></td></tr>');

    try {
        // projects와 project_members를 별도 쿼리로 조회 (RLS 재귀 방지)
        const { data: projects, error: projectError } = await _supabase
            .from('projects')
            .select('*')
            .is('deleted_at', null);

        if (projectError) {
            console.error('프로젝트 조회 상세 오류:', projectError);
            throw projectError;
        }

        const projectIds = (projects || []).map(p => p.id);
        let membersMap = {};

        if (projectIds.length > 0) {
            const { data: members } = await _supabase
                .from('project_members')
                .select('*')
                .in('project_id', projectIds);
            (members || []).forEach(m => {
                if (!membersMap[m.project_id]) membersMap[m.project_id] = [];
                membersMap[m.project_id].push(m);
            });
        }

        const fullProjects = (projects || []).map(p => ({
            ...p,
            project_members: membersMap[p.id] || []
        }));

        if (fullProjects.length > 0) {
            console.log('DB 프로젝트 테이블 컬럼 확인:', Object.keys(projects[0]).join(', '));
        }

        // 본인이 생성했거나 멤버로 등록된 프로젝트만 필터링
        allProjects = fullProjects.filter(p =>
            String(p.created_by) === String(currentUser.id) ||
            p.project_members.some(m => String(m.user_id) === String(currentUser.id))
        );

        applyFilters();

    } catch (err) {
        console.error('프로젝트 로드 오류:', err);
        allProjects = [];
        applyFilters();
    }
}

/**
 * Editor Logic
 */
async function fetchProject(id) {
    try {
        const { data, error } = await _supabase
            .from('projects')
            .select('*, project_members(*, users:user_id(name))')
            .eq('id', id)
            .is('deleted_at', null)
            .single();
        if (error) throw error;
        return data;
    } catch (err) {
        console.error('프로젝트 조회 오류:', err);
        return null;
    }
}

async function openProjectModal(projectId = null) {
    projectToEdit = null;
    selectedMembers = [];
    linkedSeller = null;
    linkedBuyer = null;

    // Reset Form
    $('#project-editor-form')[0].reset();
    $('#projectModalTitle').text('새 프로젝트 생성');
    $('#btn-save-project').text('생성하기');
    $('#selected-members-container').empty();
    $('.user-search-results').addClass('d-none');
    
    if (projectId) {
        showLoader();
        projectToEdit = await fetchProject(projectId);
        if (projectToEdit) {
            $('#projectModalTitle').text('프로젝트 설정 편집');
            $('#btn-save-project').text('변경사항 저장');
            $('#project-name').val(projectToEdit.name);
            $('#entity-type').val(projectToEdit.entity_type);
            

            
            projectToEdit.project_members.forEach(m => {
                addMember(m.user_id, m.role);
            });
        }
        hideLoader();
    } else {
        addMember(currentUser.id, 'MASTER');
        $('#project-name').val('PROJECT ');
    }

    const modalEl = document.getElementById('projectEditorModal');
    if (!modalEl) return;
    
    if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
    }

    let modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (!modalInstance) {
        modalInstance = new bootstrap.Modal(modalEl);
    }
    modalInstance.show();
}

function updateTypeUI() {
    // UI is now simplified, no specific logic needed here for now
}

function setupEditorEvents() {
    $('#entity-type').on('change', updateTypeUI);

    // Member Search
    $('#member-search-input').on('input', function() {
        const keyword = $(this).val().toLowerCase().trim();
        const $results = $('#member-search-results');
        if (!keyword) { $results.addClass('d-none'); return; }

        const matches = Object.values(userMap).filter(u => 
            String(u.name || '').toLowerCase().includes(keyword) || 
            (u.company && u.company.toLowerCase().includes(keyword))
        ).slice(0, 5);

        if (matches.length === 0) { $results.addClass('d-none'); return; }

        $results.empty().removeClass('d-none');
        matches.forEach(u => {
            const $div = $(`
                <div class="p-2 border-bottom user-item" style="cursor: pointer;">
                    <div class="fw-bold small">${escapeHtml(u.name)}</div>
                    <div class="text-muted" style="font-size: 10px;">${escapeHtml(u.company || '')}</div>
                </div>
            `);
            $div.on('click', () => {
                addMember(u.id, 'MEMBER');
                $('#member-search-input').val('');
                $results.addClass('d-none');
            });
            $results.append($div);
        });
    });

    /* 프로젝트 생성 기능 일시 중단
    $('#project-editor-form').on('submit', async (e) => {
        e.preventDefault();
        await saveProject();
    });
    */

    $(document).on('click', (e) => {
        if (!$(e.target).closest('.search-input-group, #member-search-input').length) {
            $('.user-search-results').addClass('d-none');
        }
    });
}

function addMember(id, role = 'MEMBER') {
    if (selectedMembers.find(m => m.id === id)) return;
    const user = userMap[id];
    if (!user) return;
    selectedMembers.push({ id, name: user.name, role });
    renderMemberTags();
}

function renderMemberTags() {
    const $container = $('#selected-members-container');
    $container.empty();
    selectedMembers.forEach(m => {
        const isMaster = m.role === 'MASTER';
        const $tag = $(`
            <div class="member-tag ${isMaster ? 'role-master' : ''}">
                <span class="fw-bold" style="font-size: 13px;">${escapeHtml(m.name)}</span>
                <span class="badge ${isMaster ? 'bg-primary' : 'bg-secondary-subtle text-secondary'} ms-1" style="font-size: 10px;">${m.role}</span>
            </div>
        `);
        if (m.id !== currentUser.id) {
            const $removeBtn = $(`<span class="material-symbols-outlined remove-btn" style="font-size: 16px;">close</span>`);
            $removeBtn.on('click', () => {
                selectedMembers = selectedMembers.filter(sm => sm.id !== m.id);
                renderMemberTags();
            });
            $tag.append($removeBtn);
        }
        $container.append($tag);
    });
}

function suggestProjectName() {
    // No automatic name suggestion for now to keep it simple
}

async function saveProject() {
    const btn = $('#btn-save-project');
    const originalText = btn.text();
    btn.prop('disabled', true).text('처리 중...');

    try {
        const type = $('#entity-type').val();
        const projectName = $('#project-name').val()?.trim() || '';
        
        if (!projectName || projectName.length < 2) {
            alert('프로젝트 명칭을 2자 이상 입력해주세요.');
            $('#project-name').focus();
            throw new Error('프로젝트 명칭이 너무 짧거나 입력되지 않았습니다.');
        }

        console.log('프로젝트 데이터 저장 시도 (입력값):', type, projectName);



        const projectData = {
            name: projectName,
            entity_type: type,
            status: 'PENDING', // 신규 프로젝트는 '대기' 상태로 시작
            updated_at: new Date().toISOString()
        };

        let projectId = projectToEdit ? projectToEdit.id : null;

        if (projectId) {
            // Update
            console.log('프로젝트 업데이트 시도:', projectId, projectData);
            const { error } = await _supabase.from('projects').update(projectData).eq('id', projectId);
            if (error) throw error;
        } else {
            // Create
            projectData.created_by = currentUser.id;
            console.log('프로젝트 생성 시도:', projectData);
            const { data, error } = await _supabase.from('projects').insert([projectData]).select().single();
            if (error) throw error;
            projectId = data.id;

            // 활동 로그 (최초 생성 시만)
            await _supabase.from('activity_logs').insert([{
                project_id: projectId,
                user_id: currentUser.id,
                event_type: 'PROJECT_CREATE',
                content: `프로젝트가 생성되었습니다. (${type})`
            }]);
        }

        // 멤버 업데이트 (DB 재귀 오류 가능성을 고려하여 비차단 처리)
        console.log('Update project members for:', projectId);
        try {
            await _supabase.from('project_members').delete().eq('project_id', projectId);
            
            const validMembers = selectedMembers.filter(m => m.id && m.id.length > 10); 
            const memberPayload = validMembers.map(m => ({ project_id: projectId, user_id: m.id, role: m.role }));
            
            if (memberPayload.length > 0) {
                const { error: mError } = await _supabase.from('project_members').insert(memberPayload);
                if (mError) {
                    console.warn('Project member link partially failed (RLS error):', mError.message);
                }
            }
        } catch (memErr) {
            console.warn('Project member update skipped due to database policy conflict.');
        }

        alert(projectToEdit ? '변경사항이 저장되었습니다.' : '프로젝트가 성공적으로 생성되었습니다.');
        
        // Modal 닫기 (Bootstrap instance 활용)
        const modalEl = document.getElementById('projectEditorModal');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        
        // 목록 새로고침
        if (typeof loadProjects === 'function') await loadProjects();
        else location.reload();

    } catch (err) {
        console.error('프로젝트 저장 오류 상세:', err);
        let errorMsg = '알 수 없는 오류';
        let errorDetails = '';
        let errorHint = '';

        if (typeof err === 'object' && err !== null) {
            errorMsg = err.message || err.error_description || JSON.stringify(err, null, 2);
            errorDetails = err.details ? `\n상세: ${err.details}` : '';
            errorHint = err.hint ? `\n힌트: ${err.hint}` : '';
            // 만약 여전히 Object로 나온다면 강제 문자열화
            if (errorMsg === '[object Object]') errorMsg = JSON.stringify(err);
        } else {
            errorMsg = String(err);
        }
        
        alert(`저장 실패: ${errorMsg}${errorDetails}${errorHint}`);
    } finally {
        btn.prop('disabled', false).text(originalText);
    }
}

function applyFilters() {
    const type = $('#filter-type').val();
    const status = $('#filter-status').val();
    const search = $('#search-project').val().toLowerCase().trim();

    filteredProjects = allProjects.filter(p => {
        const matchesType = type === 'ALL' || p.entity_type === type;
        
        // 상태 필터 매칭 로직 강화 (영문 키와 한글 라벨 모두 대응)
        let matchesStatus = status === 'ALL';
        if (!matchesStatus) {
            const pStatus = p.status || 'PENDING';
            if (pStatus === status) matchesStatus = true;
            else if (status === 'ACTIVE' && (pStatus === '진행중' || pStatus === '진행 중')) matchesStatus = true;
            else if (status === 'COMPLETED' && pStatus === '완료') matchesStatus = true;
            else if (status === 'PENDING' && pStatus === '대기') matchesStatus = true;
            else if (status === 'STOPPED' && (pStatus === '중단' || pStatus === '정지' || pStatus === 'ON_HOLD')) matchesStatus = true;
        }

        const matchesSearch = !search ||
            p.name.toLowerCase().includes(search) ||
            (p.entity_name_manual && p.entity_name_manual.toLowerCase().includes(search));
        
        return matchesType && matchesStatus && matchesSearch;
    });

    sortProjects();
    renderProjects();
    renderPagination();
}

function sortProjects() {
    filteredProjects.sort((a, b) => {
        switch (currentSort) {
            case 'updated_desc':
                return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
            case 'created_desc':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'created_asc':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'name_asc':
                return a.name.localeCompare(b.name, 'ko');
            case 'name_desc':
                return b.name.localeCompare(a.name, 'ko');
            case 'progress_desc':
                return (b.progress_rate || 0) - (a.progress_rate || 0);
            case 'progress_asc':
                return (a.progress_rate || 0) - (b.progress_rate || 0);
            case 'deadline_asc': {
                const da = a.deadline ? new Date(a.deadline) : new Date('9999-12-31');
                const db = b.deadline ? new Date(b.deadline) : new Date('9999-12-31');
                return da - db;
            }
            default:
                return 0;
        }
    });
}

function renderProjects() {
    const $container = $('#project-list-container');
    $container.empty();

    if (filteredProjects.length === 0) {
        $container.html(`
            <tr>
                <td colspan="7" style="padding: 60px 0; text-align: center; vertical-align: middle;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                        <span class="material-symbols-outlined" style="font-size: 40px; color: #cbd5e1;">work_off</span>
                        <span style="font-size: 14px; color: #94a3b8; font-weight: 500;">참여 중인 프로젝트가 없습니다.</span>
                    </div>
                </td>
            </tr>`);
        return;
    }

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filteredProjects.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    pageItems.forEach(project => {
        const members = project.project_members || [];

        // PM 정보 추출 (MASTER 권한자를 최우선으로, 없으면 최초 생성자 표시)
        const pmUserId = (members.find(m => m.role === 'MASTER')?.user_id) || project.created_by;
        const pmUser = pmUserId ? userMap[pmUserId] : null;
        const pmName = pmUser ? pmUser.name : '미지정';
        const pmAvatar = pmUser ? resolveAvatarUrl(pmUser.avatar_url, 1) : resolveAvatarUrl(null, 1);
        const pmCompany = pmUser ? (pmUser.company || '') : '';

        // 팀원 목록 (PM 본인을 제외한 나머지 멤버)
        const teamMembers = members.filter(m => String(m.user_id) !== String(pmUserId));
        const membersHtml = teamMembers.map(m => {
            const u = userMap[m.user_id];
            if (!u) return '';
            const url = resolveAvatarUrl(u.avatar_url, 1);
            const name = u.name || '알 수 없음';
            return `
                <div class="d-flex align-items-center gap-1" style="margin-right: 10px; flex-shrink: 0;" title="${escapeHtml(name)}">
                    <img src="${url}" alt="${escapeHtml(name)}" class="rounded-circle" style="width: 22px; height: 22px; border: 1px solid #e2e8f0; flex-shrink: 0;">
                    <span style="font-size: 11px; font-weight: 500; color: #64748b; white-space: nowrap;">${escapeHtml(name)}</span>
                </div>`;
        }).join('');

        const deadline = (() => {
            if (!project.deadline) return '미설정';
            const d = new Date(project.deadline);
            return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        })();

        const isDeadlineSoon = project.deadline && (() => {
            const diff = new Date(project.deadline) - new Date();
            return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
        })();

        const statusClass = `badge-${(project.status || 'PENDING').toLowerCase().replace('_', '-')}`;
        const statusLabel = getStatusLabel(project.status);
        const typeLabel = getTypeLabel(project.entity_type);
        const typeIcon = getTypeIcon(project.entity_type);

        const iconBg = '#1a2a44';

        const updatedAt = (() => {
            if (!project.updated_at && !project.created_at) return '-';
            const d = new Date(project.updated_at || project.created_at);
            return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        })();

        const rowHtml = `
            <tr onclick="location.href='project_detail.html?id=${project.id}'" style="cursor: pointer;">
                <td style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-2">
                        <div style="width: 34px; height: 34px; background: ${iconBg}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <span class="material-symbols-outlined" style="color: #fff; font-size: 18px;">${typeIcon}</span>
                        </div>
                        <span style="font-weight: 700; color: #1e293b; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; max-width: 240px;">${escapeHtml(project.name)}</span>
                    </div>
                </td>
                <td style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span style="font-size: 13px; font-weight: 600; color: #1e3a5f; white-space: nowrap;">${escapeHtml(typeLabel)}</span>
                </td>
                <td style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
                </td>
                <td style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center gap-2">
                        <img src="${pmAvatar}" alt="${escapeHtml(pmName)}" class="rounded-circle" style="width: 26px; height: 26px; border: 1px solid #e2e8f0; flex-shrink: 0;">
                        <div style="min-width: 0;">
                            <div style="font-size: 13px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(pmName)}</div>
                            ${pmCompany ? `<div style="font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(pmCompany)}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important;">
                    <div class="d-flex align-items-center flex-wrap" style="gap: 4px;">
                        ${membersHtml || '<span style="font-size: 13px; color: #cbd5e1;">-</span>'}
                    </div>
                </td>
                <td class="deadline-td" style="padding: 16px 20px !important; border-right: 1px solid #f8fafc; vertical-align: middle !important; font-size: 13px; color: ${isDeadlineSoon ? '#ef4444' : '#94a3b8'}; font-weight: ${isDeadlineSoon ? '700' : '400'}; font-family: 'Outfit', sans-serif;">${deadline}</td>
                <td class="updated-td" style="padding: 16px 20px !important; vertical-align: middle !important; font-size: 13px; color: #94a3b8; font-family: 'Outfit', sans-serif;">${updatedAt}</td>
            </tr>
        `;
        $container.append(rowHtml);
    });
}

function renderPagination() {
    const $pag = $('#pagination-container');
    $pag.empty();

    const totalPages = Math.ceil(filteredProjects.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
        const isActive = i === currentPage;
        const btn = $(`<button class="btn ${isActive ? 'btn-primary' : 'btn-outline-secondary'}" style="min-width: 36px; height: 36px; border-radius: 8px; font-size: 13px; padding: 0;">${i}</button>`);
        btn.on('click', function () {
            currentPage = i;
            renderProjects();
            renderPagination();
            document.querySelector('.search-and-actions').scrollIntoView({ behavior: 'smooth' });
        });
        $pag.append(btn);
    }
}

function renderProgressCircle(rate) {
    const pct = Math.min(100, Math.max(0, rate || 0));
    const color = pct >= 80 ? '#16a34a' : pct >= 40 ? '#1e3a5f' : '#94a3b8';
    return `
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 60px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; font-weight: 700; color: ${color};">${pct}%</span>
            </div>
            <div style="height: 5px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>
        </div>`;
}

function getStatusLabel(status) {
    const labels = {
        'PENDING': '대기',
        'ACTIVE': '진행중',
        'COMPLETED': '완료',
        'STOPPED': '중단'
    };
    // 이전 코드 호환성 및 한글 직접 저장 대응
    if (labels[status]) return labels[status];
    if (status === 'ON_HOLD' || status === 'CANCELLED' || status === '정지') return '중단';
    if (status === '진행중' || status === '진행 중') return '진행중';
    
    return status || '-';
}

function getTypeLabel(type) {
    const labels = {
        'SELLER': '매도',
        'BUYER': '매수',
        'MATCHED': '매칭',
        'MANUAL': '기타'
    };
    return labels[type] || type || '-';
}

function getTypeIcon(type) {
    return 'handshake';
}
