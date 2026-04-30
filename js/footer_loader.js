/**
 * Footer Loader
 * 모든 페이지에 공통 하단바(Footer)와 유틸리티 요소(TOP 버튼 등)를 동적으로 주입합니다.
 */

(function () {
    function loadFooter() {
        const globalFooter = document.getElementById('global-footer');
        if (!globalFooter) return;

        const footerHtml = `
            <div class="footer-container">
                <div class="footer-info">
                    <div class="footer-top-row">
                        <span class="company-name">딜챗 주식회사</span>
                        <span class="footer-text-item">대표자 : 홍병만 | 개인정보관리책임자 : 홍병만 | 사업자등록번호 : 327-87-03034</span>
                        <span class="footer-text-item">서울특별시 마포구 월드컵로8길 45-8, 3층 3080호(서교동, 양성빌딩)</span>
                    </div>
                    <div class="disclaimer">
                        딜챗의 모든 콘텐츠는 저작권법의 보호를 받는 바, 당사와의 협의없이 무단 전재, 복사, 배포 시 민형사상 책임을 물을 수 있습니다.
                    </div>
                    <div class="footer-bottom-row">
                        <div class="copyright">© 2026 DEALCHAT all rights reserved.</div>
                        <div class="footer-links">
                            <a href="/terms" target="_blank">서비스 이용약관</a>
                            <a href="/privacy" target="_blank">개인정보 처리방침</a>
                            <a href="/marketing" target="_blank">마케팅 및 홍보 활용동의</a>
                        </div>
                    </div>
                </div>
            </div>
        `;


        globalFooter.innerHTML = footerHtml;
        globalFooter.classList.add('global-footer');
    }

    // 즉시 실행 시도
    if (document.getElementById('global-footer')) {
        loadFooter();
    } else {
        document.addEventListener('DOMContentLoaded', loadFooter);
    }
})();

