
import { APIcall } from '../../js/APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

function getSupabase() {
    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(
            window.config.supabase.url,
            window.config.supabase.anonKey
        );
    }
    return window.supabaseClient;
}

// [Admin Auth Check]
async function checkAuth() {
    try {
        const _supabase = getSupabase();
        const { data: { session } } = await _supabase.auth.getSession();

        if (!session) {
            window.location.href = './admin_signin.html';
            return null;
        }

        const { data: dbUser, error } = await _supabase
            .from('users')
            .select('role, name')
            .eq('id', session.user.id)
            .single();

        if (error || !dbUser || dbUser.role !== 'admin') {
            await _supabase.auth.signOut();
            alert('관리자 권한이 없습니다.');
            window.location.href = './admin_signin.html';
            return null;
        }

        $('#admin-name').text(dbUser.name || session.user.email);
        return { id: session.user.id, email: session.user.email, name: dbUser.name, role: dbUser.role };
    } catch (e) {
        console.error('Auth check error:', e);
        window.location.href = './admin_signin.html';
        return null;
    }
}

// [Logout]
$('#logout-btn').on('click', async function () {
    if (confirm('로그아웃 하시겠습니까?')) {
        await getSupabase().auth.signOut();
        window.location.href = './admin_signin.html';
    }
});

// [Navigation]
$('.menu-link[data-page]').on('click', function () {
    const page = $(this).data('page');

    // UI Update
    $('.menu-link').removeClass('active');
    $(this).addClass('active');

    // Load Content
    loadPage(page);
});

async function loadPage(page) {
    const $content = $('#content-area');
    $('#page-title').text(page.charAt(0).toUpperCase() + page.slice(1));

    // Simple Router
    switch (page) {
        case 'dashboard':
            renderDashboard($content);
            break;
        case 'users':
            await renderGrid($content, 'users', '회원 관리');
            break;
        case 'companies':
            await renderGrid($content, 'companies', '기업 관리');
            break;
        case 'files':
            await renderGrid($content, 'files', '파일 관리');
            break;
        case 'reports':
            await renderGrid($content, 'reports', '보고서 설정');
            break;
        case 'qna':
            await renderGrid($content, 'qna', '상담 문의');
            break;
        case 'sellers':
            await renderGrid($content, 'sellers', '매도 매물');
            break;
        case 'buyers':
            await renderGrid($content, 'buyers', '매수 희망');
            break;
        default:
            renderDashboard($content);
    }
}

// Global variable for dashboard grid API
let dashboardGridApi = null;

// [Dashboard Home Renderer]
async function renderDashboard($container) {
    $container.html(`
        <div class="stats-grid">
            <!-- Row 1 -->
            <div class="card clickable-card" data-table="users" onclick="renderRecentActivity('users')">
                <div class="card-header">
                    <div class="avatar-icon"><span class="material-symbols-outlined">group</span></div>
                </div>
                <span class="card-title">Total Users</span>
                <span class="card-value" id="stat-users">Loading...</span>
            </div>
            <div class="card clickable-card" data-table="sellers" onclick="renderRecentActivity('sellers')">
                <div class="card-header">
                    <div class="avatar-icon success"><span class="material-symbols-outlined">storefront</span></div>
                </div>
                <span class="card-title">Sellers</span>
                <span class="card-value" id="stat-sellers">Loading...</span>
            </div>
            <div class="card clickable-card" data-table="buyers" onclick="renderRecentActivity('buyers')">
                <div class="card-header">
                    <div class="avatar-icon info"><span class="material-symbols-outlined">shopping_bag</span></div>
                </div>
                <span class="card-title">Buyers</span>
                <span class="card-value" id="stat-buyers">Loading...</span>
            </div>
            
            <!-- Row 2 -->
             <div class="card clickable-card" data-table="qna" onclick="renderRecentActivity('qna')">
                <div class="card-header">
                    <div class="avatar-icon warning"><span class="material-symbols-outlined">support_agent</span></div>
                </div>
                <span class="card-title">Q&A</span>
                <span class="card-value" id="stat-qna">Loading...</span>
            </div>
            <div class="card clickable-card" data-table="files" onclick="renderRecentActivity('files')">
                <div class="card-header">
                    <div class="avatar-icon" style="background: rgba(105, 108, 255, 0.16); color: #696cff;"><span class="material-symbols-outlined">description</span></div>
                </div>
                <span class="card-title">Files</span>
                <span class="card-value" id="stat-files">Loading...</span>
            </div>
            <div class="card clickable-card" data-table="companies" onclick="renderRecentActivity('companies')">
                <div class="card-header">
                    <div class="avatar-icon" style="background: rgba(113, 221, 55, 0.16); color: #71dd37;"><span class="material-symbols-outlined">business</span></div>
                </div>
                <span class="card-title">Companies</span>
                <span class="card-value" id="stat-companies">Loading...</span>
            </div>
        </div>
        
        <div class="card" style="height: 500px;">
             <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h5 id="recent-activity-title" style="margin: 0;">Recent Activity</h5>
                <input type="text" id="dashboard-search-input" placeholder="Search..." class="form-control" style="width: 250px; padding: 6px 12px; border: 1px solid #d9dee3; border-radius: 4px;">
             </div>
             <div id="dashboard-grid-wrapper" class="ag-theme-alpine" style="margin: 0 20px 20px; height: 100%;"></div>
        </div>
    `);

    // Make functions globally accessible for onclick
    window.renderRecentActivity = renderRecentActivity;

    // Bind search event
    $('#dashboard-search-input').on('input', function () {
        if (dashboardGridApi) {
            dashboardGridApi.setGridOption('quickFilterText', this.value);
        }
    });

    // Fetch Count Stats
    await fetchStats();
    // Render Default (Users)
    await renderRecentActivity('users');
}

