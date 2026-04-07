import { checkAuth, updateHeaderProfile } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;
let currentBuyerData = null;

$(document).ready(function () {
    const userData = checkAuth();
    if (!userData) return;
    const currentuser_id = userData.id;

    updateHeaderProfile(userData);

    const urlParams = new URLSearchParams(window.location.search);
    const buyerId = urlParams.get('id');
    const fromSource = urlParams.get('from');

    // 珥덇린 ?ㅼ젙
    if (buyerId && buyerId !== 'new') {
        const urlParams = new URLSearchParams(window.location.search);
        const fromSource = urlParams.get('from');
        
        // NDA 泥댄겕 (蹂닿퀬??紐⑤뱶???뚮쭔)
        if (fromSource === 'totalbuyer') {
            loadBuyerData(buyerId, true); // true means check NDA
        } else {
            loadBuyerData(buyerId, false);
        }
    } else {
        // ??諛붿씠???깅줉
        $('#buyer-name-editor').attr('placeholder', '諛붿씠?대챸 (?좉퇋)');
        
        // ?묒꽦??蹂몄씤 ?뺣낫 珥덇린 ?ㅼ젙
        $('#memo-author-name').text(userData.name || '');
        $('#memo-author-affiliation').text(userData.department || userData.affiliation || userData.company || 'DealChat');
        $('#memo-author-avatar').attr('src', userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name || 'user')}`);
        
        switchMode('edit');
    }

    function switchMode(mode) {
        if (mode === 'read') {
            applyBuyerReadOnlyMode();
        } else {
            // ?몄쭛 紐⑤뱶??湲곕낯 3???⑤꼸 ?덉씠?꾩썐 ?좎?
            $('#report-mode-css').remove();
            $('#report-watermark').remove();
            $('body').css('overflow', 'hidden');
            $('.sidebar').show();
            $('.main-content').show();
            $('.right-panel').show();
            $('input, select, textarea').prop('disabled', false);
            $('#buyer-name-editor').attr('contenteditable', 'true');
        }
    }

    // ?곗씠??濡쒕뱶
    function loadBuyerData(id, checkNda = false) {
        $('#global-loader').fadeIn();
        APIcall({ action: 'get', table: 'buyers', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(res => res.json())
            .then(data => {
                const item = Array.isArray(data) ? data[0] : (data.data ? data.data[0] : data);
                if (item) {
                    currentBuyerData = item;
                    
                    const isOwner = String(item.user_id || item.user_id) === String(currentuser_id);
                    const signedNdas = getSignedNdas();
                    const isSigned = signedNdas.includes(String(id));
                    const isAuthorized = isOwner || isSigned;

                    if (checkNda && !isAuthorized) {
                        // NDA 誘몄껜寃??곹깭 - 紐⑤떖 ?쒖떆
                        showNdaGate(id, item.companyName);
                    } else {
                        // ?뺤긽 濡쒕뱶
                        bindBuyerData(item);
                        if (fromSource === 'totalbuyer') {
                            switchMode('read');
                        } else {
                            switchMode('edit');
                        }
                    }
                }
                $('#global-loader').fadeOut();
            })
            .catch(err => {
                console.error("Load buyer error:", err);
                $('#global-loader').fadeOut();
            });
    }

    function bindBuyerData(item) {
        // ?곗씠??諛붿씤??        $('#buyer-name-editor').text(item.companyName || '');
        $('#buyer-manager').val(item.manager || '');
        $('#buyer-email').val(item.email || '');
        $('#buyer-industry').val(item.interest_industry || '?좏깮?댁＜?몄슂');
        $('#buyer-investment').val(item.investment_amount || '');
        $('#buyer-status').val(item.status || '?湲?);
        $('#buyer-summary').val(item.summary || '');
        $('#buyer-interest-summary').val(item.interest_summary || '');
        $('#buyer-memo').val(item.etc || '');

        // ?곹깭 移?        $('.btn-status-chip').removeClass('active');
        $(`.btn-status-chip[data-value="${item.status || '?湲?}"]`).addClass('active');

        // ?묒꽦???뺣낫 諛??좎쭨 濡쒕뱶
        const authorId = item.user_id || item.user_id;
        if (authorId) fetchAuthorInfo(authorId);
        
        if (item.updated_at) {
            const date = new Date(item.updated_at);
            const dateStr = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            $('#memo-update-date').text('理쒖쥌 ?낅뜲?댄듃: ' + dateStr);
        }
    }
    function fetchAuthorInfo(user_id) {
        if (!user_id) return;
        APIcall({ action: 'get', table: 'users', id: user_id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(res => res.json())
            .then(res => {
                const author = Array.isArray(res) ? res[0] : (res.data ? res.data[0] : (res.Item || res));
                if (author) {
                    const name = author.name || author.userName || author.display_name || '?????놁쓬';
                    const dept = author.department || author.affiliation || author.company || author.team || 'DealChat';
                    const avatar = author.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;

                    $('#memo-author-name').text(name);
                    $('#memo-author-affiliation').text(dept);
                    $('#memo-author-avatar').attr('src', avatar);
                }
            })
            .catch(err => console.error("Author fetch error:", err));
    }


    // ?곗뾽 ?좏깮 蹂寃?(湲고? ?좏깮 ???낅젰李??몄텧)
    $('#buyer-industry').on('change', function() {
        if ($(this).val() === '湲고?') {
            $('#buyer-industry-etc').show().focus();
        } else {
            $('#buyer-industry-etc').hide();
        }
    });

    // ?곹깭 移??대┃
    $('.btn-status-chip').on('click', function() {
        if ($('#report-mode-css').length) return;
        $('.btn-status-chip').removeClass('active');
        $(this).addClass('active');
        $('#buyer-status').val($(this).data('value'));
    });

    // ???(?꾩껜 怨듦컻)
    $('#btn-save-buyer').on('click', function() {
        saveBuyerData('public');
    });

    // 鍮꾧났媛????    $('#btn-draft-buyer').on('click', function() {
        saveBuyerData('private');
    });

    // ??젣?섍린
    $('#btn-delete-buyer').on('click', function() {
        if (!confirm('?뺣쭚 ??젣?섏떆寃좎뒿?덇퉴?')) return;
        
        const id = buyerId === 'new' ? null : buyerId;
        console.log("Delete call for id:", id);
        
        if (!id) {
            location.href = './totalbuyers.html';
            return;
        }

        $('#global-loader').fadeIn();
        APIcall({ table: 'buyers', action: 'delete', id: id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(() => {
                alert('??젣?섏뿀?듬땲??');
                location.href = './totalbuyers.html';
            })
            .catch(err => {
                console.error("Delete buyer error:", err);
                alert('??젣 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + err.message);
            })
            .finally(() => {
                $('#global-loader').fadeOut();
            });
    });

    function saveBuyerData(shareType) {
        console.log("Saving buyer data with type:", shareType);
        const id = buyerId === 'new' ? null : buyerId;
        const industryVal = $('#buyer-industry').val();
        const industryFinal = (industryVal === '湲고?' && $('#buyer-industry-etc').val().trim()) 
                              ? $('#buyer-industry-etc').val().trim() 
                              : industryVal;

        const payload = {
            table: 'buyers',
            action: id ? 'update' : 'create',
            companyName: $('#buyer-name-editor').text().trim(),
            manager: $('#buyer-manager').val(),
            email: $('#buyer-email').val(),
            interest_industry: industryFinal,
            investment_amount: $('#buyer-investment').val(),
            status: $('#buyer-status').val(),
            summary: $('#buyer-summary').val(),
            interest_summary: $('#buyer-interest-summary').val(),
            etc: $('#buyer-memo').val(),
            share_type: shareType,
            user_id: currentuser_id,
            updated_at: new Date().toISOString()
        };
        if (id) payload.id = id;

        console.log("Payload:", payload);

        $('#global-loader').fadeIn();
        APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(() => {
                alert(shareType === 'private' ? '鍮꾧났媛쒕줈 ??λ릺?덉뒿?덈떎.' : '??λ릺?덉뒿?덈떎.');
                if (buyerId === 'new') {
                    location.href = './totalbuyers.html';
                } else {
                    location.reload();
                }
            })
            .catch(err => {
                console.error("Save buyer error:", err);
                alert('???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎: ' + err.message);
            })
            .finally(() => {
                $('#global-loader').fadeOut();
            });
    }

    // ?꾨Ц 由ы룷??紐⑤뱶 (Seller Editor ?ㅽ????꾨꼍 ?댁떇)
    function applyBuyerReadOnlyMode() {
        console.log('?썳截?Applying Professional Buyer Report Mode (Synced with Seller)');
        const primaryColor = '#0d9488'; // Buyer Teal

        // 1. ?꾩슜 CSS 二쇱엯 (Seller Editor ?붿옄???ъ뼇 1:1 ?곸슜)
        const reportStyles = `
            :root {
                --report-primary: ${primaryColor};
                --report-bg: #ffffff;
                --report-text: #475569;
                --report-text-dark: #1e293b;
                --report-border: #e2e8f0;
            }

            body { 
                background-color: #ffffff !important; 
                overflow-y: auto !important; 
                height: auto !important; 
            }

            .app-container { 
                background-color: #ffffff !important; 
                display: block !important; 
                height: auto !important;
                padding: 30px 0 60px 0 !important;
            }
            
            /* ?ъ씠?쒕컮瑜?由ы룷??移대뱶濡?蹂??(Seller ?ъ뼇) */
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
                position: relative !important;
                z-index: 10 !important;
            }

            /* ?ㅻ뜑 諛곕꼫 (Seller ?ъ뼇) */
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
            #sidebar-header-title { color: #ffffff !important; font-size: 14px !important; font-weight: 700 !important; }

            /* 蹂몃Ц 而⑦뀗痢?(Seller ?ъ뼇: 40px ?⑤뵫) */
            .sidebar-nav {
                padding: 0 40px 40px 40px !important;
                overflow-y: visible !important;
                max-height: none !important;
                height: auto !important;
                display: flex !important;
                flex-direction: column !important;
            }

            .sidebar-nav > div { 
                margin-bottom: 36px !important; 
                margin-top: 0 !important;
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
            }

            /* ?쇰꺼 ?ㅽ???(Seller ?ъ뼇) */
            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-size: 13px !important;
                margin: 0 0 6px 0 !important;
                font-weight: 700 !important;
                display: block !important;
            }

            /* 由ы룷???띿뒪???뚮뜑留?(Seller ?ъ뼇) */
            .report-div {
                font-size: 15px !important;
                line-height: 1.6 !important;
                color: var(--report-text) !important;
                white-space: pre-wrap !important;
                padding: 0 !important;
            }

            #buyer-name-editor { 
                font-size: 15px !important; 
                font-weight: 500 !important;
                color: var(--report-text-dark) !important; 
                display: block !important; 
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

            /* ?낅젰 ?붿냼 泥섎━ */
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
                background-image: none !important; /* ?쒕∼?ㅼ슫 ?붿궡???쒓굅 */
            }
            
            textarea:disabled {
                display: none !important; /* report-div媛 ????몄텧?섎?濡??④? */
            }

            /* 移??ㅽ???(Seller ?ъ뼇) */
            #status-chip-group {
                background: transparent !important;
                border: none !important;
                padding: 0 !important;
                display: flex !important;
                gap: 10px !important;
                pointer-events: none !important;
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
            }

            /* 遺덊븘???뱀뀡 ?쒓굅 (Seller ?ъ뼇) */
            .main-content, .right-panel, .panel-resize-handle, #btn-share-buyer-trigger,
            .sidebar-nav > div:has(#ai-auto-fill-btn),
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

            /* ?뚰꽣留덊겕 (Seller ?ъ뼇) */
            .report-watermark {
                position: fixed; top: 50%; left: 50%; 
                transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 100px; font-weight: 900; color: var(--report-primary); opacity: 0.04;
                pointer-events: none; z-index: 0; letter-spacing: 12px;
            }

            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;
        $('<style id="report-mode-css">').text(reportStyles).appendTo('head');
        
        // 2. ?띿뒪???곸뿭 div 援먯껜
        ['#buyer-summary', '#buyer-interest-summary', '#buyer-memo'].forEach(sel => {
            const $ta = $(sel);
            if ($ta.length && !$ta.next('.report-div').length) {
                const content = $ta.val() || '';
                $ta.after(`<div class="report-div">${content}</div>`).hide();
            }
        });

        // 3. ?뚰꽣留덊겕 異붽?
        if (!$('.report-watermark').length) {
            $('<div class="report-watermark">DealChat</div>').appendTo('body');
        }

        // 4. ?낅젰李?鍮꾪솢?깊솕 諛??쒕ぉ ?낅뜲?댄듃
        $('#buyer-name-editor').attr('contenteditable', 'false');
        $('input, select, textarea').prop('disabled', true);
        
        const bName = currentBuyerData?.companyName || '諛붿씠??;
        $('#sidebar-header-title').text(bName);
        document.title = bName + ' 由ы룷??- DealChat';
    }

    function getSignedNdas() {
        try { return JSON.parse(localStorage.getItem('signed_ndas_buyers') || '[]'); }
        catch (e) { return []; }
    }
    function saveSignedNda(id) {
        const list = getSignedNdas();
        const strId = String(id);
        if (!list.includes(strId)) {
            list.push(strId);
            localStorage.setItem('signed_ndas_buyers', JSON.stringify(list));
        }
    }

    function showNdaGate(id, companyName) {
        // NDA 紐⑤떖 ?쒖떆 濡쒖쭅
        const currentUserName = userData?.name || userData?.email?.split('@')[0] || '?ъ슜??;
        $('#logged-in-user-name').text(currentUserName);
        
        const ndaModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('nda-modal'), {
            backdrop: 'static',
            keyboard: false
        });

        const $confirmBtn = $('#btn-confirm-nda');
        const validateNda = () => {
            const signature = $('#nda-signature-name').val().trim();
            const confirmTxt = $('#nda-confirmation-text').val().trim();
            const REQUIRED_TXT = "???ы빆???꾨컲?섏? ?딆쓣 寃껋쓣 ?쎌냽?⑸땲??;
            
            if (signature === currentUserName && confirmTxt === REQUIRED_TXT) {
                $confirmBtn.prop('disabled', false).css('opacity', '1');
            } else {
                $confirmBtn.prop('disabled', true).css('opacity', '0.5');
            }
        };

        $('#nda-signature-name, #nda-confirmation-text').off('input').on('input', validateNda);

        $confirmBtn.off('click').on('click', () => {
            const signature = $('#nda-signature-name').val().trim();
            saveSignedNda(id);
            
            APIcall({ table: 'nda_logs', action: 'create', user_id: currentuser_id, buyer_id: id, signature: signature }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                .catch(e => console.error('Failed to save NDA log', e));

            ndaModal.hide();
            // ?곗씠??諛붿씤??諛?紐⑤뱶 ?꾪솚
            bindBuyerData(currentBuyerData);
            switchMode('read');
        });

        // 痍⑥냼 ??紐⑸줉?쇰줈
        $('#nda-modal-cancel-btn').off('click').on('click', () => {
            location.href = './totalbuyers.html';
        });

        ndaModal.show();
    }
});
