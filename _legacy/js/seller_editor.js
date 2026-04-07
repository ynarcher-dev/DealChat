import { addAiResponse, searchVectorDB } from './AI_Functions.js';
import { APIcall } from './APIcallFunction.js';
import { filetypecheck, fileUpload, extractTextFromPDF, extractTextFromDocx, extractTextFromTxt, downloadTextFile } from './File_Functions.js';
import { checkAuth, updateHeaderProfile, initUserMenu, hideLoader } from './auth_utils.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;
const SUPABASE_STORAGE_URL = `${window.config.supabase.url}/storage/v1/object/public/uploads/`;

$(document).ready(function () {
    // ==========================================
    // 인증 & 초기화
    // ==========================================
    const userData = checkAuth();
    if (!userData) return;
    const user_id = userData.id;

    updateHeaderProfile(userData);
    initUserMenu();

    const urlParams = new URLSearchParams(window.location.search);
    const sellerId = urlParams.get('id');   // 'new' 또는 실제 ID
    const fromSource = urlParams.get('from'); // 'totalseller' 등 진입 경로
    const isNew = sellerId === 'new';

    let currentSellerData = null;
    let availableFiles = [];
    let conversationHistory = [];
    let currentSourceType = 'training';
    let availableReportTypes = [];

    let myCompanies = [];
    
    // 진입 경로에 따른 뒤로가기 버튼 링크 수정
    if (fromSource === 'totalseller') {
        $('.sidebar .panel-header button').filter(function() {
            return $(this).attr('onclick') && $(this).attr('onclick').includes('sellers.html');
        }).attr('onclick', "location.href='./totalsellers.html'");
    }

    // 기업 정보 파싱 함수 (companies.js 로직 유사)
    function parseCompanyData(company) {
        if (!company.summary) return company;
        const parsed = { ...company };
        const summaryText = company.summary;
        try {
            let mainSummary = "";
            let metaText = "";
            if (summaryText.includes('[상세 정보]')) {
                const parts = summaryText.split('[상세 정보]');
                mainSummary = parts[0].trim();
                metaText = parts[1] || "";
            } else {
                const metaKeywords = ["대표자명", "이메일", "설립일자:", "주소:", "재무 현황:", "재무 분석:", "담당자 의견:"];
                let firstIndex = -1;
                metaKeywords.forEach(kw => {
                    const idx = summaryText.indexOf(kw);
                    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) firstIndex = idx;
                });
                if (firstIndex !== -1) {
                    mainSummary = summaryText.substring(0, firstIndex).trim();
                    metaText = summaryText.substring(firstIndex);
                } else {
                    mainSummary = summaryText;
                }
            }
            parsed.parsedSummary = mainSummary.replace(/^(\[.*?\]|#\S+)\s*/, '').trim();
            if (metaText) {
                const ceoMatch = metaText.match(/대표자명\s*:\s*(.*)/);
                if (ceoMatch) parsed.ceoName = ceoMatch[1].split('\n')[0].trim();
                const emailMatch = metaText.match(/이메일\s*:\s*(.*)/);
                if (emailMatch) parsed.companyEmail = emailMatch[1].split('\n')[0].trim();
                const dateMatch = metaText.match(/설립일자\s*:\s*(.*)/);
                if (dateMatch) parsed.establishmentDate = dateMatch[1].split('\n')[0].trim();
                const addressMatch = metaText.match(/주소\s*:\s*(.*)/);
                if (addressMatch) parsed.companyAddress = addressMatch[1].split('\n')[0].trim();
                const finStatusMatch = metaText.match(/재무\s*현황\s*:\s*((?:.|\n)*?)(?=(?:대표자명|이메일|설립일자:|주소:|재무 분석:|담당자 의견:|$))/);
                if (finStatusMatch) parsed.financialStatusDesc = finStatusMatch[1].trim();
                const finAnalysisMatch = metaText.match(/재무\s*분석\s*:\s*((?:.|\n)*?)(?=(?:대표자명|이메일|설립일자:|주소:|재무 현황:|담당자 의견:|$))/);
                if (finAnalysisMatch) parsed.financialAnalysis = finAnalysisMatch[1].trim();
            }
        } catch (e) { console.error('Error parsing company summary:', e); }
        return parsed;
    }

    // 내 기업 목록 로드
    function loadMyCompanies() {
        APIcall({ action: 'get', table: 'companies', user_id }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(data => {
                myCompanies = Array.isArray(data) ? data.map(parseCompanyData) : [];
            })
            .catch(err => console.error('Load companies error:', err));
    }
    loadMyCompanies();

    // 기업 선택 시 필드 채우기
    function fillCompanyFields(company) {
        if (!company) return;
        $('#seller-name-editor').text(company.companyName || '');
        $('#seller-industry').val(company.industry || '기타');
        $('#seller-ceo').val(company.ceoName || '');
        $('#seller-email').val(company.companyEmail || '');
        $('#seller-establishment').val(company.establishmentDate || '');
        $('#seller-address').val(company.companyAddress || '');
        $('#seller-summary').val(company.parsedSummary || '');
        $('#seller-fin-analysis').val(company.financialAnalysis || '');

        // 재무 정보 테이블 채우기
        if (company.financialStatusDesc) {
            $('#financial-rows').empty();
            const finLines = company.financialStatusDesc.split('\n').filter(l => l.trim());
            finLines.forEach(line => {
                const parts = line.split(', ').reduce((acc, part) => {
                    const [key, val] = part.split(': ');
                    if (key && val !== undefined) acc[key.trim()] = val.trim();
                    return acc;
                }, {});
                createFinancialRow(parts['연도'] || '', parts['매출액'] || '', parts['영업이익'] || '', parts['당기순이익'] || '', '');
            });
        }
        autoResizeAll();
        $('#company-suggestions').hide();
    }

    // 기업명 입력 이벤트 (자동 완성 및 제목 업데이트)
    $('#seller-name-editor').on('input', function() {
        const name = $(this).text().trim() || '매도자';
        const query = name.toLowerCase();
        
        // 제목 업데이트
        document.title = `${name} - 매도자 정보`;
        $('#sidebar-header-title').text(name || '매도자 정보');

        const $suggestions = $('#company-suggestions');
        if (!query) { $suggestions.hide(); return; }
        const filtered = myCompanies.filter(c => (c.companyName || '').toLowerCase().includes(query));
        if (filtered.length === 0) { $suggestions.hide(); return; }
        $suggestions.empty().show();
        filtered.forEach(c => {
            const $item = $(`<div style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
                                <div style="font-weight: 600; color: #1e293b;">${c.companyName}</div>
                                <div style="font-size: 11px; color: #64748b;">${c.industry || '기타'}</div>
                             </div>`);
            $item.on('click', () => fillCompanyFields(c));
            $suggestions.append($item);
        });
    });
    
    // 산업 선택 변경 (기타 선택 시 입력창 노출)
    $('#seller-industry').on('change', function() {
        if ($(this).val() === '기타') {
            $('#seller-industry-etc').show().focus();
        } else {
            $('#seller-industry-etc').hide();
        }
    });

    $(document).on('click', function(e) {
        if (!$(e.target).closest('#seller-name-editor, #company-suggestions').length) {
            $('#company-suggestions').hide();
        }
    });

    // 매수 희망가 '협의' 체크박스 로직
    $('#negotiable-check').on('change', function() {
        const $priceInput = $('#seller-price');
        if ($(this).is(':checked')) {
            $priceInput.val('협의').prop('readonly', true).css('background', '#f8fafc');
        } else {
            $priceInput.val('').prop('readonly', false).css('background', '#ffffff').focus();
        }
    });

    // 작성자 정보 표시
    $('#memo-author-name').text(userData.name || '');
    $('#memo-author-affiliation').text(userData.department || userData.affiliation || userData.company || 'DealChat');
    $('#memo-author-avatar').attr('src',
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name || 'user')}`);

    if (!isNew) {
        $('#btn-delete-seller').show();
        $('#btn-share-seller-trigger').show();
    } else {
        $('#btn-delete-seller').hide();
    }

    if (!sellerId) {
        alert('매도자 ID가 없습니다.');
        location.href = './sellers.html';
        return;
    }

    // ==========================================
    // 데이터 로드
    // ==========================================
    function loadSellerData() {
        if (isNew) {
            setChip('대기');
            $('#financial-rows').empty();
            hideLoader();
            return;
        }

        const getPayload = { action: 'get', table: 'sellers', id: sellerId };
        if (fromSource !== 'totalseller') {
            getPayload.user_id = user_id;
        } else {
            getPayload.user_id = ""; // 전체 조회 허용
        }

        APIcall(getPayload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(data => {
                const seller = Array.isArray(data) ? data[0] : data;
                if (!seller || seller.error) {
                    alert('매도자 정보를 불러오지 못했습니다.');
                    location.href = './sellers.html';
                    return;
                }

                // [추가] 읽기 모드 권한 체크
                if (fromSource === 'totalseller') {
                    const validStatuses = ['대기', '진행중', '완료'];
                    const currentStatus = validStatuses.includes(seller.status) ? seller.status : '대기';
                    const isOwner = (userData && userData.id === seller.user_id);

                    if (!isOwner && (currentStatus === '진행중' || currentStatus === '완료')) {
                        const msg = (currentStatus === '진행중') ? '현재 거래가 진행 중입니다.' : '거래가 완료되었습니다.';
                        alert(msg);
                        $('body').css('overflow', 'hidden').empty().append(`
                            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#f8fafc; color:#64748b; font-family: 'Pretendard Variable', Pretendard, sans-serif; gap:20px; text-align:center; padding: 20px;">
                                <span class="material-symbols-outlined" style="font-size: 80px; color:#cbd5e1; margin-bottom: 10px;">lock_person</span>
                                <div style="font-size:28px; font-weight:800; color:#1e293b; letter-spacing: -0.5px;">${msg}</div>
                                <p style="font-size:16px; line-height: 1.6; color: #64748b; max-width: 400px;">
                                    해당 기업은 현재 거래 단계 보호를 위해<br>상세 리포트 조회가 일시적으로 제한되었습니다.
                                </p>
                                <button onclick="location.href='./totalsellers.html'" 
                                    style="margin-top: 10px; padding:14px 40px; background:#8b5cf6; color:white; border:none; border-radius:50px; font-weight:700; font-size: 15px; cursor:pointer; box-shadow: 0 10px 20px rgba(139, 92, 246, 0.2); transition: all 0.2s;">
                                    매도 기업 목록으로 돌아가기
                                </button>
                            </div>
                        `);
                        return;
                    }
                }

                currentSellerData = seller;

                // 데이터 채우기
                $('#seller-name-editor').text(seller.companyName || '');
                document.title = `${seller.companyName || '매도자'} - 매도자 정보`;
                $('#sidebar-header-title').text(seller.companyName || '매도자 정보');
                $('#seller-industry').val(seller.industry || '선택해주세요');
                
                // 매칭 희망가 및 협의 체크 처리
                const price = seller.matching_price || seller.sale_price || '';
                $('#seller-price').val(price);
                if (price === '협의') {
                    $('#negotiable-check').prop('checked', true);
                    $('#seller-price').prop('readonly', true).css('background', '#f8fafc');
                } else {
                    $('#negotiable-check').prop('checked', false);
                    $('#seller-price').prop('readonly', false).css('background', '#ffffff');
                }

                $('#seller-summary').val(seller.summary || '');
                $('#seller-memo').val(seller.manager_memo || '');

                // 추가 필드 채우기
                $('#seller-ceo').val(seller.ceo_name || '');
                $('#seller-email').val(seller.email || '');
                $('#seller-establishment').val(seller.establishment_date || '');
                $('#seller-address').val(seller.address || '');

                // 재무 정보 (5년치 테이블)
                $('#financial-rows').empty();
                if (seller.financial_data && Array.isArray(seller.financial_data) && seller.financial_data.length > 0) {
                    seller.financial_data.forEach(fin => {
                        createFinancialRow(fin.year, fin.revenue, fin.profit, fin.net_profit, fin.ev_ebitda);
                    });
                } else if (seller.revenue || seller.operating_profit || seller.net_profit || seller.ev_ebitda) {
                    // 기존 단일 데이터 마이그레이션 (EV/EBITDA 포함)
                    createFinancialRow('', seller.revenue, seller.operating_profit, seller.net_profit, seller.ev_ebitda);
                }

                $('#seller-fin-analysis').val(seller.financial_analysis || '');

                // 날짜 및 작성자 정보 바인딩
                if (seller.user_id) {
                    APIcall({
                        action: 'get',
                        table: 'users',
                        id: seller.user_id
                    }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
                        .then(res => res.json())
                        .then(authorData => {
                            const author = Array.isArray(authorData) ? authorData[0] : (authorData.Item || authorData);
                            if (author && author.name) {
                                $('#memo-author-name').text(author.name);
                                $('#memo-author-affiliation').text(author.department || author.affiliation || author.company || "DealChat");
                                $('#memo-author-avatar').attr('src', `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(author.name)}`);
                            }
                        })
                        .catch(err => console.error('Failed to fetch author info:', err));
                }

                if (seller.updated_at) {
                    const d = new Date(seller.updated_at);
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    $('#memo-update-date').text(`최종 수정: ${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`);
                }

                // 진행 상황 chip (표준 상태값만 허용, 나머지는 '대기')
                const validStatuses = ['대기', '진행중', '완료'];
                let currentStatus = '대기';
                
                if (validStatuses.includes(seller.status)) {
                    currentStatus = seller.status;
                } else if (validStatuses.includes(seller.sale_method)) {
                    currentStatus = seller.sale_method;
                }
                
                setChip(currentStatus);

                // 매도 방식 (sale_method 필드가 status가 아닌 경우에만 표시)
                const currentMethod = (['대기', '진행중', '완료'].includes(seller.sale_method)) ? '' : (seller.sale_method || '');
                $('#seller-method').val(currentMethod);

                // textarea 높이 조절
                autoResizeAll();

                // [추가] 읽기 모드 UI 적용
                if (fromSource === 'totalseller') {
                    applySellerReadOnlyMode();
                }

                // ?뚯씪 紐⑸줉 濡쒕뱶
                loadAvailableFiles();
                loadReportTypes();

                // ????덉뒪?좊━ 蹂듭썝
                if (seller.history && Array.isArray(seller.history)) {
                    conversationHistory = seller.history;
                    conversationHistory.forEach(msg => {
                        addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', false);
                    });
                    $chatMessages.scrollTop($chatMessages[0].scrollHeight);
                }
            })
            .catch(err => {
                console.error('Load error:', err);
                alert('데이터 로드 실패');
                location.href = './sellers.html';
            })
            .finally(() => hideLoader());
    }

    // 珥덇린 ?곗씠??濡쒕뱶 ?몄텧
    loadSellerData();
    loadReportTypes();

    // ==========================================
    // 吏꾪뻾 ?꾪솴 Chip
    // ==========================================
    function setChip(value) {
        $('.btn-status-chip').removeClass('active').css({
            background: '#fff', color: '#64748b', borderColor: '#e2e8f0'
        });
        $(`.btn-status-chip[data-value="${value}"]`).addClass('active').css({
            background: '#8b5cf6', color: '#fff', borderColor: '#8b5cf6',
            boxShadow: '0 4px 10px rgba(139,92,246,0.2)'
        });
        $('#seller-status').val(value);
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
        autoResizeTextarea($('#seller-summary'));
        autoResizeTextarea($('#seller-memo'));
        autoResizeTextarea($('#seller-fin-analysis'));
    }

    $('#seller-summary, #seller-memo, #seller-fin-analysis').on('input', function () {
        autoResizeTextarea($(this));
    });

    // ==========================================
    // ?щТ ?뺣낫 ?숈쟻 ??愿뎄    // ==========================================
    function createFinancialRow(year = '', revenue = '', profit = '', netProfit = '', evEbitda = '') {
        const rowId = `fin-row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const rowHtml = `
            <div class="financial-row" id="${rowId}" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; padding: 0 30px 0 12px; box-sizing: border-box; width: 100%;">
                <input type="text" class="fin-year" value="${year}" placeholder="연도"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-revenue format-number" value="${revenue}" placeholder="매출액"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-profit format-number" value="${profit}" placeholder="영업이익"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-net-profit format-number" value="${netProfit}" placeholder="순이익"
                    style="flex: 1.5; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <input type="text" class="fin-ev-ebitda" value="${evEbitda}" placeholder="EV/EBITDA"
                    style="flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 13px; text-align: right; background: #ffffff; box-sizing: border-box;">
                <button type="button" class="btn-remove-row" style="background: none; border: none; cursor: pointer; color: #ef4444; width: 24px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; margin-right: -24px;">
                    <span class="material-symbols-outlined" style="font-size: 18px; font-weight: bold;">remove</span>
                </button>
            </div>
        `;
        $('#financial-rows').append(rowHtml);
    }

    // ?レ옄 ?щ㎎??(肄ㅻ쭏)
    $(document).on('input', '.format-number', function() {
        let val = $(this).val().replace(/[^0-9.-]/g, '');
        if (val) {
            const parts = val.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            $(this).val(parts.join('.'));
        }
    });

    $('#add-financial-btn').on('click', function() {
        createFinancialRow();
    });

    $(document).on('click', '.btn-remove-row', function() {
        $(this).closest('.financial-row').remove();
    });



    // 매도자명 변경 시 제목 업데이트
    // (중복 제거) 매도자명 변경 시 제목 업데이트 로직은 상단의 자동 완성 리스트와 통합되었습니다.

    // ==========================================
    // 리포트 생성 로직
    // ==========================================
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
                <div class="report-card ${isPrimary}" data-id="${report.id}">
                    <h5>
                        ${report.title}
                        ${report.isPrimary ? '' : '<span class="material-symbols-outlined" style="font-size: 16px; color: #8b5cf6;">edit_note</span>'}
                    </h5>
                    <p>${report.description}</p>
                </div>
            `;

            if (report.type === 'format') {
                $formatGrid.append(cardHtml);
            } else {
                $recGrid.append(cardHtml);
            }
        });
    }

    const $reportModal = $('#report-selection-modal');
    const $reportDetailModal = $('#report-gen-detail-modal');

    $('#btn-generate-report').on('click', function () {
        $reportModal.css('display', 'flex');
    });

    $('#close-report-modal').on('click', function () {
        $reportModal.hide();
    });

    $('#close-gen-detail-modal').on('click', function () {
        $reportDetailModal.hide();
    });

    $('#back-to-selection').on('click', function () {
        $reportDetailModal.hide();
        $reportModal.css('display', 'flex');
    });

    $(document).on('click', '.report-card', function () {
        const reportId = $(this).data('id');
        const reportData = availableReportTypes.find(r => r.id === reportId);
        if (!reportData) return;

        $('#selected-report-title').text(reportData.title);
        $('#selected-report-desc').text(reportData.description);
        $('#report-instruction').val(reportData.instruction);

        $reportModal.hide();
        $reportDetailModal.css('display', 'flex');
    });

    $('#start-generate-report').on('click', async function () {
        const instruction = $('#report-instruction').val().trim();
        const language = $('#report-language').val();
        const reportType = $('#selected-report-title').text();

        if (!instruction) {
            alert('만들려는 리포트에 대한 설명을 입력해주세요.');
            $('#report-instruction').focus();
            return;
        }

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> 생성 중..');

        try {
            const prompt = `[Report Type] ${reportType}\n[Language] ${language}\n[Instruction] ${instruction}`;
            
            // Context 구성
            let infoCtx = `=== 매도자 기본 정보 ===\n`;
            infoCtx += `기업명: ${$('#seller-name-editor').text()}\n`;
            infoCtx += `산업: ${$('#seller-industry').val()}\n`;
            infoCtx += `소개: ${$('#seller-summary').val()}\n`;
            infoCtx += `재무분석: ${$('#seller-fin-analysis').val()}\n`;
            infoCtx += `담당자의견: ${$('#seller-memo').val()}\n`;

            const historyCtx = conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
            
            let ragContext = "";
            try {
                ragContext = await searchVectorDB(`${reportType} 리포트 관련 정보`, sellerId);
            } catch (e) {
                console.warn("RAG Search failed:", e);
            }

            const fullContext = infoCtx + "\n[Conversation History]\n" + historyCtx + (ragContext ? "\n=== 관련 문서 내용 ===\n" + ragContext : "");

            const response = await addAiResponse(prompt, fullContext);
            const data = await response.json();
            const generatedContent = data.answer;

            if (generatedContent) {
                downloadTextFile(`${reportType}.txt`, generatedContent);
                $reportDetailModal.hide();
                alert(`[${reportType} 생성 완료]\n\n파일이 다운로드되었습니다.`);
            } else {
                throw new Error('응답을 생성할 수 없습니다.');
            }
        } catch (error) {
            console.error('리포트 생성 실패:', error);
            alert('리포트 생성 중 오류가 발생했습니다.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    $(window).on('click', function (e) {
        if ($(e.target).is($reportModal)) $reportModal.hide();
        if ($(e.target).is($reportDetailModal)) $reportDetailModal.hide();
    });

    // ==========================================
    // 기존 코드..
    // ==========================================
    function getSummaryFromEditor() {
        return $('#seller-summary').val().trim();
    }

    function buildPayload(isDraft) {
        const name = $('#seller-name-editor').text().trim();
        const industryVal = $('#seller-industry').val();
        const industry = (industryVal === '기타' && $('#seller-industry-etc').val().trim())
                         ? $('#seller-industry-etc').val().trim()
                         : industryVal;
        const price = $('#seller-price').val().trim();
        const status = $('#seller-status').val();
        const method = $('#seller-method').val().trim();
        const summary = getSummaryFromEditor();
        const memo = $('#seller-memo').val().trim();

        // 추가 필드 수집
        const ceo = $('#seller-ceo').val().trim();
        const email = $('#seller-email').val().trim();
        const establishment = $('#seller-establishment').val().trim();
        const address = $('#seller-address').val().trim();
        const financial_analysis = $('#seller-fin-analysis').val().trim();

        // 재무 정보 테이블 수집
        const financial_data = [];
        $('.financial-row').each(function() {
            const year = $(this).find('.fin-year').val().trim();
            const revenue = $(this).find('.fin-revenue').val().replace(/,/g, '').trim();
            const profit = $(this).find('.fin-profit').val().replace(/,/g, '').trim();
            const net_profit = $(this).find('.fin-net-profit').val().replace(/,/g, '').trim();
            const ev_ebitda = $(this).find('.fin-ev-ebitda').val().trim();
            
            if (year || revenue || profit || net_profit || ev_ebitda) {
                financial_data.push({ year, revenue, profit, net_profit, ev_ebitda });
            }
        });

        if (!name || industry === '선택해주세요' || !summary) {
            alert('기업명, 산업, 회사 소개는 필수 입력입니다.');
            return null;
        }

        return {
            companyName: name,
            company_name: name, // 추가
            name: name,         // 추가
            industry,
            sale_price: price,
            sale_method: method, // 실제 매도 방식
            status: status,      // 진행 상황
            summary,
            manager_memo: memo,
            ceo_name: ceo,
            email: email,
            establishment_date: establishment,
            address: address,
            financial_data: financial_data, // 추가 배열 데이터
            revenue: financial_data.length > 0 ? financial_data[0].revenue : '', // 호환성을 위해 첫째 데이터
            operating_profit: financial_data.length > 0 ? financial_data[0].profit : '',
            net_profit: financial_data.length > 0 ? financial_data[0].net_profit : '',
            ev_ebitda: financial_data.length > 0 ? financial_data[0].ev_ebitda : '',
            financial_analysis: financial_analysis,
            is_temporary: isDraft,
            user_id,
            updated_at: new Date().toISOString()
        };
    }

    function saveSeller(isDraft, $btn) {
        const payload = buildPayload(isDraft);
        if (!payload) return;

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined" style="font-size:16px;">hourglass_top</span> 저장 중..');

        if (isNew) {
            payload.action = 'create';
            payload.table = 'sellers';
            payload.created_at = new Date().toISOString();
        } else {
            payload.action = 'update';
            payload.table = 'sellers';
            payload.id = sellerId;
        }

        APIcall(payload, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(result => {
                if (result.error) {
                    alert('저장 중 오류: ' + result.error);
                } else {
                    if (isNew && result.id) {
                        // 신규 생성 후 URL 업데이트
                        alert('저장되었습니다.');
                        location.href = `./seller_editor.html?id=${result.id}`;
                    } else {
                        alert('저장되었습니다.');
                        if (payload.updated_at) {
                            const d = new Date(payload.updated_at);
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            const dd = String(d.getDate()).padStart(2, '0');
                            const hh = String(d.getHours()).padStart(2, '0');
                            const min = String(d.getMinutes()).padStart(2, '0');
                            $('#memo-update-date').text(`최종 수정: ${d.getFullYear()}.${mm}.${dd} ${hh}:${min}`);
                        }
                    }
                }
            })
            .catch(err => { console.error(err); alert('저장 요청 실패'); })
            .finally(() => { $btn.prop('disabled', false).html(origHtml); });
    }

    $('#btn-save-seller').on('click', function () { saveSeller(false, $(this)); });
    $('#btn-draft-seller').on('click', function () { saveSeller(true, $(this)); });

    // ==========================================
    // 삭제
    // ==========================================
    $('#btn-delete-seller').on('click', function () {
        if (!confirm('정말로 이 매도자 정보를 삭제하시겠습니까?')) return;
        APIcall({ action: 'delete', table: 'sellers', id: sellerId }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(result => {
                if (result.error) alert('삭제 오류: ' + result.error);
                else { alert('삭제되었습니다.'); location.href = './sellers.html'; }
            })
            .catch(() => alert('삭제 요청 실패'));
    });

    // ==========================================
    // 파일 업로드/ 목록
    // ==========================================
    function loadAvailableFiles() {
        if (isNew) return;
        APIcall({ action: 'get', table: 'sellers_files', sellerId }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(data => {
                availableFiles = Array.isArray(data) ? data : [];
                renderFileList();
            })
            .catch(err => console.error('File load error:', err));
    }

    function renderFileList() {
        const $listTraining = $('#source-list-training');
        const $listFinance = $('#source-list-finance');
        const $listNonTraining = $('#source-list-non-training');
        $listTraining.empty();
        $listFinance.empty();
        $listNonTraining.empty();

        if (availableFiles.length === 0) {
            $listTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>');
            $listFinance.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>');
            $listNonTraining.html('<li style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">파일 없음</li>');
            return;
        }

        availableFiles.forEach(file => {
            let $list;
            if (file.source_type === 'training') $list = $listTraining;
            else if (file.source_type === 'finance') $list = $listFinance;
            else $list = $listNonTraining;
            $list.append(`
                <li style="display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9;">
                    <span class="material-symbols-outlined" style="font-size: 18px; color: #64748b;">description</span>
                    <span style="flex: 1; font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                          title="${file.file_name || ''}">${file.file_name || ''}</span>
                    <button class="btn-remove-file" data-id="${file.id}"
                        style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
                    </button>
                </li>
            `);
        });
    }

    // 파일 추가 버튼
    $('#add-source-training').on('click', function () {
        currentSourceType = 'training';
        $('#file-upload').click();
    });
    $('#add-source-finance').on('click', function () {
        currentSourceType = 'finance';
        $('#file-upload').click();
    });
    $('#add-source-non-training').on('click', function () {
        currentSourceType = 'non-training';
        $('#file-upload').click();
    });

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
                    // sellers_files 테이블에 연결
                    await APIcall({
                        action: 'create',
                        table: 'sellers_files',
                        sellerId,
                        file_key: uploadResult.key,
                        file_name: file.name,
                        source_type: currentSourceType,
                        user_id
                    }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).then(r => r.json());
                }
            } catch (err) {
                console.error('Upload error:', err);
                alert(`${file.name} 업로드 실패`);
            }
        }
        this.value = '';
        loadAvailableFiles();
    });

    // 파일 삭제
    $(document).on('click', '.btn-remove-file', function () {
        const fileId = $(this).data('id');
        if (!confirm('파일을 삭제하시겠습니까?')) return;
        APIcall({ action: 'delete', table: 'sellers_files', id: fileId }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
            .then(r => r.json())
            .then(res => {
                if (res.error) alert('삭제 오류: ' + res.error);
                else loadAvailableFiles();
            });
    });

    // ==========================================
    // AI 채팅
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
                <div style="width:32px; height:32px; border-radius:50%; background:${isUser ? '#8b5cf6' : '#f1f5f9'};
                             display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <span class="material-symbols-outlined" style="font-size:18px; color:${isUser ? '#fff' : '#64748b'};">${isUser ? 'person' : 'smart_toy'}</span>
                </div>
                <div style="max-width:80%; padding:12px 16px; border-radius:12px;
                             background:${isUser ? '#8b5cf6' : '#f8fafc'};
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

        // AI 응답 placeholder
        const $aiPlaceholder = $('<div class="ai-message" style="display:flex; align-items:flex-start; gap:10px; margin-bottom:16px;"><div style="width:32px; height:32px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:18px; color:#64748b;">smart_toy</span></div><div class="ai-typing" style="padding:12px 16px; border-radius:12px; background:#f8fafc; color:#64748b; font-size:14px;">답변 생성 중..</div></div>');
        $chatMessages.append($aiPlaceholder);
        $chatMessages[0].scrollTo({ top: $chatMessages[0].scrollHeight, behavior: 'smooth' });

        try {
            // 업로드된 파일들의 텍스트 추출 (학습용 파일만)
            let sourceTexts = "";
            const trainingFiles = availableFiles.filter(f => f.source_type === 'training');
            
            // Vector Search 연동
            let ragContext = "";
            if (!isNew) {
                ragContext = await searchVectorDB(msg, sellerId);
            }

            const context = `[매도자 기본 필드 정보]\n기업명: ${$('#seller-name-editor').text()}\n산업: ${$('#seller-industry').val()}\n대표자: ${$('#seller-ceo').val()}\n이메일: ${$('#seller-email').val()}\n설립일자: ${$('#seller-establishment').val()}\n주소: ${$('#seller-address').val()}\n희망가: ${$('#seller-price').val()}\n진행상황: ${$('#seller-status').val()}\n회사 소개: ${getSummaryFromEditor()}\n재무 정보: 매출액 ${$('#fin-revenue').val()}, 영업이익 ${$('#fin-operating-profit').val()}, 순이익 ${$('#fin-net-profit').val()}, EV/EBITDA ${$('#fin-ev-ebitda').val()}\n재무 분석: ${$('#seller-fin-analysis').val()}\n매도 정보: ${$('#seller-memo').val()}\n\n[참고 문서 내용]\n${ragContext}`;
            
            const response = await addAiResponse(msg, context);
            const data = await response.json();
            const aiReply = data.answer || '답변을 받지 못했습니다.';
            
            $aiPlaceholder.find('.ai-typing').text(aiReply);
            conversationHistory.push({ role: 'assistant', content: aiReply, timestamp: new Date().toISOString() });

            // 대화 히스토리 DB 저장 (백그라운드)
            if (!isNew) {
                APIcall({ action: 'update', table: 'sellers', id: sellerId, history: conversationHistory, updated_at: new Date().toISOString() },
                    SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' }).catch(() => {});
            }
        } catch (err) {
            console.error('AI error:', err);
            $aiPlaceholder.find('.ai-typing').text('AI 응답에 실패했습니다. 다시 시도해주세요.');
        }
    }

    $('#send-btn').on('click', sendMessage);
    $chatInput.on('keypress', function (e) {
        if (e.which === 13 && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    $chatInput.on('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    // 대화 삭제
    $('#clear-history-btn').on('click', function () {
        if (!confirm('대화 내용을 모두 삭제하시겠습니까?')) return;
        conversationHistory = [];
        $chatMessages.empty();
        $welcomeScreen.show();
    });

    // suggested prompts
    $(document).on('click', '.prompt-chip', function () {
        $chatInput.val($(this).text());
        sendMessage();
    });

    // ==========================================
    // AI 자동 입력 (Dealbook 참고 추출 로직)
    // ==========================================
    async function autoFillFromFiles($btn) {
        if (isNew || availableFiles.length === 0) {
            alert('먼저 파일을 업로드하고 저장한 후 시도해 주세요.');
            return;
        }

        const origHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 20px;">sync</span> 추출 중..');

        try {
            // RAG를 통해 파일에서 핵심 정보 추출
            const query = "Extract company name, CEO name, email, establishment date, business address, revenue, operating profit, net profit, EV/EBITDA, and general summary.";
            const contextRaw = await searchVectorDB(query, sellerId);

            const prompt = `
                업로드된 자료를 분석하여 매도자 기업의 주요 정보를 추출해주세요.
                만약 자료에서 확인되지 않는 정보는 빈 문자열("")로 처리하세요.
                
                반드시 아래 JSON 형식으로만 응답하세요.
                {
                  "ceoName": "??쒖옄 ?깅챸",
                  "email": "?대찓??,
                  "establishment": "?ㅻ┰?쇱옄(YYYY-MM-DD)",
                  "address": "?ъ뾽??二쇱냼",
                  "summary": "?뚯궗 ?뚭컻 (500???대궡 ?붿빟)",
                  "revenue": "留ㅼ텧??(?レ옄留?",
                  "operatingProfit": "?곸뾽?댁씡 (?レ옄留?",
                  "netProfit": "?밴린?쒖씠??(?レ옄留?",
                  "evEbitda": "EV/EBITDA (?レ옄留?"
                }
            `;

            const response = await addAiResponse(prompt, contextRaw);
            const data = await response.json();
            const aiAnswer = data.answer.trim();
            
            // JSON ?뚯떛
            let jsonData = null;
            const jsonMatch = aiAnswer.match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonData = JSON.parse(jsonMatch[0]);
            else jsonData = JSON.parse(aiAnswer);

            if (jsonData) {
                if (jsonData.companyName) $('#seller-name-editor').text(jsonData.companyName);
                if (jsonData.ceoName) $('#seller-ceo').val(jsonData.ceoName);
                if (jsonData.email) $('#seller-email').val(jsonData.email);
                if (jsonData.establishment) $('#seller-establishment').val(jsonData.establishment);
                if (jsonData.address) $('#seller-address').val(jsonData.address);
                if (jsonData.summary) $('#seller-summary').val(jsonData.summary);
                
                // 泥?踰덉㎏ ?됱뿉 ?щТ ?곗씠???낅젰
                const $firstRow = $('.financial-row').first();
                if (jsonData.revenue) $firstRow.find('.fin-revenue').val(jsonData.revenue).trigger('input');
                if (jsonData.operatingProfit) $firstRow.find('.fin-profit').val(jsonData.operatingProfit).trigger('input');
                if (jsonData.netProfit) $firstRow.find('.fin-net-profit').val(jsonData.netProfit).trigger('input');
                if (jsonData.evEbitda) $firstRow.find('.fin-ev-ebitda').val(jsonData.evEbitda);
                
                autoResizeAll();
                alert('湲곗뾽 ?뺣낫媛 ?먮룞?쇰줈 異붿텧 諛??낅젰?섏뿀?듬땲??');
            }
        } catch (err) {
            console.error('Auto-fill error:', err);
            alert('?뺣낫 異붿텧???ㅽ뙣?덉뒿?덈떎. (臾몄꽌媛 ?몃뜳??以묒씠嫄곕굹 AI ?묐떟 ?ㅻ쪟)');
        } finally {
            $btn.prop('disabled', false).html(origHtml);
        }
    }

    $('#ai-auto-fill-btn').on('click', function() { autoFillFromFiles($(this)); });

    function getIndustryIcon(industry) {
        const iconMap = {
            'AI': 'psychology',
            'IT쨌?뺣낫?듭떊': 'terminal',
            'SaaS쨌?붾（??: 'cloud_queue',
            '寃뚯엫': 'sports_esports',
            '怨듦났쨌援?갑': 'shield',
            '愿愿뫢룸젅?': 'beach_access',
            '援먯쑁쨌?먮??뚰겕': 'school',
            '湲덉쑖쨌??뚰겕': 'account_balance',
            '?띉룹엫쨌?댁뾽': 'agriculture',
            '?쇱씠?꾩뒪???: 'style',
            '紐⑤퉴由ы떚': 'directions_car',
            '臾명솕?덉닠쨌肄섑뀗痢?: 'theater_comedy',
            '諛붿씠?ㅒ룻뿬?ㅼ???: 'medical_services',
            '遺?숈궛': 'home_work',
            '酉고떚쨌?⑥뀡': 'checkroom',
            '?먮꼫吏쨌?섍꼍': 'eco',
            '?몄떇?끒룹냼?곴났??: 'restaurant',
            '?곗＜쨌??났': 'rocket',
            '?좏넻쨌臾쇰쪟': 'local_shipping',
            '?쒖“쨌嫄댁꽕': 'factory',
            '?뚮옯?셋룹빱裕ㅻ땲??: 'groups',
            '湲고?': 'storefront'
        };
        return iconMap[industry] || 'storefront';
    }

    function applySellerReadOnlyMode() {
        console.log('[Info] Applying Professional Seller Report Mode');
        const primaryColor = '#8b5cf6'; // Seller Purple
        
        // 1. ?꾩슜 CSS 二쇱엯 (?붿옄???뺣? 蹂댁젙)
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
                box-shadow: 0 10px 40px rgba(139, 92, 246, 0.08) !important;
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
            }

            .sidebar .panel-header h2 {
                color: #ffffff !important;
                font-size: 14px !important;
                font-weight: 600 !important;
            }

            .sidebar-nav {
                padding: 0 40px 40px 40px !important;
            }

            .sidebar-nav > div {
                margin-bottom: 36px !important;
                margin-top: 0 !important;
            }

            .sidebar-nav p {
                color: var(--report-primary) !important;
                font-size: 13px !important;
                margin: 0 0 6px 0 !important;
                font-weight: 700 !important;
            }

            /* 湲곗뾽紐?諛뺤뒪 ?쒓굅 */
            #seller-name-editor {
                font-size: 15px !important;
                font-weight: 500 !important;
                color: var(--report-text-dark) !important;
            }
            .sidebar-nav div:has(> #seller-name-editor) {
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
                min-height: unset !important;
                height: auto !important;
            }

            input:disabled, select:disabled, textarea:disabled {
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
            }

            select:disabled {
                -webkit-appearance: none !important;
                appearance: none !important;
            }

            /* 移??ㅽ??? ?꾩껜 ?몄텧 諛?鍮꾪솢?깊솕 ?곹깭 濡쒖쭅 */
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

            /* 遺덊븘?뷀븳 ?붿냼 ?④? 泥섎━ */
            .main-content, #guide-panel, .welcome-screen, .panel-resize-handle, 
            #btn-share-seller-trigger, #ai-auto-fill-btn, 
            .btn-icon-only[title="紐⑸줉?쇰줈"], #btn-delete-seller, 
            #report-history-panel, #btn-save-seller-container, 
            .btn-add-row, .btn-remove-row-col, 
            label:has(#negotiable-check),
            #add-financial-btn,
            .sidebar-nav > div:has(#ai-auto-fill-btn),
            .sidebar-nav div:has(> #seller-email), /* ?대찓???뱀뀡 ?④? */
            .sidebar > div:last-child { 
                display: none !important;
            }

            @media print {
                body, html { overflow: visible !important; height: auto !important; }
                .sidebar { width: 100% !important; border: none !important; box-shadow: none !important; }
            }
        `;
        $('<style id="report-mode-css">').text(reportStyles).appendTo('head');

        // 2. ?낅젰 鍮꾪솢?깊솕 諛?媛?蹂댁젙
        const priceVal = $('#seller-price').val();
        if (priceVal && !isNaN(priceVal) && priceVal !== '협의') {
            $('#seller-price').val(priceVal + ' 억');
        }
        $('#seller-name-editor').attr('contenteditable', 'false');
        $('input, select, textarea').prop('disabled', true);

        // 3. ?띿뒪???곸뿭 div 援먯껜
        ['#seller-summary', '#seller-memo', '#seller-fin-analysis'].forEach(sel => {
            const $ta = $(sel);
            if ($ta.length && !$ta.next('.report-div').length) {
                const content = $ta.val() || '';
                $ta.after(`<div class="report-div" style="white-space:pre-wrap; font-size:15px; color:#475569; line-height:1.6; padding:0;">${content}</div>`).hide();
            }
        });

        // 4. ?щТ ?뚯씠釉?蹂??(臾댁“嫄??ㅽ뻾)
        const tableBaseStyle = `width:100%;border-collapse:collapse;font-size:13px;`;
        const thStyle = `background:#f1f5f9;color:#475569;font-weight:700;font-size:11px;padding:9px 12px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;`;
        const thLastStyle = thStyle + 'border-right:none;';
        const tdBase = `padding:10px 12px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;color:#334155;`;
        
        const rowData = [];
        $('#financial-rows > div').each(function() {
            rowData.push({
                year: $(this).find('.fin-year').val() || '',
                revenue: $(this).find('.fin-revenue').val() || '',
                profit: $(this).find('.fin-profit').val() || '',
                net: $(this).find('.fin-net-profit').val() || '',
                ev: $(this).find('.fin-ev-ebitda').val() || ''
            });
        });

        // ?곗씠?곌? ?꾩삁 ?놁쑝硫?鍮????섎굹 異붽?
        if (rowData.length === 0) {
            rowData.push({ year: '', revenue: '', profit: '', net: '', ev: '' });
        }

        let tableHtml = `
            <table style="${tableBaseStyle}">
                <thead>
                    <tr>
                        <th style="${thStyle} width:10%">연도</th>
                        <th style="${thStyle} width:22.5%">매출액(억)</th>
                        <th style="${thStyle} width:22.5%">영업이익(억)</th>
                        <th style="${thStyle} width:22.5%">당기순이익(억)</th>
                        <th style="${thLastStyle} width:22.5%">EV/EBITDA</th>
                    </tr>
                </thead>
                <tbody>
        `;
        rowData.forEach((r, idx) => {
            const last = idx === rowData.length - 1;
            const nb = last ? 'border-bottom:none;' : '';
            const tdLast = `border-right:none; ${nb}`;
            tableHtml += `
                <tr>
                    <td style="${tdBase} text-align:center; ${nb}">${r.year}</td>
                    <td style="${tdBase} text-align:right; ${nb}">${r.revenue}</td>
                    <td style="${tdBase} text-align:right; ${nb}">${r.profit}</td>
                    <td style="${tdBase} text-align:right; ${nb}">${r.net}</td>
                    <td style="${tdBase} text-align:center; ${tdLast}">${r.ev}</td>
                </tr>
            `;
        });
        tableHtml += `</tbody></table>`;
        $('#financial-section').empty().append('<p style="color:#8b5cf6; font-size:13px; font-weight:700; margin-bottom:8px;">재무 정보</p>' + tableHtml);

        // 5. ?뚰꽣留덊겕
        if (!$('#report-watermark').length) {
            $('<div id="report-watermark">DealChat</div>').css({
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)',
                fontSize: '100px', fontWeight: '900', color: primaryColor, opacity: '0.04',
                pointerEvents: 'none', zIndex: '9999', letterSpacing: '10px'
            }).appendTo('body');
        }
        document.title = (currentSellerData?.companyName || '매도자') + ' 리포트 - DealChat';
    }
});
