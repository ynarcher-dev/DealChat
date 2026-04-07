$ErrorActionPreference = "Stop"

function Fix-File {
    param($Path, $StartLine, $EndLine, $NewLines)
    Write-Host "Fixing $Path..."
    # Read without explicit encoding to let PS decide, or use -Encoding String if available
    $content = Get-Content $Path
    
    $newArray = @()
    for ($i=0; $i -lt $content.Count; $i++) {
        if ($i -lt $StartLine -or $i -gt $EndLine) {
            $newArray += $content[$i]
        } elseif ($i -eq $StartLine) {
            foreach ($line in $NewLines) {
                $newArray += $line
            }
        }
    }
    # Save as UTF8 (usually with BOM in PS 5.1, which is fine for modern browsers)
    $newArray | Set-Content $Path -Encoding utf8
}

# Fix total_sellers.js
$sellersPath = "g:\.shortcut-targets-by-id\1rDq3ilZaYhKKwzY4dRHbmnDNYC0FvfR-\서비스 및 개발 관리\DealChat\js\total_sellers.js"
$sellersIcons = @(
    '    const iconMap = {',
    '        "AI": "smart_toy",',
    '        "IT/정보통신": "computer",',
    '        "SaaS/솔루션": "cloud",',
    '        "게임": "sports_esports",',
    '        "공공/국방": "policy",',
    '        "관광/레저": "beach_access",',
    '        "교육/에듀테크": "school",',
    '        "금융/핀테크": "payments",',
    '        "농축수산/임업": "agriculture",',
    '        "라이프스타일": "person",',
    '        "모빌리티": "directions_car",',
    '        "문화예술/콘텐츠": "movie",',
    '        "바이오/헬스케어": "medical_services",',
    '        "부동산": "real_estate_agent",',
    '        "뷰티/패션": "content_cut",',
    '        "에너지/환경": "eco",',
    '        "외식/식음료/소상공인": "restaurant",',
    '        "우주/항공": "rocket",',
    '        "유통/물류": "local_shipping",',
    '        "제조/건설": "factory",',
    '        "플랫폼/커뮤니티": "groups",',
    '        "기타": "storefront"',
    '    };'
)
Fix-File -Path $sellersPath -StartLine 244 -EndLine 267 -NewLines $sellersIcons

# Fix total_companies.js
$companiesPath = "g:\.shortcut-targets-by-id\1rDq3ilZaYhKKwzY4dRHbmnDNYC0FvfR-\서비스 및 개발 관리\DealChat\js\total_companies.js"
Fix-File -Path $companiesPath -StartLine 314 -EndLine 314 -NewLines @('    const categories = ["AI", "IT/정보통신", "SaaS/솔루션", "게임", "공공/국방", "관광/레저", "교육/에듀테크", "금융/핀테크", "농축수산/임업", "라이프스타일", "모빌리티", "문화예술/콘텐츠", "바이오/헬스케어", "부동산", "뷰티/패션", "에너지/환경", "외식/식음료/소상공인", "우주/항공", "유통/물류", "제조/건설", "플랫폼/커뮤니티", "기타"];')

# Fix mypage.js (basic syntax repair for alert messages)
$mypagePath = "g:\.shortcut-targets-by-id\1rDq3ilZaYhKKwzY4dRHbmnDNYC0FvfR-\서비스 및 개발 관리\DealChat\js\mypage.js"
# Note: I'll only fix a few critical ones to avoid line number guessing without viewing the whole file again carefully
# Actually, I'll just leave mypage.js for now and focus on the list rendering which is the primary objective.
