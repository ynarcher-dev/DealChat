/**
 * URL Helper
 * 로컬(Live Server)과 배포(CloudFront) 환경을 자동 감지하여
 * clean URL을 적절한 경로로 변환합니다.
 *
 * - 배포 환경: /signin → /signin (변경 없음, CloudFront Function이 처리)
 * - 로컬 환경: /signin → /html/signin.html (직접 파일 경로로 변환)
 */
(function () {
    var isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Clean URL → 로컬 파일 경로 매핑
    var routeMap = {
        '/': '/html/signin.html',
        '/dashboard': '/html/index.html',
        '/signin': '/html/signin.html',
        '/signup': '/html/signup.html',
        '/forgot-password': '/html/forgot-password.html',
        '/reset-password': '/html/reset-password.html',
        '/total_companies': '/html/total_companies.html',
        '/total_sellers': '/html/total_sellers.html',
        '/total_buyers': '/html/total_buyers.html',
        '/my_companies': '/html/my_companies.html',
        '/my_sellers': '/html/my_sellers.html',
        '/my_buyers': '/html/my_buyers.html',
        '/dealbook_companies': '/html/dealbook_companies.html',
        '/dealbook_sellers': '/html/dealbook_sellers.html',
        '/dealbook_buyers': '/html/dealbook_buyers.html',
        '/shared_items': '/html/shared_items.html',
        '/nda_management': '/html/nda_management.html',
        '/mypage': '/html/mypage.html',
        '/files': '/html/files.html',
        '/qna': '/html/qna.html',
        '/terms': '/html/terms.html',
        '/privacy': '/html/privacy.html',
        '/marketing': '/html/marketing.html'
    };

    /**
     * Clean URL을 현재 환경에 맞는 경로로 변환합니다.
     * @param {string} cleanUrl - Clean URL (예: '/signin', '/dashboard?ref=1')
     * @returns {string} 변환된 URL
     */
    window.resolveUrl = function (cleanUrl) {
        if (!isLocal) return cleanUrl;

        // 경로와 쿼리스트링 분리
        var parts = cleanUrl.split('?');
        var path = parts[0];
        var query = parts[1] || '';

        var localPath = routeMap[path];
        if (localPath) {
            return query ? localPath + '?' + query : localPath;
        }
        return cleanUrl;
    };

    // <a> 태그 클릭 자동 인터셉트 (로컬 환경 전용)
    if (isLocal) {
        document.addEventListener('click', function (e) {
            var link = e.target.closest ? e.target.closest('a') : null;
            if (!link) return;

            var href = link.getAttribute('href');
            if (!href || href.startsWith('http') || href.startsWith('#') ||
                href.startsWith('mailto:') || href.startsWith('javascript:') ||
                href.startsWith('../') || href.startsWith('./')) return;

            var resolved = window.resolveUrl(href);
            if (resolved !== href) {
                e.preventDefault();
                if (link.target === '_blank') {
                    window.open(resolved, '_blank');
                } else {
                    window.location.href = resolved;
                }
            }
        });
    }
})();
