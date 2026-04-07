import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';

// window.config ?덉쟾 李몄“瑜??꾪븳 ?ы띁
const getConfig = () => window.config || { supabase: { uploadHandlerUrl: '' }, ai: { model: 'gpt-4o', tokenLimits: {} } };

$(document).ready(function () {
    // ==========================================
    // ?몄쬆 & 珥덇린??    // ==========================================
    const userData = checkAuth();
    if (!userData) {
        console.warn('Authentication failed or user data missing.');
        return;
    }
    const user_id = userData.id;

    updateHeaderProfile(userData);
    initUserMenu();

    const urlParams = new URLSearchParams(window.location.search);
    const buyerId = urlParams.get('id');   // 'new' ?먮뒗 ?ㅼ젣 ID
    const isNew = buyerId === 'new';

    let availableFiles = [];
    let conversationHistory = [];
    let currentSourceType = 'training';

    // ?ㅻ줈媛湲?留곹겕 ?숈쟻 泥섎━
    const fromParam = urlParams.get('from');
    if (fromParam === 'totalbuyer') {
        console.log('?뱷 Entry from totalbuyer detected. Applying immediate report UI.');
        
        // [利됱떆 ?ㅽ뻾] ?먮뵒??UI ?④린湲?(?곗씠??濡쒕뱶 ??源쒕묀??諛⑹?)
        $('body').append('<div id="report-initial-loader" style="position:fixed;top:0;left:0;width:100%;height:100%;background:#f8fafc;z-index:9999;display:flex;justify-content:center;align-items:center;flex-direction:column;gap:15px;"><div class="loader-logo" style="color:#0d9488;font-size:24px;font-weight:800;letter-spacing:-1px;">DealChat</div><div style="color:#64748b;font-size:14px;">由ы룷?몃? 以鍮꾪븯怨??덉뒿?덈떎...</div></div>');
        
        // ?좎엯 寃쎈줈???곕Ⅸ ?ㅻ줈媛湲?踰꾪듉 留곹겕 ?섏젙
        $('.sidebar .panel-header button').filter(function() {
            return $(this).attr('onclick') && $(this).attr('onclick').includes('buyers.html');
        }).attr('onclick', "location.href='./totalbuyers.html'");

        // 珥덇린 ?ㅽ???二쇱엯
        applyBuyerReadOnlyMode();
    }

    // ?묒꽦???뺣낫 ?쒖떆
    $('#memo-author-name').text(userData.name || '');
    // userData.affiliation ?먮뒗 userData.company ?꾨뱶瑜??뺤씤?⑸땲??
    $('#memo-author-affiliation').text(userData.affiliation || userData.company || userData.department || '');
    $('#memo-author-avatar').attr('src',
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name || 'user')}`);

    if (!isNew) {
        $('#btn-delete-buyer').show();
    } else {
        $('#btn-delete-buyer').hide();
    }

    if (!buyerId) {
        alert('諛붿씠??ID媛 ?놁뒿?덈떎.');
        location.href = './buyers.html';
        return;
    }

    // ==========================================
    // ?곗씠??濡쒕뱶
    // ==========================================
    function loadBuyerData() {
        if (isNew) {
            setChip('?湲?);
            hideLoader();
            return;
        }

        // [Fix] totalbuyer ?깆뿉???묎렐 ????몄쓽 ?뺣낫瑜?蹂????덈룄濡?user_id瑜?鍮덇컪?쇰줈 蹂대궪 ???덇쾶 ?섏젙
        const getPayload = { action: 'get', table: 'buyers', id: buyerId };
        if (fromParam !== 'totalbuyer') {
            getPayload.user_id = user_id;
        } else {
            getPayload.user_id = ""; // ?꾩껜 議고쉶 ?덉슜
        }

        const endpoint = getConfig().supabase.uploadHandlerUrl;
        APIcall(getPayload, endpoint, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(data => {
                const buyer = Array.isArray(data) ? data[0] : data;
                if (!buyer || buyer.error) {
                    alert('諛붿씠???뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??');
                    location.href = './buyers.html';
                    return;
                }

                // ??梨꾩슦湲?                const companyName = buyer.company_name || buyer.companyName || '';
                $('#buyer-name-editor').text(companyName);
                document.title = `${companyName || '諛붿씠??} - 諛붿씠???뺣낫`;
                $('#sidebar-header-title').text(companyName || '諛붿씠???뺣낫');
                $('#buyer-industry').val(buyer.industry || buyer.interest_industry || '?좏깮?댁＜?몄슂');
                $('#buyer-investment').val(buyer.investment_amount || '');
                $('#buyer-summary').val(buyer.summary || '');
                $('#buyer-interest-summary').val(buyer.interest_summary || '');
                $('#buyer-memo').val(buyer.manager_memo || '');
                $('#buyer-manager-affiliation').val(buyer.manager_affiliation || '');
                $('#buyer-manager-name').val(buyer.manager_name || '');

                // ?좎쭨 諛??묒꽦???뺣낫 諛붿씤??                const authorId = buyer.user_id || buyer.user_id;
                if (authorId) {
                    APIcall({
                        action: 'get',
                        table: 'users',
                        id: authorId
                    }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
                        .then(res => res.json())
                        .then(authorData => {
                            const author = Array.isArray(authorData) ? authorData[0] : (authorData.Item || authorData);
                            if (author && author.name) {
                                $('#memo-author-name').text(author.name);
                                $('#memo-author-affiliation').text(author.company || author.department || "DealChat");
                                $('#memo-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(author.name)}`);
                            }
                        })
                        .catch(err => console.error('Failed to fetch author info:', err));
                }

                if (buyer.updated_at) {
                    const date = new Date(buyer.updated_at);
                    const formattedDate = date.toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    $('#memo-update-date').text(`理쒖쥌 ?섏젙: ${formattedDate}`);
                }


                // 吏꾪뻾 ?꾪솴 chip
                setChip(buyer.status || '?湲?);

                // textarea ?믪씠 ?ъ“??- 珥덇린 ?뚮뜑留???                setTimeout(autoResizeAll, 100);

                // ?뚯씪 紐⑸줉 濡쒕뱶
                loadAvailableFiles();
                loadReportTypes();

                // ????덉뒪?좊━ 蹂듭썝
                if (buyer.history && Array.isArray(buyer.history)) {
                    conversationHistory = buyer.history;
                    conversationHistory.forEach(msg => {
                        addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                    });
                    const $chatMessages = $('#chat-messages');
                    $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                }

                // [異붽?] ?쎄린 紐⑤뱶 沅뚰븳 泥댄겕
                if (fromParam === 'totalbuyer') {
                    const validStatuses = ['?湲?, '吏꾪뻾以?, '?꾨즺'];
                    const currentStatus = validStatuses.includes(buyer.status) ? buyer.status : '?湲?;
                    const isOwner = (userData && userData.id === (buyer.user_id || buyer.user_id));

                    if (!isOwner && (currentStatus === '吏꾪뻾以? || currentStatus === '?꾨즺')) {
                        const msg = (currentStatus === '吏꾪뻾以?) ? '?꾩옱 嫄곕옒媛 吏꾪뻾 以묒엯?덈떎.' : '嫄곕옒媛 ?꾨즺?섏뿀?듬땲??';
                        alert(msg);
                        $('body').css('overflow', 'hidden').empty().append(`
                            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#f8fafc; color:#64748b; font-family: 'Pretendard Variable', Pretendard, sans-serif; gap:20px; text-align:center; padding: 20px;">
                                <span class="material-symbols-outlined" style="font-size: 80px; color:#cbd5e1; margin-bottom: 10px;">lock_person</span>
                                <div style="font-size:28px; font-weight:800; color:#1e293b; letter-spacing: -0.5px;">${msg}</div>
                                <p style="font-size:16px; line-height: 1.6; color: #64748b; max-width: 400px;">
                                    ?대떦 諛붿씠?대뒗 ?꾩옱 嫄곕옒 ?곹깭 蹂댄샇瑜??꾪빐<br>?곸꽭 由ы룷??議고쉶媛 ?쇱떆?곸쑝濡??쒗븳?섏뿀?듬땲??
                                </p>
                                <button onclick="location.href='./totalbuyers.html'" 
                                    style="margin-top: 10px; padding:14px 40px; background:#0d9488; color:white; border:none; border-radius:50px; font-weight:700; font-size: 15px; cursor:pointer; box-shadow: 0 10px 20px rgba(13, 148, 136, 0.2); transition: all 0.2s;">
                                    諛붿씠??紐⑸줉?쇰줈 ?뚯븘媛湲?                                </button>
                            </div>
                        `);
                        return;
                    }
                }

                // [異붽?] ?쎄린 紐⑤뱶 UI ?곸슜 ?꾨즺
                if (fromParam === 'totalbuyer') {
                    applyBuyerReadOnlyMode();
                    $('#report-initial-loader').fadeOut(300, function() { $(this).remove(); });
                }
            })
            .catch(err => {
                console.error('Load error:', err);
                alert('?곗씠??濡쒕뱶 ?ㅽ뙣');
                location.href = './buyers.html';
            })
            .finally(() => hideLoader());
    }

    // 珥덇린 ?곗씠??濡쒕뱶 ?몄텧
    loadBuyerData();

    // ==========================================
    // 吏꾪뻾 ?꾪솴 Chip
    // ==========================================
    function setChip(value) {
        $('.btn-status-chip').removeClass('active').css({
            background: '#fff', color: '#64748b', borderColor: '#e2e8f0'
        });
        $(`.btn-status-chip[data-value="${value}"]`).addClass('active').css({
            background: '#0d9488', color: '#fff', borderColor: '#0d9488',
            boxShadow: '0 4px 10px rgba(13,148,136,0.2)'
        });
        $('#buyer-status').val(value);
    }

    $(document).on('click', '.btn-status-chip', function () {
        setChip($(this).data('value'));
    });

    // ==========================================
    // Textarea ?먮룞 ?믪씠
    // ==========================================
    function autoResizeTextarea($el) {
        if (!$el || !$el[0]) return;
        $el.css('height', 'auto');
        $el.css('height', $el[0].scrollHeight + 'px');
    }
    function autoResizeAll() {
        autoResizeTextarea($('#buyer-summary'));
        autoResizeTextarea($('#buyer-interest-summary'));
        autoResizeTextarea($('#buyer-memo'));
    }

    $('#buyer-summary, #buyer-interest-summary, #buyer-memo').on('input', function () {
        autoResizeTextarea($(this));
    });

    // 諛붿씠?대챸 蹂寃????쒕ぉ ?낅뜲?댄듃
    $('#buyer-name-editor').on('input', function() {
        const name = $(this).text().trim() || '諛붿씠??;
        document.title = `${name} - 諛붿씠???뺣낫`;
        $('#sidebar-header-title').text(name || '諛붿씠???뺣낫');
    });

    // ==========================================
    // ???/ ??젣
    // ==========================================
    function saveBuyer(isDraft, $btn) {
        const name = $('#buyer-name-editor').text().trim();
        const industry = $('#buyer-industry').val();
        const investment = $('#buyer-investment').val().trim();
        const status = $('#buyer-status').val();
        const summary = $('#buyer-summary').val().trim();
        const interest_summary = $('#buyer-interest-summary').val().trim();
        const memo = $('#buyer-memo').val().trim();
        
        // 異붽? ?꾨뱶
        const manager_affiliation = $('#buyer-manager-affiliation').val().trim();
        const manager_name = $('#buyer-manager-name').val().trim();

        if (!name || industry === '?좏깮?댁＜?몄슂' || !summary) {
            alert('諛붿씠?대챸, ?곗뾽, ?뚯궗 ?뚭컻???꾩닔 ??ぉ?낅땲??');
            return;
        }

        const payload = {
            type: 'buyer',
            company_name: name,
            industry,
            investment_amount: investment,
            status: status,
            summary,
            interest_summary,
            manager_memo: memo,
            manager_affiliation,
            manager_name,
            share_type: isDraft ? 'private' : 'public',
            user_id: user_id,
            history: conversationHistory,
            updated_at: new Date().toISOString()
        };

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size:16px;">sync</span> ???以?..');

        if (isNew) {
            payload.action = 'create';
            payload.table = 'buyers';
            payload.created_at = new Date().toISOString();
        } else {
            payload.action = 'update';
            payload.table = 'buyers';
            payload.id = buyerId;
        }

        APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(async r => {
                let result = {};
                if (r.status !== 204) {
                    const data = await r.json();
                    result = Array.isArray(data) ? data[0] : data;
                }
                
                if (result && result.error) {
                    throw new Error(result.error);
                }

                if (isNew && result && result.id) {
                    alert('??λ릺?덉뒿?덈떎.');
                    location.href = `./buyer_editor.html?id=${result.id}`;
                } else {
                    alert('??λ릺?덉뒿?덈떎.');
                    if (payload.updated_at) {
                        const d = new Date(payload.updated_at);
                        const formattedDate = d.toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        $('#memo-update-date').text(`理쒖쥌 ?섏젙: ${formattedDate}`);
                    }
                }
            })
            .catch(err => { 
                console.error(err); 
                alert('????ㅽ뙣: ' + (err.message || '?????녿뒗 ?쒕쾭 ?ㅻ쪟')); 
            })
            .finally(() => { $btn.prop('disabled', false).html(origHtml); });
    }

    $('#btn-save-buyer').on('click', function () { saveBuyer(false, $(this)); });
    $('#btn-draft-buyer').on('click', function () { saveBuyer(true, $(this)); });

    $('#btn-delete-buyer').on('click', function () {
        if (!confirm('?뺣쭚濡???諛붿씠???뺣낫瑜???젣?섏떆寃좎뒿?덇퉴?')) return;
        APIcall({ action: 'delete', table: 'buyers', id: buyerId }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(result => {
                if (result.error) alert('??젣 ?ㅻ쪟: ' + result.error);
                else { alert('??젣?섏뿀?듬땲??'); location.href = './buyers.html'; }
            })
            .catch(() => alert('??젣 ?붿껌 ?ㅽ뙣'));
    });

    // ==========================================
    // 蹂닿퀬???앹꽦 濡쒖쭅
    // ==========================================
    let availableReportTypes = [];

    function loadReportTypes() {
        $.getJSON('../data/reports.json', function (data) {
            availableReportTypes = data;
            renderReportCards();
        }).fail(function () {
            console.error("Failed to load report types.");
        });
    }

    function renderReportCards() {
        const $formatGrid = $('#report-grid-format');
        const $recGrid = $('#report-grid-recommended');
        $formatGrid.empty();
        $recGrid.empty();

        availableReportTypes.forEach(report => {
            const isPrimary = report.isPrimary ? 'primary' : '';
            const cardHtml = `
                <div class="report-card ${isPrimary}" data-id="${report.id}" style="background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s;">
                    <h5 style="margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; display: flex; justify-content: space-between; align-items: center;">${report.title}</h5>
                    <p style="margin: 8px 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">${report.description}</p>
                </div>
            `;
            if (report.type === 'format') $formatGrid.append(cardHtml);
            else $recGrid.append(cardHtml);
        });
    }

    $('#btn-generate-report').on('click', function () { $('#report-selection-modal').css('display', 'flex'); });
    $('#close-report-modal').on('click', function () { $('#report-selection-modal').hide(); });
    $('#close-gen-detail-modal').on('click', function () { $('#report-gen-detail-modal').hide(); });
    $('#back-to-selection').on('click', function () { $('#report-gen-detail-modal').hide(); $('#report-selection-modal').css('display', 'flex'); });

    $(document).on('click', '.report-card', function () {
        const reportId = $(this).data('id');
        const reportData = availableReportTypes.find(r => r.id === reportId);
        if (!reportData) return;
        $('#selected-report-title').text(reportData.title);
        $('#selected-report-desc').text(reportData.description);
        $('#report-instruction').val(reportData.instruction);
        $('#report-selection-modal').hide();
        $('#report-gen-detail-modal').css('display', 'flex');
    });

    $('#start-generate-report').on('click', async function () {
        const instruction = $('#report-instruction').val().trim();
        const language = $('#report-language').val();
        const reportType = $('#selected-report-title').text();
        if (!instruction) { alert('由ы룷??吏?쒖궗??쓣 ?낅젰?댁＜?몄슂.'); return; }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> ?앹꽦 以?..');

        try {
            const prompt = `[Report Type] ${reportType}\n[Language] ${language}\n[Instruction] ${instruction}`;
            let infoCtx = `=== 諛붿씠??湲곕낯 ?뺣낫 ===\n`;
            infoCtx += `諛붿씠?대챸: ${$('#buyer-name-editor').text()}\n`;
            infoCtx += `?곗뾽: ${$('#buyer-industry').val()}\n`;
            infoCtx += `?뚭컻: ${$('#buyer-summary').val()}\n`;
            infoCtx += `?щ쭩?붽굔: ${$('#buyer-interest-summary').val()}\n`;
            infoCtx += `?대떦?? ${$('#buyer-manager-name').val()} (${$('#buyer-manager-affiliation').val()})\n`;

            const historyCtx = conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
            let ragContext = isNew ? "" : await searchVectorDB(`${reportType} 蹂닿퀬??, buyerId);

            const fullContext = infoCtx + "\n[Conversation History]\n" + historyCtx + (ragContext ? "\n=== 愿??臾몄꽌 ?댁슜 ===\n" + ragContext : "");
            const response = await addAiResponse(prompt, fullContext);
            const data = await response.json();
            const generatedContent = data.answer;

            if (generatedContent) {
                const blob = new Blob([generatedContent], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${reportType}.txt`;
                a.click();
                $('#report-gen-detail-modal').hide();
                alert('蹂닿퀬???앹꽦???꾨즺?섏뼱 ?ㅼ슫濡쒕뱶?섏뿀?듬땲??');
            }
        } catch (error) {
            console.error('Report Generation Error:', error);
            alert('蹂닿퀬???앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    loadReportTypes();

    // ==========================================
    // ?뚯씪 ?낅줈??/ 紐⑸줉 (files ?뚯씠釉??ъ슜)
    async function loadAvailableFiles() {
        if (!buyerId) return;
        APIcall({ action: 'get', table: 'files', entity_id: buyerId, entity_type: 'buyer' }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(res => res.json())
            .then(data => {
                availableFiles = Array.isArray(data) ? data : [];
                renderFileList();
            })
            .catch(err => console.error('File load error:', err));
    }

    function renderFileList() {
        const $listTraining = $('#source-list-training');
        const $listNonTraining = $('#source-list-non-training');
        $listTraining.empty();
        $listNonTraining.empty();

        if (availableFiles.length === 0) {
            $listTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">?뚯씪 ?놁쓬</li>');
            $listNonTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">?뚯씪 ?놁쓬</li>');
            return;
        }

        availableFiles.forEach(file => {
            let $list = file.source_type === 'training' ? $listTraining : $listNonTraining;
            $list.append(`
                <li style="display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9;">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: #64748b;">description</span>
                    <span style="flex: 1; font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                          title="${file.file_name}">${file.file_name}</span>
                    <button class="btn-remove-file" data-id="${file.id}"
                        style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
                    </button>
                </li>
            `);
        });
    }

    $('#add-source-training').on('click', () => { currentSourceType = 'training'; $('#file-upload').click(); });
    $('#add-source-non-training').on('click', () => { currentSourceType = 'non-training'; $('#file-upload').click(); });

    $('#file-upload').on('change', async function () {
        const files = this.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (!filetypecheck(file)) {
                alert(`吏?먰븯吏 ?딅뒗 ?뚯씪 ?뺤떇: ${file.name}`);
                continue;
            }
            try {
                const uploadResult = await fileUpload(file, user_id, SUPABASE_ENDPOINT);
                if (uploadResult && uploadResult.key) {
                    await APIcall({
                        action: 'create',
                        table: 'files',
                        entity_id: buyerId,
                        entity_type: 'buyer',
                        storage_path: uploadResult.key, // schema uses storage_path
                        file_name: file.name,
                        file_type: file.type.split('/')[1] || 'bin',
                        user_id: user_id
                    }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' }).then(r => r.json());
                }
            } catch (err) {
                console.error('Upload error:', err);
                alert(`${file.name} ?낅줈???ㅽ뙣`);
            }
        }
        this.value = '';
        loadAvailableFiles();
    });

    $(document).on('click', '.btn-remove-file', function () {
        const fileId = $(this).data('id');
        if (!confirm('?뚯씪????젣?섏떆寃좎뒿?덇퉴?')) return;
        APIcall({ action: 'delete', table: 'files', id: fileId }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(() => loadAvailableFiles());
    });

    // ==========================================
    // AI ?먮룞 ?낅젰 (?먮즺 湲곕컲 異붿텧 濡쒖쭅)
    // ==========================================
    async function autoFillFromFiles($btn) {
        if (isNew || availableFiles.length === 0) {
            alert('癒쇱? ?뚯씪???낅줈?쒗븯怨???ν븳 ???쒕룄??二쇱꽭??');
            return;
        }

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 20px;">sync</span> 異붿텧 以?..');

        try {
            const query = "Extract buyer/investor name, interested industry, investment amount, general company summary, and specific interest requirements.";
            const contextRaw = await searchVectorDB(query, buyerId);

            const prompt = `
                ?낅줈?쒕맂 ?먮즺瑜?遺꾩꽍?섏뿬 諛붿씠???ъ옄????二쇱슂 ?뺣낫瑜?異붿텧?댁＜?몄슂.
                留뚯빟 ?먮즺?먯꽌 ?뺤씤?????녿뒗 ?뺣낫??鍮?臾몄옄??"")濡?泥섎━?섏꽭??
                
                諛섎뱶???꾨옒 JSON ?뺤떇?쇰줈留??묐떟?섏꽭??
                {
                  "companyName": "諛붿씠?대챸/?ъ옄?먮챸",
                  "industry": "愿???곗뾽援?,
                  "investmentAmount": "媛???먭툑 (?レ옄 ?꾩＜)",
                  "summary": "?뚯궗 ?뚭컻 (諛붿씠?댁뿉 ????꾨컲?곸씤 ?뚭컻)",
                  "interestSummary": "留ㅼ묶 ?щ쭩 湲곗뾽/?붽굔 (?몄닔 ?щ쭩 遺꾩빞, 吏?? ?ъ옄 洹쒕え ??"
                }
            `;

            const response = await addAiResponse(prompt, contextRaw);
            const data = await response.json();
            const aiAnswer = data.answer.trim();
            
            let jsonData = null;
            const jsonMatch = aiAnswer.match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonData = JSON.parse(jsonMatch[0]);
            else jsonData = JSON.parse(aiAnswer);

            if (jsonData) {
                if (jsonData.companyName) $('#buyer-name-editor').text(jsonData.companyName);
                if (jsonData.industry) $('#buyer-industry').val(jsonData.industry);
                if (jsonData.investmentAmount) $('#buyer-investment').val(jsonData.investmentAmount);
                if (jsonData.summary) $('#buyer-summary').val(jsonData.summary);
                if (jsonData.interestSummary) $('#buyer-interest-summary').val(jsonData.interestSummary);
                
                autoResizeAll();
                alert('諛붿씠???뺣낫媛 ?먮룞?쇰줈 異붿텧 諛??낅젰?섏뿀?듬땲??');
            }
        } catch (err) {
            console.error('Auto-fill error:', err);
            alert('?뺣낫 異붿텧???ㅽ뙣?덉뒿?덈떎. (臾몄꽌媛 ?몃뜳??以묒씠嫄곕굹 AI ?묐떟 ?ㅻ쪟)');
        } finally {
            $btn.prop('disabled', false).html(origHtml);
        }
    }

    $('#ai-auto-fill-btn').on('click', function() { autoFillFromFiles($(this)); });

    // ==========================================
    // AI 梨꾪똿
    // ==========================================
    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');

    function addMessage(content, sender, animate = true) {
        $welcomeScreen.hide();
        const isUser = sender === 'user';
        const bubbleClass = isUser ? 'user-message' : 'ai-message';
        const msgHtml = `
            <div class="${bubbleClass}" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px; ${isUser ? 'flex-direction:row-reverse;' : ''}">
                <div style="width:32px; height:32px; border-radius:50%; background:${isUser ? '#0d9488' : '#f1f5f9'};
                             display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <span class="material-symbols-outlined" style="font-size:18px; color:${isUser ? '#fff' : '#64748b'};">${isUser ? 'person' : 'smart_toy'}</span>
                </div>
                <div style="max-width:80%; padding:12px 16px; border-radius:12px;
                             background:${isUser ? '#0d9488' : '#f8fafc'};
                             color:${isUser ? '#fff' : '#334155'}; font-size:14px; line-height:1.7;
                             box-shadow: 0 2px 8px rgba(0,0,0,0.06); white-space:pre-wrap;">${content}</div>
            </div>`;
        $chatMessages.append(msgHtml);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });
    }

    async function sendMessage() {
        const msg = $chatInput.val().trim();
        if (!msg) return;
        $chatInput.val('').css('height', '42px');

        addMessage(msg, 'user');
        conversationHistory.push({ role: 'user', content: msg, timestamp: new Date().toISOString() });

        const $aiPlaceholder = $('<div class="ai-message" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px;"><div style="width:32px; height:32px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:18px; color:#64748b;">smart_toy</span></div><div class="ai-typing" style="padding:12px 16px; border-radius:12px; background:#f8fafc; color:#64748b; font-size:14px;">?듬? ?앹꽦 以?..</div></div>');
        $chatMessages.append($aiPlaceholder);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });

        try {
            let ragContext = "";
            if (!isNew) {
                ragContext = await searchVectorDB(msg, buyerId);
            }

            const context = `[諛붿씠??湲곕낯 ?꾨뱶 ?뺣낫]\n諛붿씠?대챸: ${$('#buyer-name-editor').text()}\n?곗뾽: ${$('#buyer-industry').val()}\n媛?⑹옄湲? ${$('#buyer-investment').val()}\n吏꾪뻾?꾪솴: ${$('#buyer-status').val()}\n?곸꽭 ?뚭컻: ${$('#buyer-summary').val()}\n留ㅼ묶 ?щ쭩 湲곗뾽/?붽굔: ${$('#buyer-interest-summary').val()}\n?대떦??硫붾え: ${$('#buyer-memo').val()}\n\n[李멸퀬 臾몄꽌 ?댁슜]\n${ragContext}`;
            
            const response = await addAiResponse(msg, context);
            const data = await response.json();
            const aiReply = data.answer || '?묐떟??諛쏆? 紐삵뻽?듬땲??';
            
            $aiPlaceholder.find('.ai-typing').text(aiReply);
            conversationHistory.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString() });

            if (!isNew) {
                APIcall({ action: 'update', table: 'buyers', id: buyerId, history: conversationHistory, updated_at: new Date().toISOString() },
                    getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' }).catch(() => {});
            }
        } catch (err) {
            console.error('AI error:', err);
            $aiPlaceholder.find('.ai-typing').text('AI ?묐떟???ㅽ뙣?덉뒿?덈떎. ?ㅼ떆 ?쒕룄?댁＜?몄슂.');
        }
    }

    $('#send-btn').on('click', sendMessage);
    $chatInput.on('keypress', e => { if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    
    $('#clear-history-btn').on('click', () => {
        if (!confirm('????댁슜??紐⑤몢 ??젣?섏떆寃좎뒿?덇퉴?')) return;
        conversationHistory = [];
        $chatMessages.empty();
        $welcomeScreen.show();
    });

    $(document).on('click', '.prompt-chip', function () {
        $chatInput.val($(this).text());
        sendMessage();
    });

    // 珥덈컲 ?먮윭 諛⑹?瑜??꾪빐 window.config 泥댄겕
    if (!window.config) {
        window.config = {
            supabase: { uploadHandlerUrl: '', aiHandlerUrl: '' },
            ai: { model: 'gpt-4o', tokenLimits: { 'gpt-4o': { maxContextTokens: 120000, maxOutputTokens: 4096, safetyMargin: 5000 } } }
        };
    }

    // ==========================================
    // ?꾨Ц 由ы룷??紐⑤뱶 (Professional Report Mode)
    // ==========================================
    function applyBuyerReadOnlyMode() {
        console.log('?썳截?Applying Professional Report Mode (Buyer) - Synced with Seller');

        const primaryColor = '#0d9488'; // Buyer Teal Color

        // 1. ?꾩슜 CSS 異붽? (Seller Editor ?ъ뼇 1:1 ?곸슜)
        const reportStyles = `
            :root {
                --report-primary: ${primaryColor};
                --report-bg: #ffffff;
                --report-text: #475569;
                --report-text-dark: #1e293b;
                --report-border: #e2e8f0;
            }

            body {
                background-color: #f8fafc !important;
                overflow-y: auto !important;
                height: auto !important;
            }

            .app-container {
                background-color: #f8fafc !important;
                display: block !important;
                height: auto !important;
                padding: 30px 0 60px 0 !important;
            }

            .sidebar {
                max-width: 900px !important;
                width: 95% !important;
                margin: 0 auto !important;
                background-color: var(--report-bg) !important;
                border: 1px solid var(--report-border) !important;
                box-shadow: 0 10px 40px rgba(13, 148, 136, 0.08) !important;
                height: auto !important;
                overflow: hidden !important;
                display: block !important;
                border-radius: 20px !important;
            }

            .sidebar .panel-header {
                background-color: var(--report-primary) !important;
                color: #ffffff !important;
                border-top-left-radius: 19px !important;
                border-top-right-radius: 19px !important;
                border-bottom: none !important;
                height: 55px !important;
                margin-bottom: 25px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border: none !important;
                padding: 0 !important;
            }

            .sidebar .panel-header h2 {
                color: #ffffff !important;
                font-size: 14px !important;
                font-weight: 600 !important;
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }

            .sidebar .panel-header span:not(#sidebar-header-title) { display: none !important; }
            #sidebar-header-title {
                color: #ffffff !important;
                font-size: 14px !important;
                font-weight: 700 !important;
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }

            .sidebar-nav {
                padding: 0 40px 40px 40px !important;
                overflow-y: visible !important;
                max-height: none !important;
                height: auto !important;
            }

            .sidebar-nav > div {
                margin-bottom: 36px !important;
                margin-top: 0 !important;
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
            }

            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-size: 13px !important;
                margin: 0 0 6px 0 !important;
                font-weight: 700 !important;
                letter-spacing: -0.01em;
            }

            #buyer-name-editor {
                font-size: 15px !important;
                font-weight: 500 !important;
                color: var(--report-text-dark) !important;
                line-height: 1.3 !important;
                border: none !important;
                outline: none !important;
            }
            .sidebar-nav div:has(> #buyer-name-editor) {
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
                height: auto !important;
                min-height: unset !important;
            }

            .report-div {
                font-size: 15px !important;
                line-height: 1.6 !important;
                color: var(--report-text) !important;
                white-space: pre-wrap !important;
                padding: 0 !important;
            }

            input:disabled, select:disabled {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                color: var(--report-text) !important;
                font-weight: 500 !important;
                opacity: 1 !important;
                -webkit-text-fill-color: var(--report-text) !important;
                font-size: 15px !important;
                height: auto !important;
                min-height: 22px !important;
                display: block !important;
                overflow: visible !important;
            }

            select:disabled {
                -webkit-appearance: none !important;
                appearance: none !important;
                background-image: none !important; /* ?붿궡???쒓굅 */
            }
            
            textarea:disabled {
                display: none !important; /* 以묐났 ?몄텧 諛⑹? */
            }

            .btn-status-chip {
                border-radius: 100px !important;
                padding: 6px 16px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                border: 1px solid #e2e8f0 !important;
                background: #ffffff !important;
                color: #94a3b8 !important;
            }

            .btn-status-chip.active {
                background: var(--report-primary) !important;
                color: #ffffff !important;
                border-color: var(--report-primary) !important;
                font-weight: 700 !important;
                box-shadow: none !important;
                cursor: default !important;
            }

            .btn-status-chip:not(.active) {
                display: none !important;
            }

            /* ?대찓???뱀뀡 ?④? (Seller ?ъ뼇) */
            .sidebar-nav div:has(> #buyer-email),
            /* ?섎떦 怨좎젙 踰꾪듉 ?곸뿭 */
            .sidebar > div:last-child {
                display: none !important;
            }

            /* ?곗뾽 吏곸젒 ?낅젰 ?뱀뀡 ?쒖뼱 */
            .sidebar-nav div:has(> #buyer-industry-etc) {
                display: ${$('#buyer-industry').val() === '湲고?' ? 'block' : 'none'} !important;
            }

            /* 遺덊븘?뷀븳 ?붿냼 ?④? 泥섎━ */
            .main-content, .right-panel, 
            #btn-save-buyer, #btn-draft-buyer, #btn-delete-buyer,
            #ai-auto-fill-btn, .btn-remove-file,
            #add-source-training, #add-source-non-training,
            .welcome-screen, .modal-overlay, #file-upload,
            #btn-generate-report,
            .sidebar-nav div[style*="justify-content: flex-end"],
            #memo-update-date + div { /* ?묒꽦??諭껋? ?④? (?섏쨷?????듭씪 ??怨좊젮) */
                display: none !important;
            }

            .author-info-card {
                border: 1px solid var(--report-border) !important;
                background: #f8fafc !important;
                padding: 20px !important;
                border-radius: 12px !important;
            }
            
            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;

        if (!$('#report-mode-css').length) {
            $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        }

        // 2. ?낅젰 鍮꾪솢?깊솕 諛??쒕ぉ ?낅뜲?댄듃
        $('#buyer-name-editor').attr('contenteditable', 'false');
        $('input, select, textarea').prop('disabled', true);
        $('#sidebar-header-title').text('諛붿씠??由ы룷??);
        if (!$('#sidebar-header-title .material-symbols-outlined').length) {
            $('#sidebar-header-title').prepend('<span class="material-symbols-outlined" style="font-size: 20px; color: #fff; margin-right: 8px;">assignment_ind</span>');
        }

        // 3. ?띿뒪???곸뿭 div 援먯껜
        ['#buyer-summary', '#buyer-interest-summary', '#buyer-memo'].forEach(sel => {
            const $ta = $(sel);
            if ($ta.length && !$ta.next('.report-div').length) {
                const content = $ta.val() || '';
                $ta.after(`<div class="report-div" style="white-space:pre-wrap; font-size:15px; color:#475569; line-height:1.6; padding:0;">${content}</div>`).hide();
            }
        });

        // 4. ?뚰꽣留덊겕 異붽?
        if (!$('#report-watermark').length) {
            $('<div id="report-watermark">DealChat</div>').css({
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)',
                fontSize: '100px', fontWeight: '900', color: primaryColor, opacity: '0.04',
                pointerEvents: 'none', zIndex: '9999', letterSpacing: '10px'
            }).appendTo('body');
        }

        // 5. ?쒕ぉ ?띿뒪???낅뜲?댄듃
        document.title = ($('#buyer-name-editor').text() || '諛붿씠??) + ' 由ы룷??- DealChat';
    }

});