async function renderRecentActivity(tableName = 'users') {
    let rowData = [];

    // Update header title
    $('#recent-activity-title').text('Recent Activity: ' + tableName.charAt(0).toUpperCase() + tableName.slice(1));

    // Highlight selected card
    $('.clickable-card').removeClass('active-card').css('border', 'none');
    $(`.clickable-card[data-table="${tableName}"]`).addClass('active-card').css('border', '2px solid var(--primary-color)');

    try {
        const response = await APIcall({ action: 'read', table: tableName }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
        const data = await response.json();
        // Sort by created_at desc and take top 20
        rowData = Array.isArray(data) ? data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20) : [];
    } catch (e) {
        console.error("Fetch recent activity error:", e);
    }

    const gridDiv = document.querySelector('#dashboard-grid-wrapper');
    // Clear previous grid if explicitly needed or just let createGrid handle it (AG Grid v33+ handles replacement usually)
    gridDiv.innerHTML = '';

    // Reuse column definitions from the main grid logic, but simplified if needed.
    // For "Recent Activity", we might want a simplified view, but using full columns is easier for now.
    const columnDefs = getColumnDefs(tableName).map(col => ({ ...col, flex: 1 }));

    const gridOptions = {
        theme: "legacy",
        rowData: rowData,
        columnDefs: columnDefs,
        defaultColDef: {
            sortable: true,
            resizable: true
        },
        pagination: true,
        paginationPageSize: 10,
        onRowClicked: (event) => {
            showDetailModal(event.data, tableName);
        }
    };

    dashboardGridApi = agGrid.createGrid(gridDiv, gridOptions);

    // Re-apply search if exists
    const currentSearch = $('#dashboard-search-input').val();
    if (currentSearch) {
        dashboardGridApi.setGridOption('quickFilterText', currentSearch);
    }
}

