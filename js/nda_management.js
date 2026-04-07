import { hideLoader } from './auth_utils.js';

let supabase;

$(document).ready(async function () {
    if (typeof showLoader === 'function') showLoader();
    
    try {
        // Initialize Supabase from global if available (set by header_loader.js)
        // or wait for it if it's still loading
        let retryCount = 0;
        while (!window.supabaseClient && retryCount < 10) {
            await new Promise(resolve => setTimeout(resolve, 200));
            retryCount++;
        }
        
        supabase = window.supabaseClient;
        
        if (!supabase) {
            console.error("Supabase client not initialized.");
            alert("시스템 초기화 중 오류가 발생했습니다.");
            return;
        }

        // Check authentication
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            alert("로그인이 필요합니다.");
            location.href = "./signin.html";
            return;
        }

        // Load data
        await loadNdaLogs();

        // Event listeners
        $('#nda-search-input').on('input', function() {
            const searchTerm = $(this).val().toLowerCase();
            filterTable(searchTerm);
        });

    } catch (error) {
        console.error("Initialization error:", error);
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
});

let allLogs = [];

async function loadNdaLogs() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // 1. Fetch NDA logs
        const { data: logs, error: logsError } = await supabase
            .from('nda_logs')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        // 2. Fetch all buyers and sellers to resolve names
        const [{ data: buyers }, { data: sellers }] = await Promise.all([
            supabase.from('buyers').select('*'),
            supabase.from('sellers').select('*')
        ]);

        const getCompanyName = (item) => item.company_name || item.companyName || item.name || item.Name || '정보 없음';

        const buyerMap = new Map(buyers?.map(b => [b.id, getCompanyName(b)]) || []);
        const sellerMap = new Map(sellers?.map(s => [s.id, getCompanyName(s)]) || []);

        // 3. Process logs
        allLogs = logs.map(log => {
            let itemName = '-';
            const targetId = log.item_id || log.seller_id;
            
            if (log.item_type === 'buyer') {
                itemName = buyerMap.get(targetId) || buyerMap.get(String(targetId)) || '삭제된 항목';
            } else if (log.item_type === 'seller' || !log.item_type || log.seller_id) {
                // If explicitly seller, or no type, or has seller_id, treat as seller
                itemName = sellerMap.get(targetId) || sellerMap.get(String(targetId)) || '삭제된 항목';
            }
            
            return {
                ...log,
                itemName,
                displayType: (log.item_type === 'buyer') ? '바이어' : '매도희망'
            };
        });

        renderLogs(allLogs);

    } catch (error) {
        console.error("Load logs error:", error);
        $('#nda-logs-container').html('<tr><td colspan="6" class="text-center text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>');
    }
}

function renderLogs(logs) {
    const $container = $('#nda-logs-container');
    $container.empty();

    if (logs.length === 0) {
        $container.html('<tr><td colspan="6" class="text-center py-5 text-muted">체결 내역이 없습니다.</td></tr>');
        return;
    }

    logs.forEach((log, index) => {
        const date = new Date(log.created_at);
        const formattedDate = date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const typeClass = log.item_type === 'buyer' ? 'type-buyer' : 'type-seller';
        
        const targetId = log.item_id || log.seller_id;
        const itemLink = log.item_type === 'buyer' 
            ? `./dealbook_buyers.html?id=${targetId}&from=total_buyers` 
            : `./dealbook_sellers.html?id=${targetId}&from=totalseller`;

        const $row = $(`
            <tr class="table-row-clickable" style="cursor: pointer;" onclick="window.location.href='${itemLink}'">
                <td class="text-center text-muted">${index + 1}</td>
                <td class="signer-name text-center">${log.signature || '비공개'}</td>
                <td class="item-name">
                    <span class="item-name-text" style="font-weight: 700; color: #1e293b;">
                        ${log.itemName}
                    </span>
                </td>
                <td class="text-center">
                    <span class="type-badge ${typeClass}">${log.displayType}</span>
                </td>
                <td class="signed-date text-center">${formattedDate}</td>
                <td class="text-center" onclick="event.stopPropagation();">
                    <button class="btn-download btn-download-pdf" data-id="${log.id}">
                        <span class="material-symbols-outlined">download</span>
                        PDF
                    </button>
                </td>
            </tr>
        `);

        $row.find('.btn-download-pdf').on('click', function() {
            downloadPdf(log);
        });

        $container.append($row);
    });
}

function filterTable(term) {
    const filtered = allLogs.filter(log => 
        (log.signature && log.signature.toLowerCase().includes(term)) ||
        (log.itemName && log.itemName.toLowerCase().includes(term))
    );
    renderLogs(filtered);
}

async function downloadPdf(log) {
    const $template = $('#nda-pdf-template');
    
    // Fill template
    $template.find('#pdf-item-name').text(log.itemName);
    $template.find('#pdf-item-type').text(log.displayType);
    $template.find('#pdf-signer-name').text(log.signature || '비공개');
    
    const date = new Date(log.created_at);
    const dateStr = `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')}.`;
    $template.find('#pdf-signed-date').text(dateStr);
    $template.find('#pdf-signature-display').text(log.signature || '');

    // Options for html2pdf
    const filename = `NDA_${log.itemName.replace(/\s+/g, '_')}_${log.signature || 'Signed'}.pdf`;
    const opt = {
        margin: [10, 10, 10, 10], // Increased margin to ensure content stays on one page
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Show template briefly for capture, though html2pdf can handle hidden elements if specified correctly
    // But it's safer to ensure it's "renderable"
    const element = $template.get(0);
    element.style.display = 'block';
    
    try {
        await html2pdf().set(opt).from(element).save();
    } catch (e) {
        console.error("PDF generation failed:", e);
        alert("PDF 생성 중 오류가 발생했습니다.");
    } finally {
        element.style.display = 'none';
    }
}
