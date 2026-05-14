/**
 * dealbook_panel_loader.js
 * dealbook 3종 에디터(기업정보/매수자/매도자)의 공통 패널을 동기적으로 주입합니다.
 *
 * 사용 방법:
 *   <body> 태그에 data-page-type 속성 추가:
 *     data-page-type="companies"  → 기업정보 에디터
 *     data-page-type="buyers"     → 매수자 에디터 (리포트 토글 버튼 포함)
 *     data-page-type="sellers"    → 매도자 에디터 (데이터 소스 2섹션)
 *
 *   <div id="dealbook-panels-mount"></div> 위치에 패널이 주입됩니다.
 */
(function () {
    const pageType = document.body.dataset.pageType || 'companies';
    const hasSidebarToggle = pageType !== 'buyers';
    const hasReportToggle  = pageType === 'buyers';
    const isDoubleSrc      = pageType === 'sellers';

    /* ─── 중앙 AI 채팅 패널 ─── */
    const chatPanel = `
        <main class="main-content" style="height: 100vh; overflow: hidden;">
            <header class="panel-header" style="height: 65px; padding: 0 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; position: relative;">
                <h2 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: var(--page-theme-color);">smart_toy</span>
                    AI 인텔리전스
                </h2>
                <div style="position: absolute; right: 15px; display: flex; align-items: center; gap: 8px;">
                    <button id="clear-history-btn" class="btn-icon-only" title="대화 삭제">
                        <span class="material-symbols-outlined" style="font-size: 20px;">delete_sweep</span>
                    </button>
                    ${hasReportToggle ? `
                    <button id="btn-report-view-toggle" class="btn-icon-only" title="리포트 보기" style="display: none;">
                        <span class="material-symbols-outlined" style="font-size: 20px;">description</span>
                    </button>` : ''}
                </div>
            </header>

            ${hasSidebarToggle ? `
            <button class="btn-toggle-sidebar" id="show-sidebar"
                style="position: fixed; top: 20px; left: 20px; z-index: 100; display: none;
                       background: white; border: 1px solid var(--border-color); border-radius: 50%;
                       width: 40px; height: 40px; box-shadow: var(--shadow-sm);
                       align-items: center; justify-content: center;">
                <span class="material-symbols-outlined">menu</span>
            </button>` : ''}

            <section class="chat-area" id="chat-messages"
                style="position: relative; display: flex; flex-direction: column; min-height: 0; padding: 20px;">
                <div class="welcome-screen"
                    style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; flex: 1; margin: 0 auto; width: 100%;">
                    <h1 class="welcome-title">무엇을 도와드릴까요?</h1>
                    <p class="welcome-subtitle">업로드한 소스를 바탕으로 질문에 답하거나 요약해 드립니다.</p>
                    <div class="suggested-prompts">
                        <button class="prompt-chip" id="prompt-chip-company-opinion">이 기업에 대한 의견을 요약해줘</button>
                    </div>
                </div>
            </section>

            <footer class="input-area"
                style="padding: 12px 20px; border-top: 1px solid var(--border-color); background: #ffffff; display: flex; flex-direction: column; align-items: flex-start;">
                <div class="model-selector-container" style="margin-bottom: 8px; position: relative;">
                    <button id="btn-model-selector" class="btn-model-selector" title="AI 모델 선택">
                        <span class="material-symbols-outlined" style="font-size: 18px; color: #6366f1;">deployed_code</span>
                        <span id="current-model-name" style="font-size: 13px;">연결 중...</span>
                        <span class="material-symbols-outlined" style="font-size: 16px;">expand_less</span>
                    </button>
                    <div id="model-dropdown" class="model-dropdown"
                        style="display: none; position: absolute; bottom: calc(100% + 8px); left: 0;
                               background: #ffffff; border: 1px solid var(--border-color); border-radius: 12px;
                               box-shadow: 0 4px 20px rgba(0,0,0,0.1); min-width: 240px; z-index: 9999; overflow: hidden; padding: 0;">
                    </div>
                </div>
                <div class="input-wrapper"
                    style="max-width: 100%; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 2px 10px rgba(0,0,0,0.05); border-radius: 20px;">
                    <textarea id="chat-input" placeholder="업로드된 소스에 대해 질문해보세요..." rows="1"
                        style="background: transparent; color: #334155; font-size: 15px; margin: 0; padding-top: 8px; padding-bottom: 8px;"></textarea>
                    <div class="input-tools-right">
                        <button class="btn-send" id="send-btn">
                            <span class="material-symbols-outlined" style="color: var(--page-theme-color);">send</span>
                        </button>
                    </div>
                </div>
            </footer>
        </main>`;

    /* ─── 우측 데이터 소스 패널 (single: companies·buyers) ─── */
    const singleSrc = `
        <div class="data-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px;">
                <h3 style="font-size: 14px; font-weight: 700; color: var(--text-main); margin: 0;">학습 데이터</h3>
                <button class="btn-new-source" id="add-source-training"
                    style="width: auto; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
                    <span class="material-symbols-outlined" style="font-size: 16px;">add</span>
                    <span>추가</span>
                </button>
            </div>
            <div class="file-list-card" id="training-drop-zone"
                style="background: white; border: 1px solid var(--border-color); border-radius: 12px; min-height: 100px; max-height: 600px; overflow-y: auto; margin-bottom: 8px;">
                <ul class="source-list" id="source-list-training" style="margin: 0; padding: 0; list-style: none;"></ul>
            </div>
            <p style="font-size: 11px; color: var(--text-secondary); margin-top: 6px; padding: 0 4px; line-height: 1.5;">
                <span style="color: var(--page-theme-color); font-weight: 600;">추천 데이터:</span> IR 자료, 재무제표, 티저(Teaser), 투자 제안서 등
            </p>
        </div>`;

    /* ─── 우측 데이터 소스 패널 (double: sellers) ─── */
    const doubleSrc = `
        <div class="data-section" id="company-search-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px;">
                <h3 style="font-size: 14px; font-weight: 700; color: var(--text-main); margin: 0;">MY Companies에서 불러오기</h3>
                <button id="btn-direct-input" class="btn-new-source"
                    style="width: auto; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
                    <span class="material-symbols-outlined" style="font-size: 16px;">edit_note</span>
                    <span>직접 입력</span>
                </button>
            </div>
            <div style="position: relative;">
                <input type="text" id="company-search-input" class="db-field-input"
                    placeholder="연동할 기업명을 검색하세요..."
                    style="border-radius: 12px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                <div id="company-search-suggestions"
                    style="display: none; position: absolute; top: 52px; left: 0; right: 0; background: rgba(255, 255, 255, 0.98); backdrop-filter: blur(10px); border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); z-index: 10000; overflow-y: auto; max-height: 300px; padding: 8px 0; border: 1px solid rgba(0,0,0,0.05);"></div>
            </div>
        </div>
        <div class="data-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px;">
                <h3 style="font-size: 14px; font-weight: 700; color: var(--text-main); margin: 0;">학습데이터(기업 연동)</h3>
            </div>
            <div class="file-list-card"
                style="background: white; border: 1px solid var(--border-color); border-radius: 12px; min-height: 100px; max-height: 200px; overflow-y: auto; margin-bottom: 8px;">
                <ul class="source-list" id="source-list-training" style="margin: 0; padding: 0; list-style: none;"></ul>
            </div>
        </div>
        <div class="data-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px;">
                <h3 style="font-size: 14px; font-weight: 700; color: var(--text-main); margin: 0;">학습데이터(추가 학습)</h3>
                <button class="btn-new-source" id="add-source-additional"
                    style="width: auto; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
                    <span class="material-symbols-outlined" style="font-size: 16px;">add</span>
                    <span>추가</span>
                </button>
            </div>
            <div class="file-list-card"
                style="background: white; border: 1px solid var(--border-color); border-radius: 12px; min-height: 100px; max-height: 300px; overflow-y: auto;">
                <ul class="source-list" id="source-list-additional" style="margin: 0; padding: 0; list-style: none;"></ul>
            </div>
            <p style="font-size: 11px; color: var(--text-secondary); margin-top: 6px; padding: 0 4px; line-height: 1.5;">
                <span style="color: var(--page-theme-color); font-weight: 600;">추천 데이터:</span> IR 자료, 재무제표, 티저(Teaser), 투자 제안서 등<br>
                <span style="opacity: 0.8;">* AI 분석에 반영될 수 있는 추가 학습 데이터입니다.</span>
            </p>
        </div>`;

    const backUrl = `/my_${pageType}`;

    const rightPanel = `
        <aside class="right-panel" id="guide-panel">
            <div class="panel-header"
                style="height: 65px; padding: 0 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; position: relative;">
                <button class="btn-icon-only" onclick="location.href=resolveUrl('${backUrl}')" title="목록으로"
                    style="color: var(--text-secondary); position: absolute; left: 15px; margin-left: 0;">
                    <span class="material-symbols-outlined" style="font-size: 24px;">arrow_back</span>
                </button>
                <h2 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0; display: flex; align-items: center; gap: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: #10b981;">folder_managed</span>
                    데이터 소스
                </h2>
            </div>
            <div class="panel-content"
                style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; padding: 20px;">
                ${isDoubleSrc ? doubleSrc : singleSrc}
                <div class="db-ai-fill-section" style="margin-bottom: 0;">
                    <button id="ai-auto-fill-btn" class="db-ai-fill-btn">
                        <span class="material-symbols-outlined">auto_awesome</span>
                        <span>분석된 파일로 AI가 자동 입력하기</span>
                    </button>
                    <p class="db-ai-fill-desc">* 업로드된 파일 내용을 바탕으로 기본 정보를 추출합니다.</p>
                </div>
                <input type="file" id="file-upload" multiple style="display: none;" accept=".pdf,.doc,.docx,.txt">
            </div>
        </aside>`;

    const mount = document.getElementById('dealbook-panels-mount');
    if (mount) {
        mount.insertAdjacentHTML('afterbegin', chatPanel + rightPanel);

        const companyOpinionChip = document.getElementById('prompt-chip-company-opinion');
        if (companyOpinionChip) {
            companyOpinionChip.dataset.prompt = `이 기업의 강점에 대해 심사역 관점에서 디테일하게 써줄 수 있을까?
단, 기업명은 '동사'로 치환해서 작성해주고, 주요 서비스나 아이템에 대해서는 직접적인 언급을 않고 내용을 위주로 작성해줘.
그리고 모든 내용은 다음의 규칙을 준수해줘

[소제목]
본문

[소제목] 부분은 너가 본문 내용에 맞춰서 임의의 소제목을 써줘야해
그리고 소제목과 본문 사이는 줄바꿈처리도 해줘`;
        }
    }
})();
