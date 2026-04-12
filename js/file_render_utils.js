/**
 * Signed URL을 생성하여 파일을 안전하게 다운로드합니다.
 * 1시간 유효한 서명된 URL을 반환합니다.
 */
export async function getSignedFileUrl(location) {
    if (!location) return null;
    if (location.startsWith('http')) return location; // 이미 전체 URL인 경우

    const _supabase = window.supabaseClient;
    if (!_supabase) {
        console.warn('Supabase client not available for signed URL');
        return null;
    }

    const { data, error } = await _supabase.storage
        .from('uploads')
        .createSignedUrl(location, 3600); // 1시간 유효

    if (error) {
        console.error('Signed URL 생성 실패:', error);
        return null;
    }
    return data.signedUrl;
}

/**
 * 클릭 시 Signed URL을 생성하여 새 탭에서 파일을 엽니다.
 */
export function openSignedFile(location) {
    return async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const url = await getSignedFileUrl(location);
        if (url) {
            window.open(url, '_blank');
        } else {
            alert('파일 URL을 생성할 수 없습니다. 다시 시도해주세요.');
        }
    };
}

/**
 * 파일 목록(학습 데이터/일반 파일)에 항목을 렌더링하는 공통 함수
 */
export function addFileToSourceList(name, id, location, isTraining, isFinance, parsedTextValue = null, status = null, themeColor = '#8b5cf6') {
    let target = '#source-list-training';
    const fileUrl = '#';
    
    // AI 검색 반영 여부 판단
    const isSearchable = parsedTextValue && typeof parsedTextValue === 'string' && !parsedTextValue.startsWith('[텍스트 미추출');
    
    // status가 특별히 지정되지 않은 경우, 데이터 속성에 따라 자동 결정
    if (!status) {
        // companies와 buyers의 인자 순서/의미가 약간 다를 수 있으므로 status가 직접 넘어오지 않은 경우 처리
        if (parsedTextValue === 'reflected' || parsedTextValue === 'failed' || parsedTextValue === 'loading') {
            status = parsedTextValue;
        } else {
            status = isSearchable ? 'reflected' : 'failed';
        }
    }

    let badgeHtml = '';
    if (status === 'loading') {
        badgeHtml = `<span class="ai-status-badge badge-ai-loading" style="font-size: 10px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #e2e8f0;">분석 중...</span>`;
    } else if (status === 'reflected') {
        // 테마 색상 기반 동적 스타일링
        const bgColor = themeColor + '1a'; // 10% opacity
        const borderColor = themeColor + '4d'; // 30% opacity
        badgeHtml = `<span class="ai-status-badge badge-ai-reflected" style="font-size: 10px; font-weight: 600; color: ${themeColor}; background: ${bgColor}; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid ${borderColor};">AI 반영됨</span>`;
    } else {
        badgeHtml = `<span class="ai-status-badge badge-ai-failed" style="font-size: 10px; font-weight: 600; color: #ef4444; background: #fee2e2; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #fecaca;">AI 불가</span>`;
    }

    const item = $(`
        <li class="list-group-item d-flex align-items-center justify-content-between bg-transparent" data-id="${id}" style="padding: 10px 16px !important; margin: 0 !important; border-bottom: 1px solid #f1f5f9 !important; border-top: none !important; border-left: none !important; border-right: none !important;">
            <div class="d-flex align-items-center overflow-hidden" style="flex: 1; min-width: 0; gap: 8px;">
                ${badgeHtml}
                <a href="${fileUrl}" target="_blank" class="text-decoration-none small text-truncate file-link" style="font-size: 13px; color: #334155 !important; flex: 1; min-width: 0; font-weight: 500;">${name}</a>
            </div>
            <button class="delete-file ms-2" data-id="${id}" style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 2px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.2s;"><span class="material-symbols-outlined" style="font-size: 16px;">close</span></button>
        </li>
    `);
    $(target).append(item);

    // Signed URL 기반 파일 열기 핸들러 등록
    if (location) {
        item.find('.file-link').on('click', openSignedFile(location));
    }

    // 버튼 호버 효과 추가
    item.find('.delete-file').hover(
        function() { $(this).css('opacity', '1'); },
        function() { $(this).css('opacity', '0.7'); }
    );

    return item;
}
