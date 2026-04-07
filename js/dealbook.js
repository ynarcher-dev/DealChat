import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, extractTextFromPDF, extractTextFromDocx, extractTextFromPptx, extractTextFromTxt, validateText, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';
const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;
const SUPABASE_STORAGE_URL = `${window.config.supabase.url}/storage/v1/object/public/uploads/`;

$(document).ready(function () {
    let currentCompanyData = null;
    let availableFiles = [];
    let searchResults = [];
    let currentSourceType = 'training'; // 'training', 'non-training', 'finance'

    // [Mod] ?몄쬆 泥댄겕 濡쒖쭅 ?섏젙: 怨듭쑀??URL(id ?뚮씪誘명꽣) ?묎렐 ??濡쒓렇???놁씠??議고쉶 ?덉슜
    const localStorageData = localStorage.getItem('dealchat_users');
    let userData = null;
    try {
        userData = localStorageData ? JSON.parse(localStorageData) : null;
    } catch (e) {
        console.error('Auth parsing error', e);
    }

    const isLoggedIn = userData && userData.isLoggedIn;
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    const fromSource = urlParams.get('from');

    // [Mod] STARTUP?먯꽌 吏꾩엯??寃쎌슦 ?ㅻ줈媛湲?踰꾪듉 ?숈옉 ?섏젙
    if (fromSource === 'totalstartup') {
        $('button[onclick*="companies.html"]').attr('onclick', "location.href='./totalstartup.html'");
    } else if (fromSource === 'totalseller') {
        $('button[onclick*="companies.html"]').attr('onclick', "location.href='./totalsellers.html'");
    }

    // 濡쒓렇???뺣낫媛 ?녾퀬 怨듭쑀 ID???녿떎硫?濡쒓렇???섏씠吏濡?由щ떎?대젆??
    if (!isLoggedIn && !companyId) {
        checkAuth();
        return;
    }

    const user_id = isLoggedIn ? userData.id : null;
    let availableReportTypes = []; // Report Types loaded from JSON
    let isNew = companyId === 'new';

    // ?깅줉???쒕턿??3媛?踰꾪듉 ?좎? (??젣?섍린, 鍮꾧났媛? ??ν븯湲?
    if (!isNew) {
        $('#btn-save').html('<span class="material-symbols-outlined" style="font-size: 16px;">save</span> ??ν븯湲?);
    }

    if (!companyId) {
        alert('?뚯궗 ID媛 ?놁뒿?덈떎.');
        location.href = './index.html';
        return;
    }

    // [Mod] STARTUP 吏꾩엯 ?먮뒗 鍮꾪쉶?먯쓽 寃쎌슦 ?붿긽 諛⑹?瑜??꾪빐 ?몄쭛 UI 利됱떆 ?④? 諛??쎄린 ?꾩슜 紐⑤뱶 議곌린 ?곸슜
    if (!isLoggedIn || fromSource === 'totalstartup' || fromSource === 'totalseller') {
        // applyReadOnlyMode()媛 ?꾨옒???뺤쓽?섏뼱 ?덉?留??몄씠?ㅽ똿?섎?濡??몄텧 媛??
        if (typeof applyReadOnlyMode === 'function') {
            applyReadOnlyMode();
        } else {
            $('.main-content, #guide-panel, .right-panel').hide();
        }
    }

    if (isLoggedIn) {
        updateHeaderProfile(userData);
        initUserMenu();
    } else {
        // 鍮꾪쉶???묎렐 ???ㅻ뜑 諛?硫붾돱 泥섎━
        $('#user-menu-trigger').hide();
        $('.user-profile-info').hide(); 
    }



    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    const $guidePanel = $('#guide-panel');
    const $summaryText = $('#summary');
    const $managerMemo = $('#manager-memo');
    const $financialAnalysis = $('#financial-analysis');
    const $industryText = $('#industry');
    const $notebookTitleText = $('.notebook-title');

    // Helper function: JSON 吏곷젹????臾몄젣媛 ?섎뒗 臾몄옄 ?쒓굅
    function sanitizeTextForJSON(text) {
        if (!text) return "";

        return text
            // ?쒖뼱 臾몄옄 ?쒓굅 (?? 以꾨컮轅? 罹먮━吏 由ы꽩 ?쒖쇅)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // ?섎せ???좊땲肄붾뱶 ?댁뒪耳?댄봽 ?쒗???쒓굅
            .replace(/\\u(?![0-9a-fA-F]{4})/g, '')
            // NULL 臾몄옄 ?쒓굅
            .replace(/\0/g, '')
            // 湲고? 臾몄젣媛 ?????덈뒗 ?뱀닔 臾몄옄 ?뺢퇋??
            .replace(/[\uFFFD\uFFFE\uFFFF]/g, '') // Replacement character ?쒓굅
            .trim();
    }

    // Conversation History Management
    const MAX_HISTORY_LENGTH = 20; // Maximum messages to keep (10 exchanges)
    let conversationHistory = []; // Array of {role: 'user' | 'assistant', content: string, timestamp: string}

    // Add message to conversation history
    function addToHistory(role, content) {
        conversationHistory.push({
            role: role,
            content: content,
            timestamp: new Date().toISOString()
        });

        // Keep only recent messages (circular buffer)
        if (conversationHistory.length > MAX_HISTORY_LENGTH) {
            conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
        }

        // Save to Server (DB)
        if (currentCompanyData && user_id) {
            // 濡쒖뺄 ?곗씠???숆린??
            currentCompanyData.history = conversationHistory;

            const updatePayload = {
                id: companyId,
                table: fromSource === 'totalseller' ? 'sellers' : 'companies',
                action: 'update',
                user_id: user_id,
                history: conversationHistory,
                updated_at: new Date().toISOString()
            };

            // 諛깃렇?쇱슫?????
            APIcall(updatePayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .then(res => res.json())
                .catch(err => console.error('Failed to save history to DB:', err));
        }

        console.log(`?뱶 History updated: ${conversationHistory.length} messages stored`);
    }

    // Load conversation history from localStorage
    function loadHistory() {
        try {
            const savedHistory = localStorage.getItem(`history_${companyId}`);
            if (savedHistory) {
                conversationHistory = JSON.parse(savedHistory);
                console.log(`?뱶 History loaded: ${conversationHistory.length} messages`);

                // UI??蹂듭썝
                conversationHistory.forEach(msg => {
                    // role??'user'/'assistant'?먯꽌 'user'/'ai'濡?蹂??(addMessage??'ai' ?ъ슜)
                    const sender = msg.role === 'assistant' ? 'ai' : msg.role;
                    addMessage(msg.content, sender, false); // false: ?좊땲硫붿씠???놁씠 利됱떆 ?쒖떆
                });

                // ?ㅽ겕濡ㅼ쓣 留??꾨옒濡??대룞
                $chatMessages.scrollTop($chatMessages[0].scrollHeight);
            }
        } catch (e) {
            console.error('Failed to load history:', e);
        }
    }

    // Format history for LLM prompt
    function formatHistoryForPrompt(history) {
        if (!history || history.length === 0) return "";

        let formatted = "[Conversation History]\n";
        history.forEach(msg => {
            const label = msg.role === 'user' ? 'User' : 'Assistant';
            formatted += `${label}: ${msg.content}\n\n`;
        });
        return formatted + "\n";
    }


    // 0. 媛???뚯씪 紐⑸줉(files) 遺덈윭?ㅺ린 - (以묐났 ?뺤쓽 ?쒓굅??

    const $investmentRows = $('#investment-rows');
    const $financialRows = $('#financial-rows');

    // Helper to format numbers with commas (supports negative numbers)
    function formatNumberWithCommas(val) {
        if (val === undefined || val === null || val === '') return '';
        let str = val.toString();
        const isNegative = str.startsWith('-');
        const num = str.replace(/[^0-9]/g, '');
        if (!num) return isNegative ? '-' : '';
        const formatted = Number(num).toLocaleString('ko-KR');
        return isNegative ? '-' + formatted : formatted;
    }

    function createInputRow(type, values = {}) {
        const row = document.createElement('div');
        row.style.cssText = "display: flex; gap: 8px; margin-bottom: 4px; align-items: center;";

        if (type === 'investment') {
            const vYear = values.year || '';
            const vStage = values.stage || '';
            const vValuation = formatNumberWithCommas(values.valuation || '');
            const vAmount = formatNumberWithCommas(values.amount || '');
            const vInvestor = values.investor || '';

            const stages = ['Seed', 'Pre-A', 'series-A', 'series-B', 'series-C', 'series-D', 'Pre-IPO', 'IPO', 'M&A'];
            let stageOptions = `<option value="">?④퀎</option>`;
            stages.forEach(s => {
                stageOptions += `<option value="${s}" ${vStage === s ? 'selected' : ''}>${s}</option>`;
            });

            row.innerHTML = `
                <input type="text" class="inv-year" placeholder="?꾨룄" value="${vYear}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <select class="inv-stage" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: left; background: #fff;">
                    ${stageOptions}
                </select>
                <input type="text" class="inv-valuation numeric-input" placeholder="踰⑤쪟" value="${vValuation}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="inv-amount numeric-input" placeholder="湲덉븸" value="${vAmount}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="inv-investor" placeholder="?ъ옄?? value="${vInvestor}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; text-align: left;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; font-size: 14px; cursor: pointer; color: #ef4444;"><span class="material-symbols-outlined" style="font-size: 16px;">remove</span></button>
            `;
        } else if (type === 'financial') {
            const vYear = values.year || '';
            const vRev = formatNumberWithCommas(values.revenue || '');
            const vOpd = formatNumberWithCommas(values.operating_profit || values.profit || ''); // profit for sellers
            const vNet = formatNumberWithCommas(values.net_income || values.net_profit || ''); // net_profit for sellers
            const vEvEbitda = values.ev_ebitda || '';

            row.innerHTML = `
                <input type="text" class="fin-year" placeholder="?꾨룄" value="${vYear}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="fin-revenue numeric-input" placeholder="留ㅼ텧?? value="${vRev}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="fin-op numeric-input" placeholder="?곸뾽?댁씡" value="${vOpd}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="fin-net numeric-input" placeholder="?밴린?쒖씠?? value="${vNet}" style="flex: 1.5; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                <input type="text" class="fin-ev-ebitda" placeholder="EV/EBITDA" value="${vEvEbitda}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; display: ${fromSource === 'totalseller' ? 'block' : 'none'};">
                <button type="button" class="btn-remove-row" style="background: none; border: none; font-size: 14px; cursor: pointer; color: #ef4444;"><span class="material-symbols-outlined" style="font-size: 16px;">remove</span></button>
            `;
        }

        row.querySelectorAll('.numeric-input').forEach(input => {
            input.addEventListener('input', function (e) {
                let cursorPosition = this.selectionStart;
                let oldLength = this.value.length;

                let val = this.value;
                const isNegative = val.startsWith('-');
                let numOnly = val.replace(/[^0-9]/g, '');

                if (numOnly) {
                    this.value = (isNegative ? '-' : '') + Number(numOnly).toLocaleString('ko-KR');
                } else {
                    this.value = isNegative ? '-' : '';
                }

                // Adjust cursor position
                let newLength = this.value.length;
                cursorPosition = cursorPosition + (newLength - oldLength);
                this.setSelectionRange(cursorPosition, cursorPosition);
            });
        });

        row.querySelector('.btn-remove-row').addEventListener('click', function () {
            row.remove();
        });

        return row;
    }

    $('#add-investment-btn').on('click', function () {
        $investmentRows.append(createInputRow('investment'));
    });

    $('#add-financial-btn').on('click', function () {
        $financialRows.append(createInputRow('financial'));
    });

    // Textarea Auto-resize Utility
    function autoResizeTextarea($el) {
        if (!$el || !$el[0]) return;
        $el.css('height', 'auto');
        $el.css('height', $el[0].scrollHeight + 'px');
    }

    $('.notebook-title').on('input', function () {
        const name = $(this).text().trim() || "湲곗뾽紐?;
        document.title = `${name} - DealBook`;
        $('#sidebar-header-title').text(name);
    });

    [$summaryText, $managerMemo, $financialAnalysis].forEach($el => {
        $el.on('input change', function () {
            autoResizeTextarea($(this));
        });
    });

    // ?곗뾽 '湲고?' ?좏깮 ???낅젰李??쒖뼱
    $('#industry').on('change', function () {
        const val = $(this).val();
        if (val === '湲고?') {
            $('#industry-other').show().focus();
        } else {
            $('#industry-other').hide().val('');
        }

        // currentCompanyData媛 ?덉쑝硫?利됱떆 諛섏쁺 (紐⑤떖 ?깆뿉???곕룞 ???꾩슂)
        if (currentCompanyData) {
            if (val === '湲고?') {
                const otherVal = $('#industry-other').val().trim();
                currentCompanyData.industry = otherVal ? `湲고?: ${otherVal}` : '湲고?';
            } else {
                currentCompanyData.industry = val;
            }
        }
    });

    $('#industry-other').on('input', function () {
        if (currentCompanyData && $('#industry').val() === '湲고?') {
            const otherVal = $(this).val().trim();
            currentCompanyData.industry = otherVal ? `湲고?: ${otherVal}` : '湲고?';
        }
    });

    // 愿由ы쁽??踰꾪듉 移??대┃ ?대깽??
    $('.btn-status-chip').on('click', function () {
        $('.btn-status-chip').css({
            'background': '#fff',
            'color': '#64748b',
            'border-color': '#e2e8f0'
        }).removeClass('active');

        $(this).css({
            'background': 'var(--primary-color)',
            'color': '#fff',
            'border-color': 'var(--primary-color)'
        }).addClass('active');

        if ($(this).data('value') === '湲고?') {
            $('#mgmt-status-other').slideDown(200).focus();
        } else {
            $('#mgmt-status-other').slideUp(200).val('');
        }
    });

    function loadAvailableFiles() {
        return APIcall({
            action: 'get',
            table: 'files',
            user_id: user_id
        }, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(data => {
                const files = Array.isArray(data) ? data : (data.Items || []);
                availableFiles = files.map(f => ({
                    id: f.id,
                    name: f.file_name || f.name || 'Unknown',
                    user_id: f.user_id,
                    location: f.location,
                    vectorNamespace: f.vectorNamespace // Track indexing status
                }));
                console.log('Available files for registration loaded:', availableFiles.length);
            })
            .catch(error => {
                console.error('Error loading available files:', error);
            });
    }

    // 1. ?뚯궗 湲곕낯 ?뺣낫 媛?몄삤湲?(?쒖감 ?ㅽ뻾???꾪빐 ?⑥닔濡?遺꾨━)
    function loadCompanyData() {
        const payload1 = {
            action: 'get',
            table: fromSource === 'totalseller' ? 'sellers' : 'companies',
            id: companyId,
            user_id: "" // 紐⑤뱺 ?ъ슜?먯쓽 湲곗뾽??議고쉶?????덈룄濡??섏젙 (?ㅽ??몄뾽 ?덈툕 ?곕룞 ?鍮?
        };

        APIcall(payload1, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    console.error('?곗씠?곕? 遺덈윭?ㅻ뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎:', data.error);
                } else {
                    if (data && !data.error) {
                        // [Fix] ?ㅼ뼇???묐떟 援ъ“ ???(諛곗뿴, Items 媛앹껜, Item 媛앹껜 ??
                        let rawData = null;
                        if (Array.isArray(data)) {
                            rawData = data[0];
                        } else if (data.Items && Array.isArray(data.Items)) {
                            rawData = data.Items[0];
                        } else if (data.Item) {
                            rawData = data.Item;
                        } else {
                            rawData = data;
                        }

                        if (!rawData || !rawData.id) {
                            console.error('Company data not found in response:', data);
                            return;
                        }

                        if (fromSource === 'totalseller') {
                            const validStatuses = ['?湲?, '吏꾪뻾以?, '?꾨즺'];
                            const status = validStatuses.includes(rawData.status) ? rawData.status : '?湲?;
                            // 蹂몄씤(?묒꽦?? ?뺤씤
                            const loggedInUser = localStorage.getItem('dealchat_users') ? JSON.parse(localStorage.getItem('dealchat_users')) : null;
                            const isOwner = (loggedInUser && loggedInUser.id === rawData.user_id);

                            if (!isOwner && (status === '吏꾪뻾以? || status === '?꾨즺')) {
                                const msg = (status === '吏꾪뻾以?) ? '?꾩옱 嫄곕옒媛 吏꾪뻾 以묒엯?덈떎.' : '嫄곕옒媛 ?꾨즺?섏뿀?듬땲??';
                                alert(msg);
                                // 而⑦뀗痢??묎렐 李⑤떒 UI ?쒖텧
                                $('body').css('overflow', 'hidden').empty().append(`
                                    <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#f8fafc; color:#64748b; font-family: 'Pretendard Variable', Pretendard, sans-serif; gap:20px; text-align:center; padding: 20px;">
                                        <span class="material-symbols-outlined" style="font-size: 80px; color:#cbd5e1; margin-bottom: 10px;">lock_person</span>
                                        <div style="font-size:28px; font-weight:800; color:#1e293b; letter-spacing: -0.5px;">${msg}</div>
                                        <p style="font-size:16px; line-height: 1.6; color: #64748b; max-width: 400px;">
                                            ?대떦 湲곗뾽? ?꾩옱 嫄곕옒 ?④퀎 蹂댄샇瑜??꾪빐<br>?곸꽭 由ы룷??議고쉶媛 ?쇱떆?곸쑝濡??쒗븳?섏뿀?듬땲??
                                        </p>
                                        <button onclick="location.href='./totalsellers.html'" 
                                            style="margin-top: 10px; padding:14px 40px; background:#8b5cf6; color:white; border:none; border-radius:50px; font-weight:700; font-size: 15px; cursor:pointer; box-shadow: 0 10px 20px rgba(139, 92, 246, 0.2); transition: all 0.2s;">
                                            留ㅻ룄 湲곗뾽 紐⑸줉?쇰줈 ?뚯븘媛湲?
                                        </button>
                                    </div>
                                `);
                                return;
                            }

                            let sellerMeta = "";
                            if (rawData.sale_price) sellerMeta += `留ㅺ컖 ?щ쭩媛: ${rawData.sale_price}??n`;
                            if (rawData.sale_method) sellerMeta += `留ㅻ룄 諛⑹떇: ${rawData.sale_method}\n`;
                            if (rawData.status) sellerMeta += `吏꾪뻾 ?꾪솴: ${rawData.status}\n`;
                            if (sellerMeta) rawData.summary = sellerMeta + (rawData.summary ? "\n" + rawData.summary : "");
                        }

                        // ?곸꽭 ?뺣낫媛 ?붿빟(summary) ?댁뿉 蹂묓빀??寃쎌슦瑜??꾪빐 ?뚯떛 ?섑뻾
                        const parsedData = parseCompanyData(rawData);
                        currentCompanyData = parsedData;

                        console.log('?뚯궗 ?뺣낫 (?뚯떛??:', parsedData);

                        // ?곗뾽 遺꾩빞 ?명똿 (湲고? 泥섎━)
                        const indValue = parsedData.industry || "湲고?";
                        if (indValue.startsWith('湲고?: ')) {
                            $('#industry').val('湲고?');
                            $('#industry-other').val(indValue.replace('湲고?: ', '')).show();
                        } else {
                            $('#industry').val(indValue);
                            $('#industry-other').hide().val('');
                        }

                        $('#summary').val(parsedData.summary || "");

                        // [異붽?] 愿由ы쁽??諛붿씤??(踰꾪듉 移??뺥깭)
                        const mgmtStatus = parsedData.managementStatus || "";
                        if (mgmtStatus) {
                            const $targetBtn = $(`.btn-status-chip[data-value="${mgmtStatus}"]`);
                            if ($targetBtn.length) {
                                $targetBtn.trigger('click');
                            } else if (mgmtStatus) {
                                $(`.btn-status-chip[data-value="湲고?"]`).trigger('click');
                                $('#mgmt-status-other').val(mgmtStatus);
                            }
                        }

                        // [異붽?] ????щ????곕Ⅸ UI 蹂寃?
                        if (parsedData.is_temporary === false || (parsedData.is_temporary === undefined && parsedData.id)) {
                            // ?깅줉???쒕턿??3媛?踰꾪듉 ?좎? (??젣?섍린, 鍮꾧났媛? ??ν븯湲?
                            $('#btn-draft').show();
                            $('#btn-save').html('<span class="material-symbols-outlined" style="font-size: 16px;">save</span> ??ν븯湲?);
                            $('#btn-share-db-trigger').show(); // ??λ맂 湲?대㈃ 怨듭쑀 踰꾪듉 ?몄텧
                        }

                        $('#manager-memo').val(parsedData.managerMemo || parsedData.manager_memo || "");
                        $('#financial-analysis').val(parsedData.financialAnalysis || parsedData.financial_analysis || "");

                        // [異붽?] ?대떦???섍껄 ?묒꽦???뺣낫 諛붿씤??(?ㅼ젣 ?묒꽦???뺣낫 議고쉶)
                        if (parsedData.user_id) {
                            APIcall({
                                action: 'get',
                                table: 'users',
                                id: parsedData.user_id
                            }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                                .then(res => res.json())
                                .then(authorData => {
                                    const author = Array.isArray(authorData) ? authorData[0] : (authorData.Item || authorData);
                                    if (author && author.name) {
                                        $('#memo-author-name').text(author.name);
                                        $('#memo-author-affiliation').text(author.company || author.department || "DealChat");
                                        $('#memo-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(author.name)}`);
                                    } else {
                                        $('#memo-author-name').text("GUEST");
                                        $('#memo-author-affiliation').text("諛⑸Ц??);
                                    }
                                })
                                .catch(err => {
                                    console.error('Failed to fetch author info:', err);
                                    $('#memo-author-name').text("GUEST");
                                });
                        }

                        // [異붽?] 理쒖쥌 ?섏젙?쇱옄 諛붿씤??
                        if (rawData.updated_at) {
                            const date = new Date(rawData.updated_at);
                            const formattedDate = date.toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            $('#memo-update-date').text(`理쒖쥌 ?섏젙: ${formattedDate}`);
                        }


                        $('#financial-analysis').val(currentCompanyData.financialAnalysis || "");
                        $('#ceo-name').val(currentCompanyData.ceoName || "");
                        $('#company-email').val(currentCompanyData.companyEmail || "");
                        $('#establishment-date').val(currentCompanyData.establishmentDate || "");
                        $('#company-address').val(currentCompanyData.companyAddress || "");

                        // [異붽?] SELLER ?꾩슜 ?꾨뱶 諛붿씤??
                        if (fromSource === 'totalseller') {
                            $('#seller-info-layer').css('display', 'flex');
                            $('#seller-price-field').val(rawData.sale_price || "");
                            $('#seller-method-field').val(rawData.sale_method || "");
                            
                            // [異붽?] financial_data 諛곗뿴???덉쑝硫??뚯씠釉??앹꽦
                            if (rawData.financial_data && Array.isArray(rawData.financial_data)) {
                                const $finRows = $('#financial-rows').empty();
                                rawData.financial_data.forEach(item => {
                                    const rowHtml = `
                                        <div class="financial-row d-flex gap-2" style="margin-bottom: 8px; align-items: center;">
                                            <input type="text" class="fin-year" placeholder="?꾨룄" value="${item.year || ''}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                                            <input type="text" class="fin-revenue" placeholder="留ㅼ텧?? value="${item.revenue || ''}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                                            <input type="text" class="fin-op" placeholder="?곸뾽?댁씡" value="${item.profit || ''}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                                            <input type="text" class="fin-net" placeholder="?밴린?쒖씠?? value="${item.net_profit || ''}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right;">
                                            <input type="text" class="fin-ev-ebitda" placeholder="EV/EBITDA" value="${item.ev_ebitda || ''}" style="flex: 1; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; display: block;">
                                        </div>`;
                                    $finRows.append(rowHtml);
                                });
                            }

                            // SELLER??吏꾪뻾 ?꾪솴 移??띿뒪??諛??쇰꺼 蹂寃?
                            const $statusGroup = $('#mgmt-status-group');
                            $statusGroup.prev('div').find('p').text('吏꾪뻾 ?꾪솴'); // '愿由ы쁽?? -> '吏꾪뻾 ?꾪솴'
                            $statusGroup.find('.btn-status-chip').each(function() {
                                const val = $(this).data('value');
                                if (val === '諛쒓뎬 湲곗뾽') $(this).text('?湲?).data('value', '?湲?);
                                else if (val === '蹂댁쑁 湲곗뾽') $(this).text('吏꾪뻾以?).data('value', '吏꾪뻾以?);
                                else if (val === '?ъ옄 湲곗뾽') $(this).text('?꾨즺').data('value', '?꾨즺');
                            });
                        }

                        // 珥덇린 ?믪씠 議곗젅
                        autoResizeTextarea($('#summary'));
                        autoResizeTextarea($('#manager-memo'));
                        autoResizeTextarea($('#financial-analysis'));

                        $('#modal-summary-text').val(parsedData.summary);


                        // ?ъ옄?꾪솴 ?곗씠??濡쒕뱶
                        $investmentRows.empty();
                        if (parsedData.investmentStatusDesc) {
                            const invLines = parsedData.investmentStatusDesc.split('\n').filter(l => l.trim());
                            const sortedInv = invLines.map(line => {
                                const parts = line.split(', ').reduce((acc, part) => {
                                    const [key, val] = part.split(': ');
                                    if (key && val !== undefined) acc[key.trim()] = val.trim();
                                    return acc;
                                }, {});
                                return {
                                    year: parseInt(parts['?꾨룄']) || 0,
                                    data: {
                                        year: parts['?꾨룄'] || '',
                                        stage: parts['?ъ옄?④퀎'] || '',
                                        valuation: parts['踰⑤쪟'] || '',
                                        amount: parts['湲덉븸'] || '',
                                        investor: parts['?ъ옄??] || ''
                                    }
                                };
                            }).sort((a, b) => b.year - a.year);

                            sortedInv.forEach(item => {
                                $investmentRows.append(createInputRow('investment', item.data));
                            });
                        }

                        // ?щТ?꾪솴 ?곗씠??濡쒕뱶
                        $financialRows.empty();
                        if (currentCompanyData.financialStatusDesc) {
                            const finLines = currentCompanyData.financialStatusDesc.split('\n').filter(l => l.trim());
                            const sortedFin = finLines.map(line => {
                                const parts = line.split(', ').reduce((acc, part) => {
                                    const [key, val] = part.split(': ');
                                    if (key && val !== undefined) acc[key.trim()] = val.trim();
                                    return acc;
                                }, {});
                                return {
                                    year: parseInt(parts['?꾨룄']) || 0,
                                    data: {
                                        year: parts['?꾨룄'] || '',
                                        revenue: parts['留ㅼ텧??] || '',
                                        operating_profit: parts['?곸뾽?댁씡'] || '',
                                        profit: parts['?곸뾽?댁씡'] || '',
                                        net_income: parts['?밴린?쒖씠??] || '',
                                        net_profit: parts['?밴린?쒖씠??] || '',
                                        ev_ebitda: parts['EV/EBITDA'] || ''
                                    }
                                };
                            }).sort((a, b) => b.year - a.year);

                            sortedFin.forEach(item => {
                                $financialRows.append(createInputRow('financial', item.data));
                            });
                        }

                        if (parsedData.industry) {
                            const categories = [
                                "AI", "IT쨌?뺣낫?듭떊", "SaaS쨌?붾（??, "寃뚯엫", "怨듦났쨌援?갑", "愿愿뫢룸젅?",
                                "援먯쑁쨌?먮??뚰겕", "湲덉쑖쨌??뚰겕", "?띉룹엫쨌?댁뾽", "?쇱씠?꾩뒪???, "紐⑤퉴由ы떚",
                                "臾명솕?덉닠쨌肄섑뀗痢?, "諛붿씠?ㅒ룻뿬?ㅼ???, "遺?숈궛", "酉고떚쨌?⑥뀡", "?먮꼫吏쨌?섍꼍",
                                "?몄떇?끒룹냼?곴났??, "?곗＜쨌??났", "?좏넻쨌臾쇰쪟", "?쒖“쨌嫄댁꽕", "?뚮옯?셋룹빱裕ㅻ땲??, "湲고?"
                            ];
                            const matched = categories.includes(parsedData.industry) ? parsedData.industry : '湲고?';
                            $('#industry').val(matched);
                            if (matched === '湲고?') {
                                const otherVal = (parsedData.industry || "").startsWith('湲고?: ') ? parsedData.industry.replace('湲고?: ', '') : '';
                                $('#industry-other').val(otherVal).show();
                            } else {
                                $('#industry-other').hide().val('');
                            }
                            $('#modal-industry-text').val(matched);
                        }

                        if (parsedData.companyName) {
                            $('.notebook-title').text(parsedData.companyName);
                            $('#modal-company-name-text').val(parsedData.companyName);
                            // 釉뚮씪?곗? ???쒕ぉ ?낅뜲?댄듃
                            document.title = `${parsedData.companyName} - DealBook`;
                            // ?ъ씠?쒕컮 ?ㅻ뜑 ?낅뜲?댄듃
                            $('#sidebar-header-title').text(parsedData.companyName);
                        }

                        if (rawData.user_id) {
                            $('#user_id').val(rawData.user_id);
                        }

                        // 湲곗〈 泥⑤??뚯씪 濡쒕뱶
                        if (rawData.attachments && rawData.attachments.length > 0) {
                            rawData.attachments.forEach(item => {
                                const isObject = typeof item === 'object' && item !== null;
                                const fileId = isObject ? item.id : item;

                                const file = availableFiles.find(f => f.id === fileId);
                                if (file) {
                                    const isTraining = isObject ? !!item.isTraining : !!file.vectorNamespace;
                                    const isFinance = isObject ? !!item.isFinance : false;
                                    addFileToSourceList(file.name || file.file_name, fileId, file.location, isTraining, isFinance);
                                } else {
                                    APIcall({ action: 'get', table: 'files', id: fileId }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                                        .then(res => res.json())
                                        .then(fData => {
                                            if (fData && !fData.error && fData.id) {
                                                const isTraining = isObject ? !!item.isTraining : !!fData.vectorNamespace;
                                                const isFinance = isObject ? !!item.isFinance : false;
                                                addFileToSourceList(fData.file_name || fData.name, fData.id, fData.location, isTraining, isFinance);
                                                if (!availableFiles.some(f => f.id === fData.id)) {
                                                    availableFiles.push({
                                                        id: fData.id,
                                                        name: fData.file_name || fData.name,
                                                        user_id: fData.user_id,
                                                        location: fData.location,
                                                        vectorNamespace: fData.vectorNamespace
                                                    });
                                                }
                                            }
                                        }).catch(e => console.error('Missing file fetch failed:', e));
                                }
                            });
                        }
                        // ????덉뒪?좊━ 蹂듭썝 (DB)
                        if (rawData.history && Array.isArray(rawData.history) && rawData.history.length > 0) {
                            $welcomeScreen.hide();
                            conversationHistory = rawData.history;
                            console.log(`?뱶 History loaded from DB: ${conversationHistory.length} messages`);

                            conversationHistory.forEach(msg => {
                                let sender = msg.role;
                                // [Fix] 'assistant' ?먮뒗 ?臾몄옄 'AI'瑜??뚮Ц??'ai'濡??듭씪 (?붾㈃ ?쒖떆??
                                if (sender === 'assistant' || sender === 'AI') sender = 'ai';

                                addMessage(msg.content, sender, false);
                            });
                            // ?ㅽ겕濡??대룞
                            setTimeout(() => {
                                $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                            }, 100);
                        }

                        // [Check] Read-Only Mode ?곸슜 (紐⑤뱺 ?곗씠??諛붿씤??諛??숈쟻 ???앹꽦 ?꾨즺 ??理쒖쥌 ?ㅽ뻾)
                        const isOwner = (userData && userData.id === parsedData.user_id);
                        // STARTUP ?덈툕?먯꽌 ?묎렐?덇굅???뚯쑀?먭? ?꾨땶 寃쎌슦 ?쎄린 ?꾩슜 紐⑤뱶 媛뺤젣
                        if (!isOwner || fromSource === 'totalstartup') {
                            console.log('?썳截?Finalizing Read-Only Mode (Shared or Startup Access)');
                            applyReadOnlyMode();
                        }
                    }
                }
            })
            .catch(error => {
                console.error('?곗씠??濡쒕뱶 ?ㅽ뙣:', error);
            })
            .finally(() => {
                hideLoader();
            });
    }
    // 珥덇린 UI ?명똿 (?곗씠??濡쒕뱶 ??利됱떆 ?ㅽ뻾)
    if (isNew) {
        $('.notebook-title').text('').attr('placeholder', '湲곗뾽紐낆쓣 ?낅젰?섏꽭??);
        document.title = "??湲곗뾽 ?깅줉 - DealBook";
        $('#sidebar-header-title').text("??湲곗뾽 ?깅줉");
        $('#summary').val('');
        $('#manager-memo').val('');

        $('#memo-author-name').text(userData?.name || "GUEST");
        $('#memo-author-affiliation').text(userData?.company || userData?.department || "諛⑸Ц??);
        if (userData?.name) {
            $('#memo-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name)}`);
        }

        $('#industry').val('?좏깮?댁＜?몄슂');
        $('#btn-save').html('<span class="material-symbols-outlined" style="font-size: 18px;">save</span> ???);
        $welcomeScreen.hide();
        addMessage("?덈줈??湲곗뾽 ?뺣낫瑜??낅젰??二쇱꽭?? 湲곗뾽紐? ?곗뾽, ?뚭컻 ?깆쓣 ?낅젰?????섎떒??'??? 踰꾪듉???꾨Ⅴ硫???μ씠 ?꾨즺?⑸땲??", 'ai', false);
        hideLoader();
    }

    if (user_id) {
        loadAvailableFiles().then(() => {
            if (!isNew) {
                loadCompanyData();
            }
        });
    } else {
        // Guest mode (Shared URL)
        if (!isNew) {
            loadCompanyData();
        }
    }

    // Load Report Types
    loadReportTypes();

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
            const iconHtml = report.isPrimary ? '' : '<span class="material-symbols-outlined edit-icon">edit</span>';

            const cardHtml = `
                <div class="report-card ${isPrimary}" data-id="${report.id}">
                    <div class="card-info">
                        <h5>${report.title}</h5>
                        <p>${report.description}</p>
                    </div>
                    ${iconHtml}
                </div>
            `;

            if (report.category === 'format') {
                $formatGrid.append(cardHtml);
            } else {
                $recGrid.append(cardHtml);
            }
        });
    }

    // Save 踰꾪듉 ?대┃ ?대깽??(紐⑤떖)
    $('#save-summary').on('click', async function () {
        if (!currentCompanyData) {
            alert('?섏젙???곗씠?곌? 濡쒕뱶?섏? ?딆븯?듬땲??');
            return;
        }

        const updatedSummary = $('#modal-summary-text').val();
        const updatedIndustry = $('#modal-industry-text').val();
        const updatedCompanyName = $('#modal-company-name-text').val();

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('???以?..');

        try {
            // ?듯빀 ????⑥닔 ?몄텧 (蹂묓빀 濡쒖쭅 ?ы븿)
            await saveCompanyFields({
                companyName: updatedCompanyName,
                summary: updatedSummary,
                industry: updatedIndustry
            });

            // UI ?숆린??
            $('#summary').val(updatedSummary);
            $('#industry').val(updatedIndustry);
            $('.notebook-title').text(updatedCompanyName);
            $summaryModal.hide();
        } catch (error) {
            console.error('????ㅽ뙣:', error);
            alert('????붿껌???ㅽ뙣?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // Auto-resize textarea
    $chatInput.on('input', function () {
        $(this).css('height', 'auto');
        $(this).css('height', this.scrollHeight + 'px');
    });

    // Send message function
    let isSending = false; // 以묐났 ?꾩넚 諛⑹? ?뚮옒洹?

    async function sendMessage() {
        if (isSending) return; // ?대? ?꾩넚 以묒씠硫?臾댁떆

        const userInput = $chatInput.val().trim();

        if (userInput) {
            isSending = true; // ?꾩넚 ?쒖옉

            if ($welcomeScreen.length) {
                $welcomeScreen.hide();
            }

            // User Message
            addMessage(userInput, 'user');
            addToHistory('user', userInput); // Store in history
            $chatInput.val('').css('height', 'auto');
            $('#send-btn').removeClass('active');

            // AI Response (RAG -> LLM 援ъ“)
            let $aiMessage = null;
            try {
                // ?듬? 以鍮?以?硫붿떆吏 ?쒖떆
                $aiMessage = addMessage("", 'ai', true, true);

                // 1. ?뚯궗 湲곕낯 ?뺣낫 ?섏쭛 (Summary, Industry, Company Name)
                let companyInfo = "";
                if (currentCompanyData) {
                    const companyName = currentCompanyData.companyName || $('.notebook-title').text() || "?뚯궗紐??놁쓬";
                    const summary = currentCompanyData.summary || $('#summary').val() || "";
                    const industry = currentCompanyData.industry || $('#industry').val() || "";
                    if (companyName || summary || industry) {
                        companyInfo = "=== ?뚯궗 湲곕낯 ?뺣낫 ===\n";
                        if (companyName) companyInfo += `?뚯궗紐? ${companyName}\n`;
                        if (industry) companyInfo += `?곗뾽: ${industry}\n`;
                        if (summary) companyInfo += `?뚯궗?뚭컻: ${summary}\n`;
                        if (summary) companyInfo += `?뚯궗?뚭컻: ${summary}\n`;
                        companyInfo += "\n";
                        console.log("?뱥 Company Info Added to Context");
                    }
                }

                // 2. Vector DB?먯꽌 愿???뺣낫 寃??(RAG)
                let ragContext = "";
                if (companyId) {
                    try {
                        console.log("?뵇 Searching Vector DB with Namespace (Company ID):", companyId);
                        ragContext = await searchVectorDB(userInput, companyId, SUPABASE_ENDPOINT);
                        console.log("?뱞 RAG Search Result Length:", ragContext.length);
                    } catch (ragErr) {
                        console.warn("RAG Search failed, proceeding without RAG context:", ragErr);
                    }
                }

                // 3. ????덉뒪?좊━ ?щ㎎??(?꾩옱 硫붿떆吏 ?쒖쇅)
                const historyForPrompt = formatHistoryForPrompt(
                    conversationHistory.slice(0, -1)
                );

                // 4. ?꾩껜 而⑦뀓?ㅽ듃 寃고빀
                const fullContext = companyInfo + historyForPrompt + (ragContext ? "\n=== 愿??臾몄꽌 ?댁슜 ===\n" + ragContext : "");

                // 5. AI ?묐떟 ?앹꽦 ?붿껌
                const response = await addAiResponse(userInput, fullContext);
                const data = await response.json();
                const aiAnswer = data.answer;

                // ??댄븨 ?몃뵒耳?댄꽣 ?쒓굅 諛??ㅼ젣 ?듬? ?뚮뜑留?
                $aiMessage.find('.message-content').html(parseMarkdown(aiAnswer));
                console.log('?뮶 AI Response saving to history...');
                addToHistory('AI', aiAnswer);
            } catch (error) {
                console.error('AI Response Error:', error);
                const errorMsg = '二꾩넚?⑸땲?? ?묐떟???앹꽦?섎뒗 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.';
                if ($aiMessage) {
                    $aiMessage.find('.message-content').text(errorMsg);
                } else {
                    addMessage(errorMsg, 'ai');
                }
                addToHistory('AI', errorMsg);
            } finally {
                isSending = false;
            }
        }
    }

    function parseMarkdown(text) {
        if (!text) return "";
        let html = text
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^\* (.*$)/gim, '<li>$1</li>')
            .replace(/^- (.*$)/gim, '<li>$1</li>')
            .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

        return html;
    }

    function addMessage(text, sender, animate = true, isTyping = false) {
        const avatar = sender === 'ai'
            ? '<div class="avatar material-symbols-outlined">auto_awesome</div>'
            : '<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" class="avatar">';

        let content = '';
        if (isTyping) {
            content = `
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <span style="font-size: 13px; color: var(--text-secondary); margin-left: 8px;">?듬???以鍮꾪븯怨??덉뒿?덈떎</span>
                </div>
            `;
        } else {
            content = sender === 'ai' ? parseMarkdown(text) : text;
        }

        const messageHtml = `
            <div class="message ${sender}">
                ${sender === 'ai' ? avatar : ''}
                <div class="message-content">${content}</div>
                ${sender === 'user' ? avatar : ''}
            </div>
        `;

        const $message = $(messageHtml);
        $chatMessages.append($message);

        // Scroll to bottom
        if (animate) {
            $chatMessages.animate({ scrollTop: $chatMessages[0].scrollHeight }, 300);
        } else {
            $chatMessages.scrollTop($chatMessages[0].scrollHeight);
        }
        return $message;
    }

    // Event Listeners
    $('#send-btn').on('click', sendMessage);

    $chatInput.on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.originalEvent.isComposing) return; // ?쒓? ?낅젰 議고빀 以??뷀꽣 諛⑹? (IME 臾몄젣 ?닿껐)
            e.preventDefault();
            sendMessage();
        }
    });

    // Toggle Send Button Active State
    $chatInput.on('input', function () {
        const hasText = $(this).val().trim().length > 0;
        $('#send-btn').toggleClass('active', hasText);
    });

    // Save Buttons (Draft & Save function identically for now)
    $('#btn-draft, #btn-save').on('click', async function () {
        const $btn = $(this);
        const originalHtml = $btn.html();
        const isDraft = $(this).attr('id') === 'btn-draft';
        const loadingText = isDraft ? '鍮꾧났媛????以?..' : '???以?..';
        const completeText = isDraft ? '鍮꾧났媛?????꾨즺' : '????꾨즺';

        $btn.prop('disabled', true).html(`<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> ${loadingText}`);

        // ?숈쟻 ?쇱뿉???곗씠???섏쭛 諛??뺣젹
        let investmentList = [];
        $('#investment-rows > div').each(function () {
            const yearVal = $(this).find('.inv-year').val().trim();
            const yearNum = parseInt(yearVal) || 0;
            const stage = $(this).find('.inv-stage').val().trim();
            const val = $(this).find('.inv-valuation').val().trim();
            const amt = $(this).find('.inv-amount').val().trim();
            const investor = $(this).find('.inv-investor').val().trim();
            if (yearVal || stage || val || amt || investor) {
                investmentList.push({
                    year: yearNum,
                    text: `?꾨룄: ${yearVal}, ?ъ옄?④퀎: ${stage}, 踰⑤쪟: ${val}, 湲덉븸: ${amt}, ?ъ옄?? ${investor}`
                });
            }
        });
        investmentList.sort((a, b) => b.year - a.year);
        let serializedInvestments = investmentList.map(item => item.text);

        let financialList = [];
        $('#financial-rows > div').each(function () {
            const yearVal = $(this).find('.fin-year').val().trim();
            const yearNum = parseInt(yearVal) || 0;
            const rev = $(this).find('.fin-revenue').val().trim();
            const op = $(this).find('.fin-op').val().trim();
            const net = $(this).find('.fin-net').val().trim();
            if (yearVal || rev || op || net) {
                financialList.push({
                    year: yearNum,
                    text: `?꾨룄: ${yearVal}, 留ㅼ텧?? ${rev}, ?곸뾽?댁씡: ${op}, ?밴린?쒖씠?? ${net}`
                });
            }
        });
        financialList.sort((a, b) => b.year - a.year);
        let serializedFinancials = financialList.map(item => item.text);

        try {
            // ?곗뾽 遺꾩빞 理쒖쥌 媛?寃곗젙
            let finalIndustry = $industryText.val();
            if (finalIndustry === '湲고?') {
                const otherVal = $('#industry-other').val().trim();
                if (otherVal) finalIndustry = `湲고?: ${otherVal}`;
            }

            await saveCompanyFields({
                industry: finalIndustry,
                summary: $summaryText.val(),
                managerMemo: $('#manager-memo').val(),
                financialAnalysis: $('#financial-analysis').val(),
                ceoName: $('#ceo-name').val().trim(),
                companyEmail: $('#company-email').val().trim(),
                establishmentDate: $('#establishment-date').val().trim(),
                companyAddress: $('#company-address').val().trim(),
                investmentStatusDesc: serializedInvestments.join('\n'),
                financialStatusDesc: serializedFinancials.join('\n'),
                // Add seller-specific fields for saving
                salePrice: $('#seller-price-field').val().trim(),
                saleMethod: $('#seller-method-field').val().trim(),
                status: $('#seller-status-field').val().trim()
            }, isDraft);

            $btn.html(`<span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span> ${completeText}`);

            // ????깃났 ??UI ?낅뜲?댄듃: ?붿껌???곕씪 '??젣?섍린, 鍮꾧났媛? ??ν븯湲? 3媛?援ъ꽦 ?좎?
            if (!isDraft) {
                $('#btn-draft').show();
                $('#btn-save').html('<span class="material-symbols-outlined" style="font-size: 16px;">save</span> ??ν븯湲?);
                $('#btn-share-db-trigger').show().addClass('animate__animated animate__fadeIn');
            }

            setTimeout(() => {
                $btn.prop('disabled', false).html(originalHtml);
            }, 2000);
        } catch (err) {
            console.error('Save failed:', err);
            alert('???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + (err.message || '?????녿뒗 ?ㅻ쪟'));
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    // Delete Company Logic
    $('#btn-delete-company').on('click', async function () {
        if (!companyId || companyId === 'new') return;
        if (!confirm('?꾩옱 湲곗뾽 ?뺣낫瑜??곴뎄?곸쑝濡???젣?섏떆寃좎뒿?덇퉴? 愿??臾몄꽌? ????댁슜? ??젣?섏? ?딆쑝?? 由ъ뒪?몄뿉???щ씪吏묐땲??')) return;

        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 16px;">sync</span> ??젣 以?..');

        try {
            const payload = {
                table: fromSource === 'totalseller' ? 'sellers' : 'companies',
                action: 'delete',
                id: companyId,
                user_id: user_id
            };

            const response = await APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
            const result = await response.json();

            if (result.error) throw new Error(result.error);
            alert('??젣?섏뿀?듬땲??');
            window.location.href = './companies.html';
        } catch (err) {
            console.error('Delete failed:', err);
            alert('??젣???ㅽ뙣?덉뒿?덈떎.');
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    $('#close-guide').on('click', function () {
        $guidePanel.addClass('hidden');
    });

    // Handle separate source add buttons (Listeners below around line 1316)


    // AI Teaser Button (Removed from UI)

    // Guide Panel Toggle (Removed from top actions in HTML, but keeping logic just in case)
    $('.top-actions .btn-primary').on('click', function () {
        $guidePanel.toggleClass('hidden');
    });

    // Prompt Chips
    $('.prompt-chip').on('click', function () {
        const promptText = $(this).text();
        $chatInput.val(promptText);
        sendMessage();
    });

    const $summaryModal = $('#summary-modal');
    const $modalSummaryText = $('#modal-summary-text');
    const $modalIndustryText = $('#modal-industry-text');
    const $modalCompanyNameText = $('#modal-company-name-text');
    const $pathText = $('#discoveryPath');
    const $statusSelect = $('#investmentStatus');
    const $valuationText = $('#valuation');
    const $amountText = $('#investmentAmount');

    $('#close-summary-modal').on('click', function () {
        $summaryModal.hide();
    });


    // AI Auto-Generation Logic (Sidebar & Modal)
    async function generateIndustry(contextField, targetField, $btn) {
        const originalText = $btn.html();
        const context = contextField.val();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 16px;">sync</span>');

        let ragData = "";
        try {
            console.log("?뵇 Generating Industry: Searching VectorDB...");
            ragData = await searchVectorDB("Industry Sector", companyId);
        } catch (e) {
            console.warn("RAG Search failed for industry gen:", e);
        }

        const fcontext = (context || "") + "\n\n" + ragData;
        try {
            const categories = [
                "AI", "IT쨌?뺣낫?듭떊", "SaaS쨌?붾（??, "寃뚯엫", "怨듦났쨌援?갑", "愿愿뫢룸젅?",
                "援먯쑁쨌?먮??뚰겕", "湲덉쑖쨌??뚰겕", "?띉룹엫쨌?댁뾽", "?쇱씠?꾩뒪???, "紐⑤퉴由ы떚",
                "臾명솕?덉닠쨌肄섑뀗痢?, "諛붿씠?ㅒ룻뿬?ㅼ???, "遺?숈궛", "酉고떚쨌?⑥뀡", "?먮꼫吏쨌?섍꼍",
                "?몄떇?끒룹냼?곴났??, "?곗＜쨌??났", "?좏넻쨌臾쇰쪟", "?쒖“쨌嫄댁꽕", "?뚮옯?셋룹빱裕ㅻ땲??, "湲고?"
            ];

            const industryPrompt = `???뚯궗媛 ?랁븳 ?곗뾽 遺꾩빞瑜??ㅼ쓬 移댄뀒怨좊━ 以??섎굹瑜?怨⑤씪 ?듬??댁쨾: [${categories.join(', ')}]. ?ㅻⅨ ?ㅻ챸 ?놁씠 移댄뀒怨좊━ ?대쫫留??듬???`;
            const response = await addAiResponse(industryPrompt, fcontext);
            const data = await response.json();
            let aiAnswer = data.answer.trim();

            // 移댄뀒怨좊━ 留ㅼ묶 濡쒖쭅 (?뺥솗???쇱튂?섏? ?딆쓣 寃쎌슦 ?鍮?
            const matchedCategory = categories.find(cat => aiAnswer.includes(cat)) || '湲고?';
            aiAnswer = matchedCategory;

            targetField.val(aiAnswer).trigger('change'); // Trigger change for auto-save
            if (targetField.attr('id') === 'industry') { // If sidebar field, sync to modal if open
                $('#modal-industry-text').val(aiAnswer);
            } else {
                $('#industry').val(aiAnswer);
                currentCompanyData.industry = aiAnswer;
            }
        } catch (error) {
            console.error('Industry generation failed:', error);
            alert('?곗뾽 ?뺣낫 ?앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).html(originalText);
        }
    }

    async function generateSummary(contextField, targetField, $btn) {
        const originalText = $btn.html();
        const text1 = contextField.val();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 16px;">sync</span>');

        let text2 = "";
        try {
            console.log("?뵇 Generating Summary: Searching VectorDB...");
            text2 = await searchVectorDB("Make a Company Summary", companyId);
        } catch (e) {
            console.warn("RAG Search failed for summary gen:", e);
        }

        const context = (text1 || "") + "\n\n" + text2;

        try {
            const summaryPrompt = "?먮즺瑜?諛뷀깢?쇰줈 ???뚯궗?뚭컻瑜?500???대궡濡??붿빟?댁쨾. ?ㅻⅨ ?ㅻ챸? ?섏?留?";
            const response = await addAiResponse(summaryPrompt, context);
            const data = await response.json();
            const aiAnswer = data.answer.trim();
            targetField.val(aiAnswer).trigger('change');
            if (targetField.attr('id') === 'summary') {
                $('#modal-summary-text').val(aiAnswer);
                autoResizeTextarea($('#summary'));
            } else {
                $('#summary').val(aiAnswer);
                currentCompanyData.summary = aiAnswer;
                autoResizeTextarea($('#summary'));
            }
        } catch (error) {
            console.error('Summary generation failed:', error);
            alert('?뚯궗?뚭컻 ?앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).html(originalText);
        }
    }

    // Sidebar AI Buttons
    // industry generation removed from sidebar UI
    // AI Auto-Fill from Files
    async function autoFillFromFiles($btn) {
        if (!currentCompanyData || !currentCompanyData.attachments || currentCompanyData.attachments.length === 0) {
            alert('遺꾩꽍???뚯씪???놁뒿?덈떎. 癒쇱? ?뚯씪???낅줈?쒗빐二쇱꽭??');
            return;
        }

        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 20px;">sync</span> 異붿텧 以?..');

        try {
            console.log("?뵇 AI Auto-filling: Searching VectorDB...");
            const contextRaw = await searchVectorDB("Extract company name, CEO name, email, business address, and company description", companyId);

            const extractionPrompt = `
                ?낅줈?쒕맂 ?먮즺瑜?遺꾩꽍?섏뿬 湲곗뾽??二쇱슂 ?뺣낫瑜?異붿텧?댁＜?몄슂.
                留뚯빟 ?먮즺?먯꽌 紐낇솗???뺤씤?????녿뒗 ?뺣낫??鍮?臾몄옄??"")濡?泥섎━?섏꽭??
                湲곗뾽紐낆? 理쒕????뺥솗?섍쾶 異붿텧?섍퀬, ?뚯궗?뚭컻??500???대궡濡??듭떖留??붿빟?댁＜?몄슂.

                諛섎뱶???꾨옒 JSON ?뺤떇?쇰줈留??묐떟?섏꽭?? ?ㅻⅨ 遺???ㅻ챸? 湲덉??⑸땲??
                {
                  "companyName": "湲곗뾽紐?,
                  "ceoName": "??쒖옄 ?깅챸",
                  "email": "怨듭떇 ?대찓??,
                  "address": "?ъ뾽??二쇱냼",
                  "summary": "?뚯궗?뚭컻 ?붿빟"
                }
            `;

            const response = await addAiResponse(extractionPrompt, contextRaw);
            const data = await response.json();
            const aiAnswer = data.answer.trim();

            // Extract JSON from response (in case AI adds triple backticks or markdown)
            let jsonData = null;
            try {
                const jsonMatch = aiAnswer.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonData = JSON.parse(jsonMatch[0]);
                } else {
                    jsonData = JSON.parse(aiAnswer);
                }
            } catch (e) {
                console.error("JSON Parse Error:", aiAnswer);
                throw new Error("AI ?묐떟 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎.");
            }

            if (jsonData) {
                if (jsonData.companyName) $notebookTitleText.text(jsonData.companyName);
                if (jsonData.ceoName) $('#ceo-name').val(jsonData.ceoName);
                if (jsonData.email) $('#company-email').val(jsonData.email);
                if (jsonData.address) $('#company-address').val(jsonData.address);
                if (jsonData.summary) {
                    $summaryText.val(jsonData.summary).trigger('change');
                    $('#modal-summary-text').val(jsonData.summary);
                    autoResizeTextarea($summaryText);
                }
                alert('湲곗뾽 ?뺣낫媛 ?먮룞?쇰줈 ?낅젰?섏뿀?듬땲??');
            }

        } catch (error) {
            console.error('Auto-fill failure:', error);
            alert('?뺣낫 異붿텧???ㅽ뙣?덉뒿?덈떎: ' + (error.message || '?????녿뒗 ?ㅻ쪟'));
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    }

    // Sidebar AI Buttons
    $('#ai-generate-summary').on('click', function () {
        generateSummary($summaryText, $summaryText, $(this));
    });

    $('#ai-auto-fill-btn').on('click', function () {
        autoFillFromFiles($(this));
    });

    // Modal AI Buttons (Using refactored functions)
    $('#generate-industry').on('click', function () {
        generateIndustry($('#modal-summary-text'), $('#modal-industry-text'), $(this));
    });

    $('#generate-summary').on('click', function () {
        generateSummary($('#modal-summary-text'), $('#modal-summary-text'), $(this));
    });

    let isSaving = false;

    // Auto-save logic (Now manual-save via button)
    async function saveCompanyFields(fieldsObj, isTemporary = false) {
        if (isSaving) return;
        isSaving = true;

        const companyName = $('.notebook-title').text().trim();
        const $activeStatusBtn = $('.btn-status-chip.active');
        const mgmtStatus = $activeStatusBtn.length ? $activeStatusBtn.data('value') : '';
        let finalMgmtStatus = mgmtStatus;
        if (mgmtStatus === '湲고?') {
            finalMgmtStatus = $('#mgmt-status-other').val().trim();
        }

        // ?꾩닔 ?낅젰 泥댄겕: 湲곗뾽紐? ?곗뾽, ?뚯궗?뚭컻, 愿由ы쁽??(?섏젙?섍린/??ν븯湲????뚮쭔 泥댄겕)
        const industry = fieldsObj.industry || "";
        const summary = fieldsObj.summary || "";

        if (!isTemporary) {
            if (!companyName || industry === '?좏깮?댁＜?몄슂' || (industry === '湲고?' && !$('#industry-other').val().trim()) || !summary || !mgmtStatus) {
                alert('湲곗뾽紐? ?곗뾽, ?뚯궗?뚭컻, 愿由ы쁽?⑹? ?꾩닔 ?낅젰 ??ぉ?낅땲??');
                isSaving = false;
                return;
            }
        }

        if (isNew && !companyName) {
            alert('湲곗뾽紐낆쓣 ?낅젰??二쇱꽭??');
            isSaving = false;
            return;
        }

        console.log(`?뮶 Saving fields (isNew: ${isNew}):`, Object.keys(fieldsObj));

        try {
            // 1. 濡쒖뺄 ?곗씠???낅뜲?댄듃
            if (!currentCompanyData) {
                currentCompanyData = { id: companyId, companyName: companyName, industry: industry || '湲고?', summary: '', attachments: [] };
            }

            for (const [field, value] of Object.entries(fieldsObj)) {
                currentCompanyData[field] = value;
            }
            currentCompanyData.companyName = companyName; // Always sync with editor
            currentCompanyData.managementStatus = finalMgmtStatus;

            // 2. [?곸꽭 ?뺣낫] 蹂묓빀 泥섎━ (?붿빟蹂?+ 硫뷀??곗씠??
            let rawSummary = currentCompanyData.summary || "";
            // 湲곗〈 ?붿빟?먯꽌 [?곸꽭 ?뺣낫] 釉붾줉 諛??댁떆?쒓렇 ?쒓굅 (以묐났 諛⑹?)
            let mainSummary = rawSummary.split('[?곸꽭 ?뺣낫]')[0].replace(/^#\S+\s*/, '').trim();

            let metaParts = [];

            if (currentCompanyData.managementStatus) metaParts.push(`愿由??꾪솴: ${currentCompanyData.managementStatus}`);
            if (currentCompanyData.discoveryPath) metaParts.push(`諛쒓뎬 寃쎈줈: ${currentCompanyData.discoveryPath}`);
            if (currentCompanyData.isInvested !== undefined) metaParts.push(`?ъ옄 ?좊Т: ${currentCompanyData.isInvested ? '?? : '臾?}`);
            if (currentCompanyData.valuation) metaParts.push(`?ъ옄 諛몃쪟: ${currentCompanyData.valuation}`);
            if (currentCompanyData.investmentAmount) metaParts.push(`?ъ옄 湲덉븸: ${currentCompanyData.investmentAmount}`);
            if (currentCompanyData.ceoName) metaParts.push(`??쒖옄紐? ${currentCompanyData.ceoName}`);
            if (currentCompanyData.companyEmail) metaParts.push(`?대찓?? ${currentCompanyData.companyEmail}`);
            if (currentCompanyData.establishmentDate) metaParts.push(`?ㅻ┰?쇱옄: ${currentCompanyData.establishmentDate}`);
            if (currentCompanyData.companyAddress) metaParts.push(`二쇱냼: ${currentCompanyData.companyAddress}`);
            if (currentCompanyData.investmentStatusDesc) metaParts.push(`?ъ옄 ?꾪솴:\n${currentCompanyData.investmentStatusDesc}`);
            if (currentCompanyData.financialStatusDesc) metaParts.push(`?щТ ?꾪솴:\n${currentCompanyData.financialStatusDesc}`);
            if (currentCompanyData.financialAnalysis) metaParts.push(`?щТ 遺꾩꽍: ${currentCompanyData.financialAnalysis}`);
            if (currentCompanyData.managerMemo) metaParts.push(`?대떦???섍껄: ${currentCompanyData.managerMemo}`);
            // Add seller-specific fields to metaParts
            if (currentCompanyData.saleMethod) metaParts.push(`留ㅻ룄 諛⑹떇: ${currentCompanyData.saleMethod}`);
            if (currentCompanyData.status) metaParts.push(`吏꾪뻾 ?꾪솴: ${currentCompanyData.status}`);


            let finalSummary = mainSummary;
            // 愿由??꾪솴???댁떆?쒓렇 ?뺤떇?쇰줈 ?쒕몢??異붽?
            if (currentCompanyData.managementStatus) {
                const tag = currentCompanyData.managementStatus.replace(/\s+/g, '');
                finalSummary = `#${tag}\n\n${mainSummary}`; // 媛꾧꺽???꾪빐 以꾨컮轅???踰?異붽?
            }

            if (metaParts.length > 0) {
                finalSummary += "\n\n[?곸꽭 ?뺣낫]\n" + metaParts.join('\n\n');
            }

            // 3. ?섏씠濡쒕뱶 援ъ꽦 (?좉퇋 ?깅줉??寃쎌슦 action: 'create', id ?쒖쇅)
            const payload = {
                table: fromSource === 'totalseller' ? 'sellers' : 'companies', // Use 'sellers' table if from totalseller
                action: isNew ? 'create' : 'update',
                user_id: user_id,
                companyName: companyName,
                industry: (currentCompanyData.industry === '?좏깮?댁＜?몄슂' || !currentCompanyData.industry) ? "湲고?" : currentCompanyData.industry,
                summary: finalSummary,
                attachments: Array.isArray(currentCompanyData.attachments) ? currentCompanyData.attachments : [],
                is_temporary: isTemporary,
                updated_at: new Date().toISOString()
            };

            // Add seller-specific fields to payload if from totalseller
            if (fromSource === 'totalseller') {
                payload.sale_price = currentCompanyData.salePrice;
                payload.sale_method = currentCompanyData.saleMethod;
                payload.status = currentCompanyData.status;
            }

            if (!isNew) {
                payload.id = companyId;
            } else {
                payload.created_at = new Date().toISOString();
            }

            const response = await APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
            const result = await response.json();

            if (result.error) throw new Error(result.error);
            console.log("??Save Success:", result);

            // ?좉퇋 ?깅줉 ??由ы꽩??ID濡??낅뜲?댄듃 (?꾩떆??????곗냽 ???媛?ν븯寃???
            if (isNew && result.id) {
                isNew = false;
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('id', result.id);
                window.history.replaceState({}, '', newUrl);
            }

            // ????깃났 ??湲곗뾽紐??섏젙 遺덇??ν븯寃?泥섎━
            $('.notebook-title').attr('contenteditable', 'false').css('cursor', 'default');

            // 4. ????깃났 ???뚮┝ 諛?由ъ뒪???대룞
            if (!isTemporary) {
                alert('??λ릺?덉뒿?덈떎.');
                window.location.href = './companies.html';
            }

        } catch (err) {
            console.error(`Failed to save:`, err);
            throw err;
        } finally {
            isSaving = false;
        }
    }

    // Individual field listeners removed to prevent unexpected auto-saves


    // Individual field listeners removed to prevent unexpected auto-saves



    // Close modal on click outside
    $summaryModal.on('click', function (e) {
        if ($(e.target).hasClass('modal-overlay')) {
            $summaryModal.hide();
        }
    });

    // Report Selection Modal Logic
    const $reportModal = $('#report-selection-modal');
    const $reportDetailModal = $('#report-gen-detail-modal');

    $('#open-report-modal').on('click', function () {
        $reportModal.css('display', 'flex');
    });

    $('#close-report-modal').on('click', function () {
        $reportModal.hide();
    });

    // Close detail modal
    $('#close-gen-detail-modal').on('click', function () {
        $reportDetailModal.hide();
    });

    // Back button logic
    $('#back-to-selection').on('click', function () {
        $reportDetailModal.hide();
        $reportModal.css('display', 'flex');
    });

    // Card click logic (Delegated for dynamic elements)
    $(document).on('click', '.report-card', function () {
        const reportId = $(this).data('id');
        const reportData = availableReportTypes.find(r => r.id === reportId);

        if (!reportData) return;

        // Update detail modal content
        $('#selected-report-title').text(reportData.title);
        $('#selected-report-desc').text(reportData.description);
        $('#report-instruction').val(reportData.instruction);

        // Transition modals
        $reportModal.hide();
        $reportDetailModal.css('display', 'flex');
    });

    // Click outside to close
    $(window).on('click', function (e) {
        if ($(e.target).is($reportModal)) {
            $reportModal.hide();
        }
        if ($(e.target).is($reportDetailModal)) {
            $reportDetailModal.hide();
        }
        if ($(e.target).is($sourceOptionModal)) {
            $sourceOptionModal.hide();
        }
        if ($(e.target).is($internalFileModal)) {
            $internalFileModal.hide();
            selectedInternalFiles = [];
            updateSelectedCount();
        }
        if ($(e.target).is($textInputModal)) {
            $textInputModal.hide();
        }
    });

    $('#start-generate-report').on('click', async function () {
        const instruction = $('#report-instruction').val().trim();
        const language = $('#report-language').val();
        const reportType = $('#selected-report-title').text();

        if (!instruction) {
            alert('留뚮뱾?ㅻ뒗 蹂닿퀬?쒖뿉 ????ㅻ챸???낅젰?댁＜?몄슂.');
            $('#report-instruction').focus();
            return;
        }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> ?앹꽦 以?..');

        try {
            // 1. Prompt Construction
            const prompt = `[Report Type] ${reportType}\n[Language] ${language}\n[Instruction] ${instruction}`;

            // 2. Context Gathering
            // 2.1 Company Info
            let companyInfo = "";
            const companyName = currentCompanyData?.companyName || $('.notebook-title').text() || "?뚯궗紐??놁쓬";
            const summary = currentCompanyData?.summary || $('#summary').val() || "";
            const industry = currentCompanyData?.industry || $('#industry').val() || "";

            if (companyName || summary || industry) {
                companyInfo = "=== ?뚯궗 湲곕낯 ?뺣낫 ===\n";
                if (companyName) companyInfo += `?뚯궗紐? ${companyName}\n`;
                if (industry) companyInfo += `?곗뾽: ${industry}\n`;
                if (summary) companyInfo += `?뚯궗?뚭컻: ${summary}\n`;
                companyInfo += "\n";
            }

            // 2.2 Conversation History
            const historyForPrompt = formatHistoryForPrompt(conversationHistory);

            // 2.3 RAG Search
            let ragContext = "";
            try {
                console.log("?뵇 Generating Report: Searching VectorDB...");
                ragContext = await searchVectorDB(`${reportType} 蹂닿퀬??愿???뺣낫`, companyId);
            } catch (e) {
                console.warn("RAG Search failed for report gen:", e);
            }

            // 3. Full Context Composition
            const fullContext = companyInfo + historyForPrompt + (ragContext ? "\n=== 愿??臾몄꽌 ?댁슜 ===\n" + ragContext : "");

            // 4. Generate AI Response
            const response = await addAiResponse(prompt, fullContext);
            const data = await response.json();
            const generatedContent = data.answer;

            if (generatedContent) {
                // 5. Download & Display
                downloadTextFile(`${reportType}.txt`, generatedContent);
                $reportDetailModal.hide();
                alert(`[${reportType} ?앹꽦 ?꾨즺]\n\n?뚯씪???ㅼ슫濡쒕뱶?섏뿀?듬땲??`);
            } else {
                throw new Error('?묐떟???앹꽦?????놁뒿?덈떎.');
            }
        } catch (error) {
            console.error('蹂닿퀬???앹꽦 ?ㅽ뙣:', error);
            alert('蹂닿퀬???앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + error.message);
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // Register Deal Modal Logic
    const $registerModal = $('#register-deal-modal');

    function openRegisterModal() {
        if (currentCompanyData) {
            $('input[name="company_name"]').val(currentCompanyData.companyName || '');
            $('textarea[name="summary"]').val($('#summary').val() || '');
            $('[name="industry"]').val($('#industry').val() || '');
            $('input[name="registrant"]').val(userData.name || '');
        }
        loadAvailableFiles(); // 紐⑤떖 ????理쒖떊??
        $registerModal.css('display', 'flex');
    }

    // Since #btn-register-deal is removed from top-bar, we rely on openRegisterModal()
    // but keeping this for any other buttons that might exist
    $('#btn-register-deal').on('click', openRegisterModal);

    $('#close-register-modal, #cancel-register').on('click', function () {
        $registerModal.hide();
    });

    // 怨듭쑀 ???蹂寃?媛먯?
    $('input[name="share_type"]').on('change', function () {
        if ($(this).val() === 'select') {
            $('#share-target-wrapper').css('display', 'flex');
        } else {
            $('#share-target-wrapper').hide();
        }
    });

    // 怨듭쑀 ???諛??뚯씪 ?쒓렇 ?쒖뒪??
    let selectedShareTargets = [];
    let selectedSharedFiles = [];

    // ?뚯씪 怨듭쑀 ?낅젰李??대깽??
    $('#share-file-input').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = $(this).val().trim();
            const queryLower = query.toLowerCase();

            if (query) {
                const searchTerms = queryLower.split(/\s+/).filter(t => t);
                // availableFiles?먯꽌 ?ㅼ썙???ы븿?섎뒗 ?뚯씪 紐⑤몢 李얘린
                const matches = availableFiles.filter(file => {
                    const fileName = (file.name || "").toLowerCase();
                    return searchTerms.every(term => fileName.includes(term));
                });

                if (matches.length > 0) {
                    matches.forEach(file => {
                        if (!selectedSharedFiles.some(f => f.name === file.name)) {
                            selectedSharedFiles.push(file);
                        }
                    });
                } else {
                    if (!selectedSharedFiles.some(f => f.name === query)) {
                        selectedSharedFiles.push({
                            id: 'new-' + Date.now(),
                            name: query
                        });
                    }
                }

                searchResults = [];
                $(this).val('');
                renderSharedFileChips();
            }
        }
    });

    $('#share-file-input').on('input', function () {
        const query = $(this).val().toLowerCase().normalize('NFC');
        const searchTerms = query.trim().split(/\s+/).filter(t => t.length >= 2);

        if (searchTerms.length > 0) {
            searchResults = availableFiles
                .filter(file => {
                    const fileName = (file.name || "").toLowerCase().normalize('NFC');
                    return searchTerms.every(term => fileName.includes(term));
                })
                .slice(0, 5);
        } else {
            searchResults = [];
        }
        renderSharedFileChips();
    });

    function renderSharedFileChips() {
        const $container = $('#shared-files-container');
        $container.empty();

        // 寃??寃곌낵 ?쒖떆
        if (searchResults.length > 0) {
            searchResults.forEach((file) => {
                const isSelected = selectedSharedFiles.some(f => f.name === file.name);
                if (!isSelected) {
                    const $chip = $(`
                        <div class="share-tag suggestion-chip" data-id="${file.id}" style="border-style: dashed; background: #ffffff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 16px; color: var(--primary-color);">add_circle</span>
                            <span>${file.name}</span>
                        </div>
                    `);
                    $chip.on('click', function () {
                        selectedSharedFiles.push(file);
                        $('#share-file-input').val('');
                        searchResults = [];
                        renderSharedFileChips();
                    });
                    $container.append($chip);
                }
            });

            if (searchResults.some(file => !selectedSharedFiles.some(f => f.name === file.name))) {
                $container.append('<div style="width: 100%; height: 1px; background: #eee; margin: 8px 0; flex-basis: 100%;"></div>');
            }
        }

        // ?좏깮???뚯씪 ?쒖떆
        selectedSharedFiles.forEach((file, index) => {
            const fileUrl = file.location ? (file.location.startsWith('http') ? file.location : (SUPABASE_STORAGE_URL + file.location)) : '#';
            const $tag = $(`
                <div class="share-tag" data-id="${file.id}">
                    <a href="${fileUrl}" target="_blank" style="display: flex; align-items: center; color: inherit; text-decoration: none;">
                        <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">attachment</span>
                    </a>
                    <span>${file.name}</span>
                    <span class="material-symbols-outlined remove-file-tag" data-index="${index}" style="cursor: pointer; font-size: 16px;">close</span>
                </div>
            `);
            $container.append($tag);
        });
    }

    $(document).on('click', '.remove-file-tag', function () {
        const index = $(this).data('index');
        selectedSharedFiles.splice(index, 1);
        renderSharedFileChips();
    });

    $('#share-with-input').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const name = $(this).val().trim();
            if (name && !selectedShareTargets.includes(name)) {
                selectedShareTargets.push(name);
                renderShareTags();
                $(this).val('');
            }
        }
    });

    function renderShareTags() {
        const $container = $('#share-tags-container');
        $container.empty();
        selectedShareTargets.forEach((name, index) => {
            const $tag = $(`
                <div class="share-tag">
                    <span>${name}</span>
                    <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>
                </div>
            `);
            $container.append($tag);
        });
    }

    $(document).on('click', '.remove-tag', function () {
        const index = $(this).data('index');
        selectedShareTargets.splice(index, 1);
        renderShareTags();
    });

    // ?깅줉?섍린 踰꾪듉 ?대┃
    $('#save-deal').on('click', function () {
        const now = new Date().toISOString();
        const formData = {
            companyId: companyId,
            companyName: $('input[name="company_name"]').val(),
            summary: $('textarea[name="summary"]').val(),
            industry: $('[name="industry"]').val(),
            sale_method: $('[name="sale_method"]').val(),
            sale_price: $('input[name="sale_price"]').val(),
            user_id: user_id,
            others: $('textarea[name="others"]').val(),
            share_files: selectedSharedFiles,
            share_type: $('input[name="share_type"]:checked').val(),
            share_with: selectedShareTargets,
            created_at: now,
            updated_at: now
        };

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('?깅줉 以?..');

        // Payload 援ъ꽦
        const payload3 = {
            ...formData,
            table: 'sellers',
            action: 'upload'
        };

        APIcall(payload3, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('?깅줉 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + result.error);
                } else {
                    alert('留ㅻЪ???깅줉?섏뿀?듬땲??');
                    $registerModal.hide();

                    // ??諛??곹깭 珥덇린??
                    $('#register-deal-form')[0].reset();
                    selectedShareTargets = [];
                    selectedSharedFiles = [];
                    renderShareTags();
                    renderSharedFileChips();
                    $('#share-target-wrapper').hide();
                }
            })
            .catch(error => {
                console.error('?깅줉 ?붿껌 ?ㅽ뙣:', error);
                alert('?깅줉 ?붿껌???ㅽ뙣?덉뒿?덈떎.');
            })
            .finally(() => {
                $btn.prop('disabled', false).text(originalText);
            });
    });

    $registerModal.on('click', function (e) {
        if ($(e.target).hasClass('modal-overlay')) {
            $registerModal.hide();
        }
    });

    // --- Source Add Modals & File Management Logic ---
    const $fileUpload = $('#file-upload');
    const $sourceOptionModal = $('#source-option-modal');
    const $internalFileModal = $('#internal-file-modal');
    const $textInputModal = $('#text-input-modal');
    let selectedInternalFiles = [];

    // Helper: Build File Item HTML & Bind Events
    function addFileToSourceList(name, id, location, isTraining = true, isFinance = false) {
        let targetListId = isTraining ? '#source-list-training' : '#source-list-non-training';
        if (isFinance) targetListId = '#source-list-finance';
        const $list = $(targetListId);

        if ($list.find(`[data-id="${id}"]`).length > 0) return;

        const icon = getFileIcon(name);
        const fileUrl = location ? (location.startsWith('http') ? location : (SUPABASE_STORAGE_URL + location)) : '#';

        const fileHtml = `
            <li class="source-item" data-id="${id}" data-location="${location}">
                <span class="material-symbols-outlined" style="font-size: 18px;">${icon}</span>
                <a href="${fileUrl}" target="_blank" class="source-name" style="text-decoration: none; color: inherit; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name}">${name}</a>
                <button class="btn-delete-source" title="??젣">
                    <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
                </button>
            </li>
        `;

        const $item = $(fileHtml);
        $list.append($item);

        // Delete Event
        $item.find('.btn-delete-source').on('click', async function (e) {
            e.stopPropagation();
            e.preventDefault();

            if (!confirm(`'${name}' ?뚯뒪瑜???젣?섏떆寃좎뒿?덇퉴?`)) return;

            const $btn = $(this);
            $btn.find('.material-symbols-outlined').text('sync').addClass('spin');

            try {
                // 1. Remove from Company Attachments (Handle both string ID and object {id, isTraining})
                const newAttachments = (currentCompanyData.attachments || []).filter(item => {
                    const itemId = (typeof item === 'object' && item !== null) ? item.id : item;
                    return itemId !== id;
                });

                const updatePayload = {
                    ...currentCompanyData,
                    attachments: newAttachments,
                    table: 'companies',
                    action: 'update',
                    user_id: user_id,
                    updated_at: new Date().toISOString()
                };

                // 2. Optional: Remove from Vector DB if it was training data
                // For simplicity, we just disconnect it from the company in the DB first.
                // Complete file deletion from storage is handled by fileDelete if desired.

                await APIcall(updatePayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });

                // 3. UI update
                $item.fadeOut(300, function () { $(this).remove(); });
                currentCompanyData.attachments = newAttachments;

            } catch (err) {
                console.error('Delete failed:', err);
                alert('??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
                $btn.find('.material-symbols-outlined').text('close').removeClass('spin');
            }
        });

        // Selection Visuals
        $item.on('click', function () {
            $('.source-item').removeClass('active');
            $item.addClass('active');
        });
    }

    // Main File Upload Trigger
    $fileUpload.on('change', async function (e) {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const isTraining = currentUploadIsTraining;
        const $targetList = isTraining ? $('#source-list-training') : $('#source-list-non-training');

        // Use companyId for vectorNamespace ONLY if isTraining is true
        const vectorNamespace = isTraining ? companyId : null;

        for (const file of files) {
            if (!filetypecheck(file)) continue;

            const $tempItem = $(`
                <li class="source-item uploading">
                    <span class="material-symbols-outlined spin">${getFileIcon(file.name)}</span>
                    <span class="source-name">${file.name} (?낅줈??以?..)</span>
                </li>
            `);
            $targetList.append($tempItem);

            try {
                const fetchResponse = await fileUpload(file, user_id, companyId, null, vectorNamespace);
                const result = await fetchResponse.json();

                if (result && (result.id || (Array.isArray(result) && result[0].id))) {
                    const newFileId = result.id || result[0].id;
                    const fileLocation = result.location || result[0].location;

                    // Update Company Attachments
                    if (currentCompanyData) {
                        if (!currentCompanyData.attachments) currentCompanyData.attachments = [];

                        // Check if already exists (comparing by id)
                        const alreadyExists = currentCompanyData.attachments.some(item => {
                            const itemId = (typeof item === 'object' && item !== null) ? item.id : item;
                            return itemId === newFileId;
                        });

                        const isTraining = (currentSourceType === 'training' || currentSourceType === 'finance');
                        const isFinance = (currentSourceType === 'finance');

                        if (!alreadyExists) {
                            currentCompanyData.attachments.push({ id: newFileId, isTraining: isTraining, isFinance: isFinance });
                            const updatePayload = {
                                ...currentCompanyData,
                                table: 'companies',
                                action: 'update',
                                user_id: user_id,
                                updated_at: new Date().toISOString()
                            };
                            await APIcall(updatePayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
                        }
                    }

                    $tempItem.remove();
                    addFileToSourceList(file.name, newFileId, fileLocation, (currentSourceType === 'training' || currentSourceType === 'finance'), (currentSourceType === 'finance'));

                    // Add to available files for other uses
                    availableFiles.push({
                        id: newFileId,
                        name: file.name,
                        user_id: user_id,
                        location: fileLocation,
                        vectorNamespace: vectorNamespace
                    });
                } else {
                    throw new Error('Upload response invalid');
                }
            } catch (err) {
                console.error(`Upload error for ${file.name}:`, err);
                $tempItem.find('.source-name').text(`${file.name} (?ㅽ뙣)`);
                $tempItem.find('.material-symbols-outlined').text('error').removeClass('spin').css('color', '#1E293B');

                // ?먮윭 諛쒖깮 ??紐⑸줉?먯꽌 ??젣 (?ъ슜???붿껌 諛섏쁺)
                setTimeout(() => {
                    $tempItem.fadeOut(300, function () { $(this).remove(); });
                }, 2000);
            }
        }
        $(this).val(''); // Reset input
    });

    // Modal & Button Handlers
    $('#add-source-training').on('click', function () {
        currentSourceType = 'training';
        $sourceOptionModal.css('display', 'flex');
    });

    $('#add-source-finance').on('click', function () {
        currentSourceType = 'finance';
        $sourceOptionModal.css('display', 'flex');
    });

    $('#add-source-non-training').on('click', function () {
        currentSourceType = 'non-training';
        $sourceOptionModal.css('display', 'flex');
    });

    $('#btn-ai-teaser').on('click', function () {
        $('#btn-register-deal').trigger('click');
    });

    $('#close-source-option-modal').on('click', () => $sourceOptionModal.hide());

    $('#btn-upload-local').on('click', function () {
        $sourceOptionModal.hide();
        $fileUpload.click();
    });

    $('#btn-select-internal').on('click', function () {
        $sourceOptionModal.hide();
        $('#internal-file-search').val('');
        renderInternalFileList();
        $internalFileModal.css('display', 'flex');
    });

    $('#btn-input-text').on('click', function () {
        $sourceOptionModal.hide();
        $('#text-input-filename').val('');
        $('#text-input-content').val('');
        $textInputModal.css('display', 'flex');
    });

    $('#close-text-input-modal, #cancel-text-input').on('click', () => $textInputModal.hide());

    $('#save-text-input').on('click', async function () {
        const filename = $('#text-input-filename').val().trim();
        const content = $('#text-input-content').val().trim();
        if (!filename || !content) { alert('?뚯씪紐낃낵 ?댁슜??紐⑤몢 ?낅젰?댁＜?몄슂.'); return; }

        const finalFilename = filename.includes('.') ? filename : filename + '.txt';
        const isTraining = (currentSourceType === 'training' || currentSourceType === 'finance');
        const isFinance = (currentSourceType === 'finance');
        const vectorNamespace = isTraining ? companyId : null;

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('???以?..');

        try {
            const sanitizedContent = sanitizeTextForJSON(content);
            const blob = new Blob([sanitizedContent], { type: 'text/plain' });
            const file = new File([blob], finalFilename, { type: 'text/plain' });

            const fetchResponse = await fileUpload(file, user_id, companyId, sanitizedContent, vectorNamespace);
            const result = await fetchResponse.json();

            if (result && (result.id || result[0]?.id)) {
                const newFileId = result.id || result[0].id;
                const fileLocation = result.location || result[0].location;

                if (currentCompanyData) {
                    if (!currentCompanyData.attachments) currentCompanyData.attachments = [];
                    currentCompanyData.attachments.push({ id: newFileId, isTraining: isTraining, isFinance: isFinance });
                    await APIcall({ ...currentCompanyData, table: 'companies', action: 'update', user_id: user_id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
                }

                addFileToSourceList(finalFilename, newFileId, fileLocation, isTraining, isFinance);
                $textInputModal.hide();
                alert('??λ릺?덉뒿?덈떎.');
            }
        } catch (error) {
            console.error('Text save error:', error);
            alert('??μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // Internal File Selection Logic
    $('#close-internal-file-modal, #cancel-internal-selection').on('click', () => {
        $internalFileModal.hide();
        selectedInternalFiles = [];
        $('#selected-count').text('0');
    });

    $('#internal-file-search').on('input', function () {
        renderInternalFileList($(this).val());
    });

    function renderInternalFileList(query = "") {
        const $list = $('#internal-file-list');
        $list.empty();

        // Handle both string IDs and {id, isTraining} objects in attachments
        const attachedIds = (currentCompanyData?.attachments || []).map(item => {
            return (typeof item === 'object' && item !== null) ? item.id : item;
        });

        const normalizedQuery = query.toLowerCase().normalize('NFC');

        const filtered = availableFiles.filter(f => {
            const nameMatch = !query || f.name.toLowerCase().normalize('NFC').includes(normalizedQuery);
            return nameMatch && !attachedIds.includes(f.id);
        });

        if (filtered.length === 0) { $list.append('<li class="list-group-item text-center">?뚯씪???놁뒿?덈떎.</li>'); return; }

        filtered.forEach(file => {
            const isSelected = selectedInternalFiles.some(f => f.id === file.id);
            const $el = $(`
                <li class="list-group-item d-flex align-items-center gap-3" style="cursor: pointer;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events: none;">
                    <span class="material-symbols-outlined">${getFileIcon(file.name)}</span>
                    <span style="flex: 1;">${file.name}</span>
                </li>
            `);
            $el.on('click', () => {
                const cb = $el.find('input');
                const checked = !cb.prop('checked');
                cb.prop('checked', checked);
                if (checked) selectedInternalFiles.push(file);
                else selectedInternalFiles = selectedInternalFiles.filter(f => f.id !== file.id);
                $('#selected-count').text(selectedInternalFiles.length);
            });
            $list.append($el);
        });
    }

    $('#confirm-internal-select').on('click', async function () {
        if (selectedInternalFiles.length === 0) return;
        const $btn = $(this);
        const originalText = $btn.text();
        const isTraining = (currentSourceType === 'training' || currentSourceType === 'finance');
        const isFinance = (currentSourceType === 'finance');
        const vectorNamespace = isTraining ? companyId : null;

        $btn.prop('disabled', true).text('異붽? 以?..');
        try {
            const newAttachments = [...(currentCompanyData.attachments || [])];
            for (const fileData of selectedInternalFiles) {
                // If it's Training Data, we need to INDEX it even if it already exists globally
                if (isTraining) {
                    try {
                        const fileUrl = fileData.location.startsWith('http') ? fileData.location : (SUPABASE_STORAGE_URL + fileData.location);
                        const res = await fetch(fileUrl);
                        const blob = await res.blob();
                        const file = new File([blob], fileData.name, { type: blob.type });

                        let text = "";
                        if (file.name.endsWith('.pdf')) text = await extractTextFromPDF(file);
                        else if (file.name.endsWith('.docx')) text = await extractTextFromDocx(file);
                        else if (file.name.endsWith('.txt')) text = await extractTextFromTxt(file);

                        if (validateText(text).valid) {
                            await APIcall({
                                action: 'index_existing',
                                table: 'companies',
                                parsedText: sanitizeTextForJSON(text),
                                fileId: fileData.id,
                                file_name: fileData.name,
                                vectorNamespace: companyId,
                                user_id: user_id
                            }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
                        }
                    } catch (e) { console.warn('Indexing failed for internal file:', fileData.name); }
                }
                newAttachments.push({ id: fileData.id, isTraining: isTraining, isFinance: isFinance });
                addFileToSourceList(fileData.name, fileData.id, fileData.location, isTraining, isFinance);
            }

            await APIcall({ ...currentCompanyData, attachments: newAttachments, table: 'companies', action: 'update', user_id: user_id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
            currentCompanyData.attachments = newAttachments;
            $internalFileModal.hide();
            selectedInternalFiles = [];
        } catch (err) {
            console.error('Internal select failed:', err);
            alert('?뚯씪 異붽????ㅽ뙣?덉뒿?덈떎.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // Helper: Icons
    function getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
            case 'pdf': return 'description';
            case 'doc':
            case 'docx': return 'article';
            case 'txt': return 'text_fields';
            default: return 'attachment';
        }
    }

    // History & User Menu
    $('#clear-history-btn').on('click', async function () {
        if (!confirm('????댁슜??珥덇린?뷀븯?쒓쿋?듬땲源?')) return;
        try {
            conversationHistory = [];
            $chatMessages.empty();
            $welcomeScreen.show();
            if (currentCompanyData) {
                await APIcall({ id: companyId, table: 'companies', action: 'update', user_id: user_id, history: [] }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' });
            }
        } catch (err) { alert('珥덇린???ㅽ뙣'); }
    });

    $('#user-menu-trigger').on('click', (e) => { e.stopPropagation(); $('#user-menu-dropdown').fadeToggle(150); });
    $(document).on('click', () => $('#user-menu-dropdown').fadeOut(150));
    $('#btn-signout').on('click', () => { if (confirm('濡쒓렇?꾩썐 ?섏떆寃좎뒿?덇퉴?')) { localStorage.removeItem('dealchat_users'); location.href = '../index.html'; } });
    $('#btn-signout').on('click', () => { if (confirm('濡쒓렇?꾩썐 ?섏떆寃좎뒿?덇퉴?')) { localStorage.removeItem('dealchat_users'); location.href = '../index.html'; } });

    // === Share Button Logic (Matching MY COMPANIES) ===

    // 1. Open Share Options Modal
    $('#btn-share-db-trigger').on('click', () => {
        $('#share-options-modal').css('display', 'flex');
    });

    // Close Options Modal
    $('#close-share-options').on('click', () => {
        $('#share-options-modal').hide();
    });

    // 2. Share by URL
    $('#btn-share-url-db').on('click', () => {
        // Construct the Dealbook URL with read-only parameter
        const url = new URL(window.location.href);
        url.searchParams.set('from', 'totalstartup');
        const dealbookUrl = url.toString();

        navigator.clipboard.writeText(dealbookUrl).then(() => {
            alert('湲곗뾽 ?뺣낫 留곹겕媛 ?대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            $('#share-options-modal').hide();
        }).catch(err => {
            console.error("Failed to copy URL to clipboard:", err);
            // Fallback for older browsers
            const tempInput = document.createElement("input");
            tempInput.value = dealbookUrl;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
            alert('湲곗뾽 ?뺣낫 留곹겕媛 ?대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
            $('#share-options-modal').hide();
        });
    });

    // 3. Open User Share Modal & Load Users
    $('#btn-share-with-user-trigger').on('click', () => {
        $('#share-options-modal').hide();

        APIcall({ action: 'get', table: 'users' }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(res => res.json())
            .then(users => {
                const $select = $('#direct-share-receiver');
                $select.html('<option value="">?섏떊?먮? ?좏깮?섏꽭??..</option>');
                if (Array.isArray(users)) {
                    users.forEach(u => {
                        $select.append(`<option value="${u.id}">${u.name} (${u.company || 'DealChat'})</option>`);
                    });
                }
                $('#user-share-modal').css('display', 'flex');
            })
            .catch(error => {
                console.error("Failed to fetch users for sharing:", error);
                alert("?ъ슜??紐⑸줉??遺덈윭?ㅻ뒗 ???ㅽ뙣?덉뒿?덈떎.");
            });
    });

    // Close User Share Modal
    $('#close-user-share, #cancel-user-share').on('click', () => {
        $('#user-share-modal').hide();
        $('#direct-share-receiver').val('');
        $('#direct-share-memo').val('');
    });

    // 4. Submit User Share (INSERT into shared_companies)
    $('#submit-user-share').on('click', function () {
        const receiverId = $('#direct-share-receiver').val();
        const memo = $('#direct-share-memo').val().trim();

        if (!receiverId) {
            alert('?섏떊?먮? ?좏깮??二쇱꽭??');
            return;
        }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('?꾩넚 以?..');

        const payload = {
            table: 'shared_companies',
            action: 'create',
            company_id: companyId,
            sender_id: user_id,
            receiver_id: receiverId,
            memo: memo,
            is_read: false
        };

        APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                alert('??먯뿉寃??깃났?곸쑝濡?湲곗뾽 ?뺣낫瑜?怨듭쑀?덉뒿?덈떎.');
                $('#user-share-modal').hide();
                $('#direct-share-receiver').val('');
                $('#direct-share-memo').val('');
            })
            .catch(error => {
                console.error('Share Error:', error);
                alert('怨듭쑀 ?꾩넚 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + (error.message || '?????녿뒗 ?ㅻ쪟'));
            })
            .finally(() => {
                $btn.prop('disabled', false).text(originalText);
            });
    });

    // Overlay click to close modals
    $('.modal-overlay').on('click', function (e) {
        if ($(e.target).closest('.modal-content, .modal-content-report').length === 0) {
            $(this).hide();
            // Reset fields
            $('#direct-share-receiver').val('');
            $('#direct-share-memo').val('');
        }
    });

    // PDF Download Functionality (Unified Trigger)
    $(document).on('click', '#btn-download-pdf, #btn-save-pdf-db, #btn-pdf-download', function () {
        // Close modal if it's open
        const optionsModalEl = document.getElementById('share-options-modal');
        if (optionsModalEl) {
            const modal = bootstrap.Modal.getInstance(optionsModalEl);
            if (modal) modal.hide();
        }

        const companyName = $('.notebook-title').text().trim() || 'Enterprise_Info';
        const isReadingMode = $('.report-text-content').length > 0;

        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 22px;">sync</span>');

        // =========================================================
        // [Reading Mode] ?대줎??A4 怨좎젙 ?덈퉬濡??ㅽ봽?ㅽ겕由?諛곗튂 ??罹≪쿂
        // =========================================================
        if (isReadingMode) {
            const $src = $('.sidebar');
            const $rmClone = $src.clone();

            // ?쎄린 紐⑤뱶 ?꾩슜 ?띿뒪?몃? 蹂댁〈?섍린 ?꾪빐 inline ?④꺼吏?textarea ?쒓굅
            $rmClone.find('textarea[style*="display: none"], textarea[style*="display:none"]').remove();

            // 遺덊븘?뷀븳 UI ?쒓굅 (踰꾪듉, 紐⑤떖 ??
            $rmClone.find('#btn-pdf-download, .modal-overlay, #report-watermark').remove();

            // ?대줎 ?먯껜 ?ㅽ???由ъ뀑 ??A4 ?꾪룺 ?ъ슜
            $rmClone.css({
                'width': '794px',
                'max-width': 'none',
                'margin': '0',
                'padding': '0',
                'height': 'auto',
                'overflow': 'visible',
                'display': 'block',
                'background': '#ffffff',
                'border': 'none',
                'box-shadow': 'none',
                'border-radius': '0'
            });

            // sidebar-nav ?ㅽ겕濡??댁젣
            $rmClone.find('.sidebar-nav').css({
                'height': 'auto',
                'max-height': 'none',
                'overflow': 'visible'
            });

            // ?대줎???ㅽ봽?ㅽ겕由?而⑦뀒?대꼫??諛곗튂
            const rmContainer = document.createElement('div');
            rmContainer.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;';
            rmContainer.appendChild($rmClone[0]);
            document.body.appendChild(rmContainer);

            const opt = {
                margin: [0, 0],
                filename: `${companyName}_?뺣낫.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    letterRendering: true,
                    logging: false,
                    scrollY: 0,
                    windowWidth: 794,
                    width: 794
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'] }
            };

            html2pdf().set(opt).from($rmClone[0]).toPdf().get('pdf').then(function (pdf) {
                const totalPages = pdf.internal.getNumberOfPages();
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                for (let i = 1; i <= totalPages; i++) {
                    pdf.setPage(i);
                    pdf.setFontSize(9);
                    pdf.setTextColor(180, 180, 180);
                    pdf.text(`CONFIDENTIAL - ${companyName} 湲곗뾽 ?뺣낫 - Page ${i}/${totalPages}`,
                        pageWidth / 2, pageHeight - 8, { align: 'center' });
                }
            }).save()
                .then(() => {
                    document.body.removeChild(rmContainer);
                    $btn.prop('disabled', false).html(originalHtml);
                })
                .catch(err => {
                    console.error('PDF generation failed:', err);
                    alert('PDF ?앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
                    document.body.removeChild(rmContainer);
                    $btn.prop('disabled', false).html(originalHtml);
                });
            return;
        }

        // =========================================================
        // [Editor Mode] ???붿냼瑜??띿뒪?몃줈 蹂????罹≪쿂
        // =========================================================
        const $source = $('.sidebar');
        if (!$source.length) {
            $btn.prop('disabled', false).html(originalHtml);
            return;
        }

        const opt = {
            margin: [15, 12],
            filename: `${companyName}_?뺣낫.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: 'avoid-all' }
        };

        const $clone = $source.clone();

        // A. ?ㅼ젣 DOM?먯꽌 媛??숆린??(clone()? ?꾨줈?쇳떚 媛믪쓣 蹂듭궗?섏? ?딆쓬)
        $source.find('input, textarea, select').each(function(index) {
            const $orig = $(this);
            const $cloneEl = $clone.find('input, textarea, select').eq(index);
            if ($orig.is('select')) {
                $cloneEl.prop('selectedIndex', this.selectedIndex);
            } else {
                $cloneEl.val($orig.val());
            }
        });

        // B. 愿由ы쁽??移????띿뒪??諛곗?
        const $activeChip = $source.find('.btn-status-chip.active');
        const mgmtText = $activeChip.data('value') === '湲고?'
            ? ($source.find('#mgmt-status-other').val() || '湲고?')
            : ($activeChip.data('value') || '-');

        $clone.find('#mgmt-status-group').replaceWith(`
            <div style="margin:4px 0;">
                <span style="background:#1A73E8;color:#fff;padding:4px 14px;border-radius:100px;font-size:13px;font-weight:600;">${mgmtText}</span>
            </div>
        `);

        // C. ?ъ옄/?щТ ?뚯씠釉?
        const buildTable = (sectionId, rowsSel, headers, cellClasses) => {
            const $section = $clone.find(sectionId);
            const $rows = $source.find(rowsSel + ' > div');
            if (!$rows.length) return;
            const th = `background:#f8fafc;color:#1e293b;font-weight:700;font-size:11px;padding:10px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;text-align:center;`;
            const td = `padding:10px;border-bottom:1px solid #f1f5f9;color:#475569;`;
            let html = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:10px 0 20px 0;"><thead><tr>`;
            headers.forEach(h => html += `<th style="${th}">${h}</th>`);
            html += `</tr></thead><tbody>`;
            $rows.each(function() {
                html += `<tr>`;
                cellClasses.forEach(c => {
                    const v = $(this).find('.' + c).val() || '';
                    const isNum = ['inv-amount','inv-valuation','fin-revenue','fin-op','fin-net'].includes(c);
                    html += `<td style="${td}text-align:${isNum ? 'right' : 'center'};">${v}</td>`;
                });
                html += `</tr>`;
            });
            html += `</tbody></table>`;
            const label = $section.find('p').first().text().trim();
            $section.empty().append(`<p style="color:#1A73E8;font-weight:700;margin-bottom:8px;font-size:13px;">${label}</p>`).append(html);
        };

        buildTable('#investment-section', '#investment-rows',
            ['?꾨룄', '?④퀎', '踰⑤쪟(??', '湲덉븸(??', '?ъ옄??],
            ['inv-year', 'inv-stage', 'inv-valuation', 'inv-amount', 'inv-investor']);
        buildTable('#financial-section', '#financial-rows',
            ['?꾨룄', '留ㅼ텧????', '?곸뾽?댁씡(??', '?밴린?쒖씡(??'],
            ['fin-year', 'fin-revenue', 'fin-op', 'fin-net']);

        // D. ?섎㉧吏 ???붿냼 ???띿뒪??div
        $clone.find('input, textarea, select').each(function() {
            const $el = $(this);
            const id = $el.attr('id') || '';
            const style = $el.attr('style') || '';
            const isHidden = style.includes('display: none') || style.includes('display:none');
            const val = $el.val() || '';

            if (id === 'industry') {
                const srcSel = $source.find('#industry');
                const text = srcSel.val() === '湲고?'
                    ? ($source.find('#industry-other').val() || '湲고?')
                    : srcSel.find('option:selected').text();
                $el.closest('div').replaceWith(`<div style="font-size:15px;color:#1e293b;font-weight:500;margin-bottom:10px;">${text}</div>`);
                return;
            }
            if (id === 'industry-other' || id === 'mgmt-status-other') { $el.remove(); return; }
            if ($el.closest('#mgmt-status-group').length) { return; }

            if (isHidden) { $el.remove(); return; }

            const isTitle = id === 'notebook-title-editor';
            const isLong = $el.is('textarea');
            const $div = $(`<div></div>`).css({
                'width': '100%',
                'font-size': isTitle ? '16px' : '15px',
                'font-weight': isTitle ? '700' : '400',
                'color': isTitle ? '#1e293b' : '#475569',
                'line-height': '1.6',
                'white-space': 'pre-wrap',
                'word-break': 'break-word',
                'margin-bottom': isLong ? '16px' : '8px',
            }).text(val || '-');
            $el.replaceWith($div);
        });

        // E. 遺덊븘??UI ?쒓굅
        $clone.find('button, .btn-remove-row, .btn-new-source, #ai-auto-fill-btn, .modal-overlay, .btn-status-chip, .btn-icon-only').remove();

        // F. ?덉씠釉??됱긽
        $clone.find('.sidebar-nav p').css({ 'color': '#1A73E8', 'font-weight': '700', 'font-size': '13px' });

        // G. ?ㅻ뜑 ?ㅽ???
        $clone.find('.panel-header').css({
            'background': '#1A73E8', 'color': '#ffffff', 'height': '60px',
            'display': 'flex', 'align-items': 'center', 'justify-content': 'center',
            'border': 'none', 'margin-bottom': '30px', 'border-radius': '0'
        }).find('h1, h2, span').css({ 'color': '#ffffff', 'margin': '0', 'font-size': '18px', 'font-weight': '700' });

        // H. ?꾩껜 ?대줎 ?덉씠?꾩썐
        $clone.css({ 'width': '100%', 'max-width': 'none', 'height': 'auto', 'background': '#ffffff',
            'padding': '0', 'margin': '0', 'overflow': 'visible', 'display': 'block' });
        $clone.find('.sidebar-nav').css({ 'padding': '0 40px 40px 40px', 'height': 'auto', 'overflow': 'visible' });

        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;';
        container.appendChild($clone[0]);
        document.body.appendChild(container);

        html2pdf().set(opt).from($clone[0]).toPdf().get('pdf').then(function (pdf) {
            const n = pdf.internal.getNumberOfPages();
            const pw = pdf.internal.pageSize.getWidth();
            const ph = pdf.internal.pageSize.getHeight();
            for (let i = 1; i <= n; i++) {
                pdf.setPage(i);
                pdf.setFontSize(9);
                pdf.setTextColor(180, 180, 180);
                pdf.text(`CONFIDENTIAL - ${companyName} 湲곗뾽 ?뺣낫 - Page ${i}/${n}`, pw / 2, ph - 8, { align: 'center' });
            }
        }).save()
            .then(() => {
                document.body.removeChild(container);
                $btn.prop('disabled', false).html(originalHtml);
            })
            .catch(err => {
                console.error('PDF generation failed:', err);
                alert('PDF ?앹꽦 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
                document.body.removeChild(container);
                $btn.prop('disabled', false).html(originalHtml);
            });
    });


    // Close modals on overlay click (Handled by Bootstrap)

    function applyReadOnlyMode() {
        console.log('?썳截?Applying Professional Report Mode');
        
        const isSeller = (fromSource === 'totalseller');
        const primaryColor = isSeller ? '#8b5cf6' : '#1A73E8'; // SELLER 蹂대씪??vs 湲곕낯 ?뚮???
        
        // 1. Add specialized CSS for Report Mode
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
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08) !important;
                height: auto !important;
                overflow: hidden !important;
                display: block !important;
                border-radius: 20px !important;
            }

            /* Header Branding */
            .sidebar .panel-header {
                background-color: var(--report-primary) !important;
                color: #ffffff !important;
                border-top-left-radius: 19px !important; /* border ?먭퍡 怨좊젮 */
                border-top-right-radius: 19px !important;
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: 0 !important;
                height: 55px !important;
                margin-bottom: 25px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border: none !important;
            }

            .sidebar .panel-header h2,
            .sidebar .panel-header h1 {
                color: #ffffff !important;
                font-size: 14px !important;
                font-weight: 600 !important;
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }

            .sidebar .panel-header h2 span,
            .sidebar .panel-header h1 span {
                color: #ffffff !important;
                font-size: 18px !important;
            }

            .sidebar-nav {
                padding: 0 40px 40px 40px !important;
            }

            /* Content Module Spacing */
            /* 湲곕낯: 紐⑤뱺 吏곴퀎 div 36px 媛꾧꺽 */
            .sidebar-nav > div {
                margin-bottom: 36px !important;
                margin-top: 0 !important;
            }

            /* 2??flex row (湲곗뾽紐??곗뾽, ??쒖옄紐??대찓?? ?ㅻ┰?쇱옄/二쇱냼): 20px濡?醫곴쾶 */
            .sidebar-nav > div[style*="display: flex"][style*="gap"] {
                margin-bottom: 20px !important;
            }

            /* label 而⑦뀒?대꼫(justify-content:space-between) ?섎떒 ?щ갚 ?쒓굅 - ?덉씠釉붴넂媛?媛꾧꺽? p margin???대떦 */
            .sidebar-nav div[style*="justify-content: space-between"] {
                margin-bottom: 0 !important;
                padding-bottom: 0 !important;
            }


            /* Labels */
            .sidebar-nav p {
                color: var(--report-primary) !important; /* Changed to main primary color */
                font-size: 13px !important;
                margin: 0 0 6px 0 !important;
                font-weight: 700 !important;
                letter-spacing: -0.01em;
            }

            /* Company Name - Match other values */
            #notebook-title-editor {
                font-size: 15px !important;
                font-weight: 500 !important;
                color: var(--report-text-dark) !important;
                margin: 0 !important; /* Unified margin */
                line-height: 1.5 !important;
            }

            /* Values */
            .sidebar input:disabled, 
            .sidebar select:disabled, 
            .sidebar textarea:disabled {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                color: var(--report-text) !important;
                font-weight: 500 !important;
                opacity: 1 !important;
                -webkit-text-fill-color: var(--report-text) !important;
                font-size: 15px !important;
                margin: 0 !important;
                height: auto !important;
                min-height: 22px !important;
                display: block !important;
                overflow: visible !important;
            }

            /* textarea ?꾩슜: overflow visible 媛뺤젣 (?몃씪??overflow:hidden ??뼱?곌린) */
            .sidebar textarea:disabled {
                overflow: visible !important;
                white-space: pre-wrap !important;
                word-break: break-word !important;
            }

            /* ?ъ옄/?щТ ?뱀뀡: flex min-height:0 ?쇰줈 ?명븳 ?섎┝ 諛⑹? */
            #investment-section,
            #financial-section {
                min-height: auto !important;
                overflow: visible !important;
                height: auto !important;
            }

            /* ?쒕∼?ㅼ슫 ?붿궡???④린湲?*/
            .sidebar select:disabled {
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                appearance: none !important;
            }

            /* 湲곗뾽紐??섑띁 div ?щ갚 ?쒓굅 (??쒖옄紐??깃낵 ?뺣젹 ?듭씪) */
            .sidebar-nav div:has(> #notebook-title-editor),
            .sidebar-nav div:has(> .notebook-title) {
                padding: 0 !important;
                border: none !important;
                background: transparent !important;
                height: auto !important;
                min-height: unset !important;
                display: block !important;
            }

            /* ?곗뾽 select 遺紐?div ?щ갚 ?쒓굅 */
            #industry {
                width: auto !important;
            }
            
            /* Properly hide elements when jQuery .hide() is used */
            .sidebar [style*="display: none"] {
                display: none !important;
            }


            /* Tables - JS濡??ъ깮?깊븯誘濡?蹂꾨룄 CSS 遺덊븘??*/
            /* ?ъ옄/?щТ ?뱀뀡 ?덉씠釉??ㅽ????좎? */
            #investment-section > p,
            #financial-section > p {
                margin-bottom: 8px !important;
            }


            /* Status Chips - Rounded & Subtle */
            .btn-status-chip {
               border-radius: 100px !important; 
            }
            .btn-status-chip.active {
                background: #f1f5f9 !important;
                color: var(--report-primary) !important;
                font-weight: 700 !important;
                padding: 4px 14px !important;
                border: 1px solid var(--report-primary) !important;
                display: inline-flex !important;
                font-size: 12px !important;
            }

            /* Hide AI/Edit Controls */
            .main-content, #guide-panel, .right-panel, 
            .btn-icon-only[title="?댁쟾?쇰줈"], 
            #btn-share-db-trigger, 
            #ai-auto-fill-btn,
            #btn-delete-company,
            .btn-remove-row,
            #add-investment-btn,
            #add-financial-btn,
            .welcome-screen,
            .modal-overlay,
            #industry-other,
            #mgmt-status-other,
            div:has(> #ai-auto-fill-btn) {
                display: none !important;
            }

            /* 愿由ы쁽??由ы룷???덉씠?꾩썐: 諛뺤뒪 ?쒓굅, ?좏깮 移⑸쭔 醫뚯륫 ?쒖떆 */
            #mgmt-status-group {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                border-radius: 0 !important;
                display: flex !important;
                flex-wrap: nowrap !important;
                align-items: center !important;
                gap: 16px !important;
            }

            /* 愿由ы쁽??- ?좏깮??移? ?뚮? 諛곌꼍 + ???띿뒪??*/
            #mgmt-status-group .btn-status-chip.active {
                background: var(--report-primary) !important;
                color: #ffffff !important;
                border-color: var(--report-primary) !important;
                font-weight: 600 !important;
            }

            /* 愿由ы쁽??- 鍮꾩꽑??移? 湲곕낯 ?ㅽ????좎? (??諛곌꼍 + ?뚯깋 ?뚮몢由? */
            #mgmt-status-group .btn-status-chip:not(.active) {
                background: #ffffff !important;
                color: #64748b !important;
                border-color: #e2e8f0 !important;
                font-weight: 400 !important;
                cursor: default !important;
            }

            /* ?? ?몄뇙(PDF ??? ?ㅽ????? */
            @media print {
                /* 諛곌꼍?됀룻뀓?ㅽ듃??洹몃?濡?異쒕젰 (釉뚮씪?곗? 湲곕낯 ?됱긽 ?쒓굅 諛⑹?) */
                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    color-adjust: exact !important;
                }

                /* ?ъ씠?쒕컮 UI 而⑦듃濡ㅻ쭔 ?④린湲?(?ㅻ뜑쨌?뚰꽣留덊겕???⑤씪??由ы룷?몄? ?숈씪?섍쾶 ?좎?) */
                .main-content,
                .right-panel,
                #guide-panel,
                .modal-overlay,
                #btn-pdf-download {
                    display: none !important;
                }

                        /* body / html ?ㅽ겕濡??댁젣 */
                body, html {
                    overflow: visible !important;
                    height: auto !important;
                    min-height: 0 !important;
                }

                /* ??而⑦뀒?대꼫: 釉붾줉?쇰줈 */
                .app-container {
                    display: block !important;
                    height: auto !important;
                }

                /* ?ъ씠?쒕컮瑜??꾩껜 ?덈퉬濡?*/
                aside.sidebar {
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    min-height: 0 !important;
                    overflow: visible !important;
                    border: none !important;
                    box-shadow: none !important;
                }

                /* ?ㅻ퉬 ?곸뿭 ?꾩껜 異쒕젰 */
                .sidebar-nav {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                    padding: 30px 50px !important;
                    gap: 0 !important;
                }

                /* ?뚰꽣留덊겕: 留??섏씠吏留덈떎 (position:fixed???몄뇙 ???섏씠吏蹂?諛섎났) */
                #report-watermark {
                    display: block !important;
                    opacity: 0.06 !important;
                }

                /* ?섏씠吏 寃쎄퀎?먯꽌 ?댁슜 ?섎┝ 諛⑹? */
                #investment-section,
                #financial-section,
                #investment-section table,
                #financial-section table {
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                #investment-section table tr,
                #financial-section table tr {
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                /* ?띿뒪???곸뿭: ?ㅻ쾭?뚮줈???댁젣 */
                #summary, #financial-analysis, #manager-memo {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                    white-space: pre-wrap !important;
                }

                /* ?섏씠吏 ?щ갚 諛??ш린 */
                @page {
                    size: A4;
                    margin: 15mm;
                }
            }
        `;

        if (!$('#report-mode-css').length) {
            $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        }

        // 1-b. ?뚰꽣留덊겕 ?쎌엯 + PDF 踰꾪듉 ?쒖떆
        // $('#btn-pdf-download').css('display', 'flex'); // [??젣] ?쎄린紐⑤뱶?먯꽌 PDF ?ㅼ슫濡쒕뱶 踰꾪듉 ??젣 ?붿껌 ?곸슜
        if (!$('#report-watermark').length) {
            const $sidebar = $('.sidebar');
            $sidebar.css('position', 'relative');
            $('<div id="report-watermark"></div>').css({
                position:       'fixed',
                top:            '50%',
                left:           $sidebar.offset() ? ($sidebar.offset().left + $sidebar.outerWidth() / 2) + 'px' : '50%',
                transform:      'translate(-50%, -50%) rotate(-30deg)',
                fontSize:       '80px',
                fontWeight:     '900',
                color:          primaryColor,
                opacity:        '0.05',
                letterSpacing:  '0.1em',
                whiteSpace:     'nowrap',
                pointerEvents:  'none',
                userSelect:     'none',
                zIndex:         '9999',
                fontFamily:     'inherit',
            }).text('DealChat').appendTo('body');
        }

        // 2. Functional updates
        $('.notebook-title').attr('contenteditable', 'false');
        $('input, textarea, select').prop('disabled', true);
        
        // Remove background boxes from fields
        $('.sidebar-nav div:has(> .notebook-title)').css('background', 'transparent').css('border', 'none').css('padding', '0');
        $('#industry').parent().css('background', 'transparent').css('border', 'none').css('padding', '0');
        $('#ceo-name, #company-email, #establishment-date, #company-address').parent().css('background', 'transparent').css('border', 'none').css('padding', '0');
        $('#seller-price-field, #seller-method-field').parent().css('background', 'transparent').css('border', 'none').css('padding', '0');
        // ?띿뒪?몄븘?덉븘 ?섑띁 div??padding(12px)???덉씠釉붽낵 ?댁슜 ?ъ씠 媛꾧꺽??踰뚮━誘濡??쒓굅
        // ?щТ遺꾩꽍/?대떦?먯쓽寃ъ? p? textarea瑜?媛숈? flex div媛 媛먯떥誘濡?gap??0?쇰줈 ???덉씠釉??댁슜 6px ?듭씪
        $('#summary, #financial-analysis, #manager-memo').parent().css({ 'background': 'transparent', 'border': 'none', 'padding': '0', 'gap': '0' });

        // textarea ??div濡?援먯껜: 釉뚮씪?곗?媛 textarea??overflow:visible??蹂댁옣?섏? ?딆쑝誘濡?
        // div濡?援먯껜?섎㈃ ?띿뒪???섎┝ ?놁씠 ?꾩껜 ?댁슜???쒖떆?????덉쓬
        ['#summary', '#financial-analysis', '#manager-memo'].forEach(function(sel) {
            const $ta = $(sel);
            if (!$ta.length) return;
            if ($ta.next('.report-text-content').length) return; // ?대? 援먯껜??- 以묐났 諛⑹?
            const content = $ta.val() || '';
            const $div = $('<div class="report-text-content">').css({
                'white-space':   'pre-wrap',
                'word-break':    'break-word',
                'font-size':     '15px',
                'color':         '#475569',
                'font-weight':   '400',
                'line-height':   '1.6',
                'margin':        '0',
                'padding':       '0',
            }).text(content);
            $ta.after($div).hide();
        });


        // Adjust heights (湲곗〈 textarea媛 ?덉쓣 寃쎌슦 ?鍮?- ?뱀떆 ?⑥? 寃껊뱾)
        const resizeTextareas = () => {
            $('textarea:disabled:visible').each(function() {
                this.style.setProperty('height', 'auto', 'important');
                this.style.setProperty('height', (this.scrollHeight + 2) + 'px', 'important');
            });
            // ?몃씪??margin-top???덈뒗 ?뱀뀡??(愿由ы쁽???????곷떒 ?щ갚 ?쒓굅
            $('.sidebar-nav > div[style*="margin-top"]').css('margin-top', '0', 'important');
        };
        setTimeout(resizeTextareas, 400);

        // 3. Set report title & icon
        if (isSeller) {
            $('#sidebar-header-title').text('留ㅻ룄???뺣낫');
            $('.sidebar .panel-header h2 span.material-symbols-outlined').text('storefront');
        } else {
            $('#sidebar-header-title').text('湲곗뾽?뺣낫');
            $('.sidebar .panel-header h2 span.material-symbols-outlined').text('corporate_fare');
        }

        // 4. Industry field cleanup
        // CSS 紐낆떆??臾몄젣濡??명빐 jQuery .hide()/.show() ???setProperty('important')濡??쒖뼱
        const $industryOther = $('#industry-other');
        const $industrySelect = $('#industry');
        if ($industrySelect.val() === '湲고?' && $industryOther.val().trim()) {
            // 吏곸젒 ?낅젰媛믪씠 ?덈뒗 寃쎌슦?먮쭔 select瑜??④린怨??띿뒪???낅젰李??쒖떆
            $industrySelect[0].style.setProperty('display', 'none', 'important');
            $industryOther[0].style.setProperty('display', 'block', 'important');
            $industryOther.css({ 'margin-top': '0', 'padding-top': '0' });
        } else {
            // 媛믪씠 ?녾굅??'湲고?'媛 ?꾨땶 寃쎌슦 ???낅젰李?媛뺤젣 ?④? (鍮?placeholder ?몄텧 諛⑹?)
            $industryOther[0].style.setProperty('display', 'none', 'important');
        }

        // Hide the footer container if it holds buttons
        $('#btn-delete-company').parent().hide();

        // 5. 愿由ы쁽??湲고? ?낅젰 泥섎━
        const $mgmtOther = $('#mgmt-status-other');
        const isOtherMgmt = $('.btn-status-chip.active').data('value') === '湲고?';
        if (isOtherMgmt && $mgmtOther.val().trim()) {
            $mgmtOther[0].style.setProperty('display', 'inline-block', 'important');
            $mgmtOther[0].style.setProperty('margin', '0', 'important');
            $mgmtOther[0].style.setProperty('padding', '0', 'important');
            $mgmtOther[0].style.setProperty('font-size', '15px', 'important');
            $mgmtOther[0].style.setProperty('color', 'var(--report-text)', 'important');
            $mgmtOther[0].style.setProperty('border', 'none', 'important');
            $mgmtOther[0].style.setProperty('background', 'transparent', 'important');
        } else {
            $mgmtOther[0].style.setProperty('display', 'none', 'important');
        }

        // 6. ?ъ옄/?щТ ?뚯씠釉???源붾걫??<table>濡??꾩쟾???ㅼ떆 洹몃━湲?
        // ???곗씠?곌? ?놁쑝硫?skip (珥덇린 ?몄텧 ??#investment-rows媛 鍮꾩뼱 ?덉쑝誘濡?援ъ“ 蹂댁〈)
        const tableBaseStyle = `width:100%;border-collapse:collapse;font-size:13px;`;
        const thStyle = `background:#f1f5f9;color:#475569;font-weight:700;font-size:11px;padding:9px 12px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;white-space:nowrap;`;
        const thLastStyle = thStyle + 'border-right:none;';
        const tdC  = `padding:10px 12px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;color:#334155;text-align:center;`;
        const tdR  = `padding:10px 12px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;color:#334155;text-align:right;`;
        const tdCL = `padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;text-align:center;`;
        const tdRL = `padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;text-align:right;`;
        const labelStyle = `margin:0 0 5px 0;font-weight:700;font-size:13px;color:var(--report-primary);`;

        // ?? ?ъ옄 ?뺣낫 ??
        (function() {
            const $invRows = $('#investment-rows > div');
            if ($invRows.length === 0) return; // ?곗씠???놁쑝硫?援ъ“ ?좎? (珥덇린 ?몄텧 skip)

            const rows = [];
            $invRows.each(function() {
                rows.push({
                    year:      $(this).find('.inv-year').val()      || '',
                    stage:     $(this).find('.inv-stage').val()     || '',
                    valuation: $(this).find('.inv-valuation').val() || '',
                    amount:    $(this).find('.inv-amount').val()    || '',
                    investor:  $(this).find('.inv-investor').val()  || ''
                });
            });

            let html = `<p style="${labelStyle}">?ъ옄 ?뺣낫</p>
                <table style="${tableBaseStyle}">
                <thead><tr>
                    <th style="${thStyle}     width:10%">?꾨룄</th>
                    <th style="${thStyle}     width:15%">?④퀎</th>
                    <th style="${thStyle}     width:18%">踰⑤쪟(??</th>
                    <th style="${thStyle}     width:22%">湲덉븸(??</th>
                    <th style="${thLastStyle} width:35%">?ъ옄??/th>
                </tr></thead><tbody>`;

            rows.forEach(function(r, i) {
                const last = i === rows.length - 1;
                const nb = last ? 'border-bottom:none;' : '';
                html += `<tr>
                    <td style="${tdC}  ${nb}">${r.year}</td>
                    <td style="${tdC}  ${nb}">${r.stage}</td>
                    <td style="${tdR}  ${nb}">${r.valuation}</td>
                    <td style="${tdR}  ${nb}">${r.amount}</td>
                    <td style="${tdCL} ${nb}">${r.investor}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            $('#investment-section').empty().append(html);
        })();

        // ?? ?щТ ?뺣낫 ??
        (function() {
            const $finRows = $('#financial-rows > div');
            if ($finRows.length === 0) return; // ?곗씠???놁쑝硫?援ъ“ ?좎? (珥덇린 ?몄텧 skip)

            const rows = [];
            $finRows.each(function() {
                rows.push({
                    year:      $(this).find('.fin-year').val()    || '',
                    revenue:   $(this).find('.fin-revenue').val() || '',
                    op:        $(this).find('.fin-profit').val()  || $(this).find('.fin-op').val() || '',
                    net:       $(this).find('.fin-net').val()     || '',
                    evEbitda:  $(this).find('.fin-ev-ebitda').val() || ''
                });
            });

            let html = `<p style="${labelStyle}">?щТ ?뺣낫</p>
                <table style="${tableBaseStyle}">
                <thead><tr>
                    <th style="${thStyle}     width:10%">?꾨룄</th>
                    <th style="${thStyle}     width:24%">留ㅼ텧????</th>
                    <th style="${thStyle}     width:24%">?곸뾽?댁씡(??</th>
                    <th style="${isSeller ? thStyle : thLastStyle} width:24%">${isSeller ? '?밴린?쒖씠????' : '?밴린?쒖씡(??'}</th>
                    ${isSeller ? `<th style="${thLastStyle} width:18%">EV/EBITDA</th>` : ''}
                </tr></thead><tbody>`;

            rows.forEach(function(r, i) {
                const last = i === rows.length - 1;
                const nb = last ? 'border-bottom:none;' : '';
                html += `<tr>
                    <td style="${tdC}  ${nb}">${r.year}</td>
                    <td style="${tdR}  ${nb}">${r.revenue}</td>
                    <td style="${tdR}  ${nb}">${r.op}</td>
                    <td style="${isSeller ? tdR : tdRL} ${nb}">${r.net}</td>
                    ${isSeller ? `<td style="${tdCL} ${nb}">${r.evEbitda}</td>` : ''}
                </tr>`;
            });

            html += '</tbody></table>';
            $('#financial-section').empty().append(html);
        })();

        // 7. ?대? ?뱀뀡 媛꾧꺽 ?듭씪 (湲곗뾽紐끸넄??쒖옄紐?媛꾧꺽 20px 湲곗?)
        // 愿由ы쁽?㈑룻닾?먯젙蹂는룹옱臾댁젙蹂는룹옱臾대텇?씲룸떞?뱀옄?섍껄? ?뚯궗?뚭컻 div ?덉뿉 以묒꺽?섏뼱
        // .sidebar-nav > div CSS媛 ?곸슜?섏? ?딆쑝誘濡?JS濡?margin??紐낆떆?곸쑝濡??ㅼ젙
        $('#mgmt-status-group').parent()
            .css({ 'margin-top': '20px', 'margin-bottom': '0' });
        $('#investment-section')
            .css({ 'margin-top': '20px' });
        $('#financial-section')
            .css({ 'margin-top': '20px' });
        $('#financial-analysis').parent()
            .css({ 'margin-top': '20px' });
        $('#manager-memo').parent()
            .css({ 'margin-top': '20px' });

        if (!isLoggedIn) {
            $('#user-menu-trigger').hide();
        }
    }
});


// Helper to parse merged data from summary (DealBook loading compatibility)
function parseCompanyData(company) {
    if (!company.summary) return company;

    const parsed = { ...company };
    // [Fix] ?꾨뱶紐?遺덉씪移????(companyName vs company_name)
    if (!parsed.companyName && company.company_name) {
        parsed.companyName = company.company_name;
    }
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

            const invStatusMatch = metaText.match(/?ъ옄\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?щТ ?꾪솴:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (invStatusMatch) parsed.investmentStatusDesc = invStatusMatch[1].trim();

            const finStatusMatch = metaText.match(/?щТ\s*?꾪솴\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?ъ옄 ?꾪솴:|?щТ 遺꾩꽍:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (finStatusMatch) parsed.financialStatusDesc = finStatusMatch[1].trim();

            const finAnalysisMatch = metaText.match(/?щТ\s*遺꾩꽍\s*:\s*((?:.|\n)*?)(?=(愿由??꾪솴:|諛쒓뎬 寃쎈줈:|?ъ옄 ?좊Т:|?ъ옄 諛몃쪟:|?ъ옄 湲덉븸:|??쒖옄紐?|?대찓??|?ㅻ┰?쇱옄:|二쇱냼:|?ъ옄 ?꾪솴:|?щТ ?꾪솴:|?대떦??硫붾え:|?대떦???섍껄:|$))/);
            if (finAnalysisMatch) parsed.financialAnalysis = finAnalysisMatch[1].trim();

            const memoMatch = metaText.match(/?대떦??s*(?:硫붾え|?섍껄)\s*:\s*((?:.|\n)*)/);
            if (memoMatch) parsed.managerMemo = memoMatch[1].trim();

        }
    } catch (e) {
        console.error('Error parsing company summary in DealBook:', e);
    }

    return parsed;
}