function showDetailModal(data, tableName) {
    const $modal = $('#detail-modal');
    const $content = $('#modal-content');
    const $title = $('#modal-title');

    $title.text(`${tableName.charAt(0).toUpperCase() + tableName.slice(1)} Details`);

    let html = '<table style="width: 100%; border-collapse: collapse;">';

    for (const [key, value] of Object.entries(data)) {
        // Skip some internal fields if needed, e.g., id? 
        // Showing everything for admin is usually better.
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
            displayValue = JSON.stringify(value, null, 2);
        }

        html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px 8px; font-weight: 600; width: 30%; color: #566a7f; text-transform: uppercase; font-size: 12px;">${key}</td>
                <td style="padding: 12px 8px; color: #697a8d; word-break: break-all;">${displayValue}</td>
            </tr>
        `;
    }
    html += '</table>';

    $content.html(html);
    $modal.css('display', 'flex').hide().fadeIn(200);
}

async function fetchStats() {
    try {
        // Parallel requests for counts
        const tables = ['users', 'sellers', 'buyers', 'qna', 'files', 'companies'];
        const promises = tables.map(table =>
            APIcall({ action: 'read', table: table }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .then(res => res.json())
        );

        const results = await Promise.all(promises);

        // Update UI
        $('#stat-users').text(Array.isArray(results[0]) ? results[0].length : '-');
        $('#stat-sellers').text(Array.isArray(results[1]) ? results[1].length : '-');
        $('#stat-buyers').text(Array.isArray(results[2]) ? results[2].length : '-');
        $('#stat-qna').text(Array.isArray(results[3]) ? results[3].length : '-');
        $('#stat-files').text(Array.isArray(results[4]) ? results[4].length : '-');
        $('#stat-companies').text(Array.isArray(results[5]) ? results[5].length : '-');

    } catch (e) {
        console.error("Stats Fetch Error:", e);
    }
}

// [Common Grid Renderer]
async function renderGrid($container, tableName, title) {
    $container.html(`
        <div class="data-grid-container">
            <div class="grid-header">
                <div style="font-weight: 600;">${title} List</div>
                <div class="actions-toolbar">
                    <button class="btn-sm btn-outline" id="refresh-btn">새로고침</button>
                    <button class="btn-sm btn-outline" style="color:red;" id="delete-btn">삭제 (Delete)</button>
                </div>
            </div>
            <div id="grid-wrapper" class="ag-theme-alpine"></div>
        </div>
    `);

    // Fetch Data
    // Fetch Data
    let rowData = [];
    try {
        if (tableName === 'reports') {
            // Special handling for JSON file
            const response = await fetch('../../data/reports.json');
            rowData = await response.json();
        } else {
            const response = await APIcall({ action: 'read', table: tableName }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
            const data = await response.json();
            rowData = Array.isArray(data) ? data : [];
        }
    } catch (e) {
        console.error(`Fetch ${tableName} error:`, e);
        alert('데이터 로드 실패');
    }

    // Define Columns based on table
    let columnDefs = getColumnDefs(tableName);

    // Initialize AG Grid
    const gridDiv = document.querySelector('#grid-wrapper');
    const gridOptions = {
        theme: "legacy",
        rowData: rowData,
        columnDefs: columnDefs,
        defaultColDef: {
            sortable: true,
            filter: true,
            resizable: true,
            flex: 1
        },
        rowSelection: 'multiple',
        pagination: true,
        paginationPageSize: 20
    };

    agGrid.createGrid(gridDiv, gridOptions);

    // Bind Events
    $('#refresh-btn').click(() => loadPage(tableName)); // Simple reload
    $('#delete-btn').click(() => deleteSelectedRows(gridOptions, tableName));
}

function getColumnDefs(tableName) {
    const common = [{ field: 'id', hide: true }, { field: 'created_at', headerName: 'Date', width: 150 }];

    switch (tableName) {
        case 'users':
            return [
                { field: 'email', headerName: 'Email', checkboxSelection: true, headerCheckboxSelection: true },
                { field: 'name', headerName: 'Name' },
                { field: 'company', headerName: 'Company' },
                { field: 'role', headerName: 'Role', editable: true } // Editable role?
            ].concat(common);

        case 'qna':
            return [
                { field: 'subject', headerName: 'Subject', checkboxSelection: true, headerCheckboxSelection: true, width: 300 },
                { field: 'inquiry_type', headerName: 'Type' },
                { field: 'name', headerName: 'Inquirer' },
                { field: 'email', headerName: 'Email' },
                { field: 'content', headerName: 'Content', hide: true }
            ].concat(common);

        case 'sellers':
            return [
                { field: 'companyName', headerName: 'Company', checkboxSelection: true, headerCheckboxSelection: true },
                { field: 'industry', headerName: 'Industry' },
                { field: 'sale_price', headerName: 'Price' },
                { field: 'summary', headerName: 'Summary', width: 400 }
            ].concat(common);

        case 'buyers':
            return [
                { field: 'buyerName', headerName: 'Buyer', checkboxSelection: true, headerCheckboxSelection: true },
                { field: 'interest_industry', headerName: 'Interest' },
                { field: 'investment_amount', headerName: 'Budget' }
            ].concat(common);

        case 'files':
            return [
                { field: 'file_name', headerName: 'File Name', checkboxSelection: true, headerCheckboxSelection: true },
                { field: 'summary', headerName: 'Summary' },
                { field: 'location', headerName: 'Path' }
            ].concat(common);

        case 'companies':
            return [
                { field: 'companyName', headerName: 'Name', checkboxSelection: true, headerCheckboxSelection: true },
                { field: 'industry', headerName: 'Industry' },
                { field: 'summary', headerName: 'Summary' }
            ].concat(common);

        case 'reports':
            return [
                { field: 'id', headerName: 'ID', checkboxSelection: true, headerCheckboxSelection: true, width: 100 },
                { field: 'title', headerName: 'Title', width: 150 },
                { field: 'description', headerName: 'Description', flex: 2 },
                { field: 'category', headerName: 'Category', width: 100 },
                { field: 'instruction', headerName: 'Instruction', hide: true }
            ];

        default:
            return common;
    }
}

async function deleteSelectedRows(gridOptions, tableName) {
    const selectedNodes = gridOptions.api.getSelectedNodes();
    if (selectedNodes.length === 0) {
        alert('행을 선택해주세요.');
        return;
    }

    if (!confirm(`선택한 ${selectedNodes.length}건을 정말 삭제하시겠습니까?`)) return;

    // Delete one by one for now (or batch if API supports)
    // Assuming backend supports delete by ID

    let successCount = 0;
    for (const node of selectedNodes) {
        try {
            // NOTE: 'delete' action needs to be supported by Edge Function
            // Or use direct supabase client if available, but here we stick to APIcall

            /* 
               [Limitation] The current APIcall/Edge function might not support 'delete' action.
               If it does, the payload would be: { action: 'delete', table: table, id: node.data.id }
            */

            // Mocking delete for implementation plan demonstration unless backend is updated
            console.log(`Deleting ${tableName} ID: ${node.data.id}`);

            // TODO: Update upload-handler to support 'delete' action
            // For now, let's try to call it.
            await APIcall({
                action: 'delete',
                table: tableName,
                id: node.data.id
            }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });

            successCount++;
        } catch (e) {
            console.error('Delete failed:', e);
        }
    }

    alert(`${successCount}건 삭제 처리 완료 (서버 지원 여부 확인 필요)`);
    loadPage(tableName);
}


// [Init]
$(document).ready(async function () {
    if (await checkAuth()) {
        loadPage('dashboard');
    }
});
