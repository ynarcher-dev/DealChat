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
        alert('매수자 ID가 없습니다.');
        location.href = './buyers.html';
        return;
    }

    // ==========================================
    // 데이터 로드
    // ==========================================
    function loadBuyerData() {
        if (isNew) {
            setChip('대기');
            hideLoader();
            return;
        }

        // [Fix] totalbuyer 성격에서 접근 시 타인의 정보를 볼 수 있도록 user_id를 빈값으로 보낼 수 있게 수정
        const getPayload = { action: 'get', table: 'buyers', id: buyerId };
        if (fromParam !== 'totalbuyer') {
            getPayload.user_id = user_id;
        } else {
            getPayload.user_id = ""; // 전체 조회 허용
        }

        const endpoint = getConfig().supabase.uploadHandlerUrl;
        APIcall(getPayload, endpoint, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(data => {
                const buyer = Array.isArray(data) ? data[0] : data;
                if (!buyer || buyer.error) {
                    alert('매수자 정보를 불러오지 못했습니다.');
                    location.href = './buyers.html';
                    return;
                }

                const companyName = buyer.company_name || buyer.companyName || '';
                $('#buyer-name-editor').text(companyName);
                document.title = `${companyName || '매수자'} - 매수자 정보`;
                $('#sidebar-header-title').text(companyName || '매수자 정보');
                $('#buyer-industry').val(buyer.industry || buyer.interest_industry || '선택해주세요');
                $('#buyer-investment').val(buyer.investment_amount || '');
                $('#buyer-summary').val(buyer.summary || '');
                $('#buyer-interest-summary').val(buyer.interest_summary || '');
                $('#buyer-memo').val(buyer.manager_memo || '');
                $('#buyer-manager-affiliation').val(buyer.manager_affiliation || '');
                $('#buyer-manager-name').val(buyer.manager_name || '');

                // 날짜 및 작성자 정보 바인딩
                if (buyer.user_id) {
                    APIcall({
                        action: 'get',
                        table: 'users',
                        id: buyer.user_id
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
                    const d = new Date(buyer.updated_at);
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    $('#memo-update-date').text(`최종 수정: ${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`);
                }


                // 진행 상황 chip
                setChip(buyer.status || '대기');

                // textarea 높이 조절 - 초기 로더링 시
                setTimeout(autoResizeAll, 100);

                // 파일 목록 로드
                loadAvailableFiles();
                loadReportTypes();

                // 대화 히스토리 복원
                if (buyer.history && Array.isArray(buyer.history)) {
                    conversationHistory = buyer.history;
                    conversationHistory.forEach(msg => {
                        addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                    });
                    const $chatMessages = $('#chat-messages');
                    $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                }

                // [추가] 읽기 모드 권한 체크
                if (fromParam === 'totalbuyer') {
                    const validStatuses = ['대기', '진행중', '완료'];
                    const currentStatus = validStatuses.includes(buyer.status) ? buyer.status : '대기';
                    const isOwner = (userData && userData.id === buyer.user_id);

                    if (!isOwner && (currentStatus === '진행중' || currentStatus === '완료')) {
                        const msg = (currentStatus === '진행중') ? '현재 거래가 진행 중입니다.' : '거래가 완료되었습니다.';
                        alert(msg);
                        $('body').css('overflow', 'hidden').empty().append(`
                            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#f8fafc; color:#64748b; font-family: 'Pretendard Variable', Pretendard, sans-serif; gap:20px; text-align:center; padding: 20px;">
                                <span class="material-symbols-outlined" style="font-size: 80px; color:#cbd5e1; margin-bottom: 10px;">lock_person</span>
                                <div style="font-size:28px; font-weight:800; color:#1e293b; letter-spacing: -0.5px;">${msg}</div>
                                <p style="font-size:16px; line-height: 1.6; color: #64748b; max-width: 400px;">
                                    해당 매수자는 현재 거래 상태 보호를 위해<br>상세 리포트 조회가 일시적으로 제한되었습니다.
                                </p>
                                <button onclick="location.href='./totalbuyers.html'" 
                                    style="margin-top: 10px; padding:14px 40px; background:#0d9488; color:white; border:none; border-radius:50px; font-weight:700; font-size: 15px; cursor:pointer; box-shadow: 0 10px 20px rgba(13, 148, 136, 0.2); transition: all 0.2s;">
                                    매수자 목록으로 돌아가기
                                </button>
                            </div>
                        `);
                        return;
                    }
                }

                // [추가] 읽기 모드 UI 적용 완료
                if (fromParam === 'totalbuyer') {
                    applyBuyerReadOnlyMode();
                    $('#report-initial-loader').fadeOut(300, function() { $(this).remove(); });
                }
            })
            .catch(err => {
                console.error('Load error:', err);
                alert('데이터 로드 실패');
                location.href = './buyers.html';
            })
            .finally(() => hideLoader());
    }

    // 초기 데이터 로드 호출
    loadBuyerData();

    // ==========================================
    // 진행 상황 Chip
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
    // Textarea 자동 높이
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

    // 매수자명 변경 시 제목 업데이트
    $('#buyer-name-editor').on('input', function() {
        const name = $(this).text().trim() || '매수자';
        document.title = `${name} - 매수자 정보`;
        $('#sidebar-header-title').text(name || '매수자 정보');
    });

    // ==========================================
    // 저장/ 삭제
    // ==========================================
    function saveBuyer(isDraft, $btn) {
        const name = $('#buyer-name-editor').text().trim();
        const industry = $('#buyer-industry').val();
        const investment = $('#buyer-investment').val().trim();
        const status = $('#buyer-status').val();
        const summary = $('#buyer-summary').val().trim();
        const interest_summary = $('#buyer-interest-summary').val().trim();
        const memo = $('#buyer-memo').val().trim();
        
        // 추가 필드
        const manager_affiliation = $('#buyer-manager-affiliation').val().trim();
        const manager_name = $('#buyer-manager-name').val().trim();

        if (!name || industry === '선택해주세요' || !summary) {
            alert('매수자명, 산업, 회사 소개는 필수 입력입니다.');
            return;
        }

        const payload = {
            companyName: name,
            interest_industry: industry,
            investment_amount: investment,
            status: status,
            summary,
            interest_summary,
            manager_memo: memo,
            manager_affiliation,
            manager_name,
            share_type: isDraft ? 'private' : 'public',
            user_id,
            history: conversationHistory,
            updated_at: new Date().toISOString()
        };

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size:16px;">sync</span> 저장 중..');

        if (isNew) {
            payload.action = 'create';
            payload.table = 'buyers';
            payload.created_at = new Date().toISOString();
        } else {
            payload.action = 'update';
            payload.table = 'buyers';
            payload.id = buyerId;
        }

        APIcall(payload, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(result => {
                if (result.error) {
                    alert('저장 중 오류: ' + result.error);
                } else {
                    if (isNew && result.id) {
                        alert('저장되었습니다.');
                        location.href = `./buyer.html?id=${result.id}`;
                    } else {
                        alert('저장되었습니다.');
                        if (payload.updated_at) {
                            const d = new Date(payload.updated_at);
                            const formattedDate = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                            $('#memo-update-date').text(`理쒖쥌 ?섏젙: ${formattedDate}`);
                        }
                    }
                }
            })
            .catch(err => { console.error(err); alert('????붿껌 ?ㅽ뙣'); })
            .finally(() => { $btn.prop('disabled', false).html(origHtml); });
    }

    $('#btn-save-buyer').on('click', function () { saveBuyer(false, $(this)); });
    $('#btn-draft-buyer').on('click', function () { saveBuyer(true, $(this)); });

    $('#btn-delete-buyer').on('click', function () {
        if (!confirm('정말로 이 매수자 정보를 삭제하시겠습니까?')) return;
        APIcall({ action: 'delete', table: 'buyers', id: buyerId }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(result => {
                if (result.error) alert('삭제 오류: ' + result.error);
                else { alert('삭제되었습니다.'); location.href = './buyers.html'; }
            })
            .catch(() => alert('삭제 요청 실패'));
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
        if (!instruction) { alert('리포트 지시사항을 입력해주세요.'); return; }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> 생성 중..');

        try {
            const prompt = `[Report Type] ${reportType}\n[Language] ${language}\n[Instruction] ${instruction}`;
            let infoCtx = `=== 매수자 기본 정보 ===\n`;
            infoCtx += `매수자명: ${$('#buyer-name-editor').text()}\n`;
            infoCtx += `산업: ${$('#buyer-industry').val()}\n`;
            infoCtx += `소개: ${$('#buyer-summary').val()}\n`;
            infoCtx += `매수 조건: ${$('#buyer-interest-summary').val()}\n`;
            infoCtx += `담당자: ${$('#buyer-manager-name').val()} (${$('#buyer-manager-affiliation').val()})\n`;

            const historyCtx = conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
            let ragContext = isNew ? "" : await searchVectorDB(`${reportType} 리포트`, buyerId);

            const fullContext = infoCtx + "\n[Conversation History]\n" + historyCtx + (ragContext ? "\n=== 관련 문서 내용 ===\n" + ragContext : "");
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
                alert('리포트 생성이 완료되어 다운로드되었습니다.');
            }
        } catch (error) {
            console.error('Report Generation Error:', error);
            alert('리포트 생성 중 오류가 발생했습니다.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    loadReportTypes();

    // ==========================================
    // 파일 업로드/ 목록 (buyers_files 테이블 사용 가능)
    // ==========================================
    function loadAvailableFiles() {
        if (isNew) return;
        APIcall({ action: 'get', table: 'buyers_files', buyerId }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(r => r.json())
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
            $listTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>');
            $listNonTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>');
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
                alert(`지원하지 않는 파일 형식: ${file.name}`);
                continue;
            }
            try {
                const uploadResult = await fileUpload(file, user_id, SUPABASE_ENDPOINT);
                if (uploadResult && uploadResult.key) {
                    await APIcall({
                        action: 'create',
                        table: 'buyers_files',
                        buyerId,
                        file_key: uploadResult.key,
                        file_name: file.name,
                        source_type: currentSourceType,
                        user_id
                    }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' }).then(r => r.json());
                }
            } catch (err) {
                console.error('Upload error:', err);
                alert(`${file.name} 업로드 실패`);
            }
        }
        this.value = '';
        loadAvailableFiles();
    });

    $(document).on('click', '.btn-remove-file', function () {
        const fileId = $(this).data('id');
        if (!confirm('파일을 삭제하시겠습니까?')) return;
        APIcall({ action: 'delete', table: 'buyers_files', id: fileId }, getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(() => loadAvailableFiles());
    });

    // ==========================================
    // AI 자동 입력 (자료 기반 추출 로직)
    // ==========================================
    async function autoFillFromFiles($btn) {
        if (isNew || availableFiles.length === 0) {
            alert('먼저 파일을 업로드하고 저장한 후 시도해 주세요.');
            return;
        }

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 20px;">sync</span> 추출 중..');

        try {
            const query = "Extract buyer/investor name, interested industry, investment amount, general company summary, and specific interest requirements.";
            const contextRaw = await searchVectorDB(query, buyerId);

            const prompt = `
                업로드된 자료를 분석하여 매수자/투자자의 주요 정보를 추출해주세요.
                만약 자료에서 확인되지 않는 정보는 빈 문자열("")로 처리하세요.
                
                반드시 아래 JSON 형식으로만 응답하세요.
                {
                  "companyName": "매수자명/투자자명",
                  "industry": "관련 산업군",
                  "investmentAmount": "가능 금액 (숫자 위주)",
                  "summary": "회사 소개 (매수자에 대한 일반적인 소개)",
                  "interestSummary": "매수 희망 기업/조건 (인수 희망 분야, 지역, 투자 규모 등)"
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
                alert('매수자 정보가 자동으로 추출 및 입력되었습니다.');
            }
        } catch (err) {
            console.error('Auto-fill error:', err);
            alert('정보 추출에 실패했습니다. (문서가 인덱싱 중이거나 AI 응답 오류)');
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

            const context = `[매수자 기본 필드 정보]\n매수자명: ${$('#buyer-name-editor').text()}\n산업: ${$('#buyer-industry').val()}\n가용자금: ${$('#buyer-investment').val()}\n진행상황: ${$('#buyer-status').val()}\n상세 소개: ${$('#buyer-summary').val()}\n매칭 희망 기업/조건: ${$('#buyer-interest-summary').val()}\n담당자 메모: ${$('#buyer-memo').val()}\n\n[참고 문서 내용]\n${ragContext}`;
            
            const response = await addAiResponse(msg, context);
            const data = await response.json();
            const aiReply = data.answer || '응답을 받지 못했습니다.';
            
            $aiPlaceholder.find('.ai-typing').text(aiReply);
            conversationHistory.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString() });

            if (!isNew) {
                APIcall({ action: 'update', table: 'buyers', id: buyerId, history: conversationHistory, updated_at: new Date().toISOString() },
                    getConfig().supabase.uploadHandlerUrl, { 'Content-Type': 'application/json' }).catch(() => {});
            }
        } catch (err) {
            console.error('AI error:', err);
            $aiPlaceholder.find('.ai-typing').text('AI 응답에 실패했습니다. 다시 시도해주세요.');
        }
    }

    $('#send-btn').on('click', sendMessage);
    $chatInput.on('keypress', e => { if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    
    $('#clear-history-btn').on('click', () => {
        if (!confirm('대화 내용을 모두 삭제하시겠습니까?')) return;
        conversationHistory = [];
        $chatMessages.empty();
        $welcomeScreen.show();
    });

    $(document).on('click', '.prompt-chip', function () {
        $chatInput.val($(this).text());
        sendMessage();
    });

    // 초기 에러 방지를 위해 window.config 체크
    if (!window.config) {
        window.config = {
            supabase: { uploadHandlerUrl: '', aiHandlerUrl: '' },
            ai: { model: 'gpt-4o', tokenLimits: { 'gpt-4o': { maxContextTokens: 120000, maxOutputTokens: 4096, safetyMargin: 5000 } } }
        };
    }

    // ==========================================
    // 전문 리포트 모드 (Professional Report Mode)
    // ==========================================
    function applyBuyerReadOnlyMode() {
        console.log('[Info] Applying Professional Report Mode (Buyer) - Synced with Seller');

        const primaryColor = '#0d9488'; // Buyer Teal Color

        // 1. 전용 CSS 추가 (Seller Editor 사양 1:1 적용)
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
                background-image: none !important; /* 화살표 제거 */
            }
            
            textarea:disabled {
                display: none !important; /* 중복 노출 방지 */
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

            /* 산업 직접 입력 섹션 제어 */
            .sidebar-nav div:has(> #buyer-industry-etc) {
                display: ${$('#buyer-industry').val() === '기타' ? 'block' : 'none'} !important;
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

        // 2. 입력 비활성화 및 제목 업데이트
        $('#buyer-name-editor').attr('contenteditable', 'false');
        $('input, select, textarea').prop('disabled', true);
        $('#sidebar-header-title').text('매수자 리포트');
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

        // 5. 제목 텍스트 업데이트
        document.title = ($('#buyer-name-editor').text() || '매수자') + ' 리포트 - DealChat';
    }

});
