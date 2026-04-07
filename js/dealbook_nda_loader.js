/**
 * dealbook_nda_loader.js
 * dealbook 3종 에디터의 NDA(비밀유지확약서) 모달을 동기적으로 주입합니다.
 *
 * 사용 방법:
 *   <body data-page-type="companies|buyers|sellers"> 속성으로 페이지 타입 지정
 *   페이지 타입에 따라 NDA 본문 텍스트가 자동으로 달라집니다.
 */
(function () {
    const pageType = document.body.dataset.pageType || 'companies';

    const subjects = {
        companies: '기업의 모든 정보(재무 현황, 영업 기밀, 거래 조건 등)',
        buyers:    '관심 매수자의 모든 정보(매칭 조건, 투자 성향, 기밀 검토 사항 등)',
        sellers:   '매도 기업의 모든 정보(재무 현황, 영업 기밀, 거래 조건 등)',
    };

    const subject = subjects[pageType] || subjects.companies;

    const html = `
    <div class="modal fade" id="nda-modal" tabindex="-1" aria-labelledby="ndaModalLabel" aria-hidden="true" style="z-index: 1060;">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-0" style="border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden;">
                <div class="modal-header border-0 pb-0 pt-4 px-4 bg-white d-flex align-items-center justify-content-between">
                    <h5 class="modal-title fw-bold" id="ndaModalLabel"
                        style="font-size: 20px; color: #1e293b; display: flex; align-items: center; gap: 10px;">
                        <span class="material-symbols-outlined" style="color: var(--page-theme-color); font-size: 28px;">verified_user</span>
                        비밀유지확약서 (NDA)
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body p-4 bg-white">
                    <div class="nda-content-box p-4 mb-4"
                        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; font-size: 13.5px; color: #475569; line-height: 1.8; max-height: 280px; overflow-y: auto;">
                        <p class="mb-3 fw-bold"
                            style="color: #1e293b; font-size: 15px; border-bottom: 2px solid var(--page-theme-light); padding-bottom: 8px;">
                            [정보 제공에 관한 비밀유지 의무]</p>
                        본인은 'DealChat' 서비스를 통해 제공받는 ${subject}가 극히 기밀임을 인지하며, 다음 사항을 준수할 것을 확약합니다.<br><br>
                        <span style="color: var(--page-theme-color); font-weight: 600;">1. 정보의 사용 목적 제한</span><br>
                        제공받은 정보를 본 거래의 검토 목적 이외의 용도로 사용하지 아니한다.<br><br>
                        <span style="color: var(--page-theme-color); font-weight: 600;">2. 제3자 누설 금지</span><br>
                        정보의 내용 및 거래 진행 사실을 제3자에게 누설하거나 공개하지 아니한다.<br><br>
                        <span style="color: var(--page-theme-color); font-weight: 600;">3. 위반 시 책임 보상</span><br>
                        본 확약 사항을 위반하여 상대방에게 손해가 발생할 경우, 모든 법적 책임을 부담하며 손해를 전액 배상한다.<br><br>
                        위의 내용을 충분히 숙지하였으며, 신의성실의 원칙에 따라 동의합니다.
                    </div>

                    <div id="nda-access-key-section" style="display: none; margin-bottom: 24px;">
                        <label class="form-label fw-bold mb-2" style="font-size: 14px; color: #1e293b;">접근 키 입력 (최대 3회 접근 가능)</label>
                        <div class="input-group">
                            <input type="text" id="nda-access-key" class="form-control" placeholder="6자리 영문/숫자 키를 입력해주세요"
                                style="border-radius: 12px; font-size: 15px; padding: 14px 18px; border: 2px solid #f1f5f9; background: #fbfcfd; transition: all 0.2s; text-transform: uppercase;">
                        </div>
                        <p class="small mt-2 mb-0" style="color: #94a3b8; font-size: 12px; margin-left: 2px;">
                            * 전달받은 6자리 접근 키를 입력하시면 서명 가이드가 활성화됩니다.
                        </p>
                    </div>

                    <div class="signature-section" style="padding: 10px 5px;">
                        <div class="mb-4">
                            <label class="form-label fw-bold mb-2" style="font-size: 14px; color: #1e293b;">서명 (성함 입력)</label>
                            <div class="input-group">
                                <input type="text" id="nda-signature-name" class="form-control" placeholder="성함을 정자로 입력해주세요"
                                    style="border-radius: 12px; font-size: 15px; padding: 14px 18px; border: 2px solid #f1f5f9; background: #fbfcfd; transition: all 0.2s;">
                            </div>
                            <p id="nda-name-hint" class="small mt-2 mb-0" style="color: #94a3b8; font-size: 12px; margin-left: 2px;">
                                * 현재 로그인 중인 <strong style="color: var(--page-theme-color);"><span id="logged-in-user-name"></span></strong> 님의 성함을 입력해주세요.
                            </p>
                        </div>
                        <div class="mb-2">
                            <label class="form-label fw-bold mb-2" style="font-size: 15px; color: #1e293b;">동의 문구 확인</label>
                            <p class="mb-3"
                                style="color: var(--page-theme-color); font-size: 16px; background: var(--page-theme-light); padding: 16px; border-radius: 12px; border: 1px dashed var(--page-theme-color); text-align: center; margin-bottom: 12px !important;">
                                <strong style="font-size: 18px; display: block; margin-bottom: 4px;">위 사항을 위반하지 않을 것을 약속합니다</strong>
                                <span style="font-size: 13px; color: #64748b; font-weight: 500;">* 위 문구를 아래 박스에 똑같이 입력해주세요.</span>
                            </p>
                            <div class="input-group">
                                <input type="text" id="nda-confirmation-text" class="form-control" placeholder="문구를 입력하세요"
                                    style="border-radius: 12px; font-size: 16px; padding: 14px 20px; border: 2px solid #f1f5f9; background: #fbfcfd; transition: all 0.2s; text-align: center; font-weight: 600;">
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer border-0 px-4 pb-4 pt-0 d-flex gap-2">
                    <button type="button" id="nda-modal-cancel-btn" class="btn px-4 py-2 rounded-pill fw-bold"
                        style="background: #f1f5f9; color: #64748b; font-size: 15px; flex: 1; height: 50px;">취소</button>
                    <button type="button" id="btn-confirm-nda" class="btn btn-primary px-4 py-2 rounded-pill fw-bold" disabled
                        style="background: var(--page-theme-color); border: none; font-size: 15px; flex: 2; height: 50px;
                               box-shadow: 0 4px 15px var(--page-theme-shadow); display: flex; align-items: center; justify-content: center; opacity: 0.5;">
                        동의 및 리포트 보기
                    </button>
                </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
})();
