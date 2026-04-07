import os
import sys

def fix_js_file(filename, start_marker, end_marker, replacement_content):
    if not os.path.exists(filename):
        print(f"File {filename} not found")
        return False
    
    try:
        # Try reading as utf-8 but fallback to cp949 for Korean windows encoding
        content = ""
        for enc in ['utf-8', 'cp949', 'euc-kr']:
            try:
                with open(filename, 'r', encoding=enc) as f:
                    content = f.read()
                print(f"Read {filename} using {enc}")
                break
            except:
                continue
        
        if not content:
             # Last resort: ignore errors
             with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
                 content = f.read()

        start_idx = content.find(start_marker)
        if start_idx == -1:
            print(f"Start marker not found in {filename}")
            return False
            
        end_idx = content.find(end_marker, start_idx)
        if end_idx == -1:
            print(f"End marker not found in {filename}")
            return False
            
        # We find the FIRST closing marker after the start.
        # For functions, we might need to find the MATCHING closing brace, 
        # but for simple getIndustryIcon we can just take the closing one at the end of the block.
        # Actually, let's use a more unique end marker.
        
        new_content = content[:start_idx] + replacement_content + content[end_idx + len(end_marker):]
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Successfully updated {filename}")
        return True
    except Exception as e:
        print(f"Error fixing {filename}: {e}")
        return False

# Files are in the current directory if we run from js/
files_to_fix = [
    {
        "name": "total_sellers.js",
        "start": "function getIndustryIcon(industry) {",
        "end": "return iconMap[industry] || 'storefront';\n}",
        "replace": """function getIndustryIcon(industry) {
    const iconMap = {
        'AI': 'smart_toy',
        'IT/정보통신': 'computer',
        'SaaS/솔루션': 'cloud',
        '게임': 'sports_esports',
        '공공/국방': 'policy',
        '관광/레저': 'beach_access',
        '교육/에듀테크': 'school',
        '금융/핀테크': 'payments',
        '농축수산/임업': 'agriculture',
        '라이프스타일': 'person',
        '모빌리티': 'directions_car',
        '문화예술/콘텐츠': 'movie',
        '바이오/헬스케어': 'medical_services',
        '부동산': 'real_estate_agent',
        '뷰티/패션': 'content_cut',
        '에너지/환경': 'eco',
        '외식/식음료/소상공인': 'restaurant',
        '우주/항공': 'rocket',
        '유통/물류': 'local_shipping',
        '제조/건설': 'factory',
        '플랫폼/커뮤니티': 'groups',
        '기타': 'storefront'
    };
    return iconMap[industry] || 'storefront';
}"""
    },
    {
        "name": "total_companies.js",
        "start": "function getIndustryIcon(ind) {",
        "end": "return map[ind] || 'corporate_fare';\n}",
        "replace": """function getIndustryIcon(ind) {
    const map = { 'AI': 'smart_toy', 'IT·정보통신': 'computer', 'SaaS·솔루션': 'cloud', '게임': 'sports_esports', '공공·국방': 'policy', '관광·레저': 'beach_access', '교육·에듀테크': 'school', '금융·핀테크': 'payments', '농축산·어업': 'agriculture', '라이프스타일': 'person', '모빌리티': 'directions_car', '문화예술·콘텐츠': 'movie', '바이오·헬스케어': 'medical_services', '부동산': 'real_estate_agent', '뷰티·패션': 'content_cut', '에너지·환경': 'eco', '외식·중소상공인': 'restaurant', '우주·항공': 'rocket', '유통·물류': 'local_shipping', '제조·건설': 'factory', '플랫폼·커뮤니티': 'groups' };
    return map[ind] || 'corporate_fare';
}"""
    }
]

for item in files_to_fix:
    fix_js_file(item["name"], item["start"], item["end"], item["replace"])
