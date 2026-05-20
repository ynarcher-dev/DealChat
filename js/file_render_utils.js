import { reExtractTextFromFile, isAiPendingRetry } from './File_Functions.js';
import { showToast } from './toast_utils.js';

/**
 * Signed URL을 생성하여 파일을 안전하게 다운로드합니다.
 * 1시간 유효한 서명된 URL을 반환합니다.
 */
export async function getSignedFileUrl(location, storageType = 'supabase') {
    if (!location) return null;
    if (location.startsWith('http')) return location; // 이미 전체 URL인 경우

    const _supabase = window.supabaseClient;
    if (!_supabase) {
        console.warn('Supabase client not available for signed URL');
        return null;
    }

    // --- AWS S3 지원 추가 ---
    if (storageType === 's3') {
        try {
            const { data, error } = await _supabase.functions.invoke('get-s3-url', {
                body: { storagePath: location }
            });
            if (error) throw error;
            return data.url;
        } catch (err) {
            console.error('S3 Signed URL 생성 실패:', err);
            return null;
        }
    }

    // --- 기존 Supabase Storage 지원 ---
    const { data, error } = await _supabase.storage
        .from('uploads')
        .createSignedUrl(location, 3600); // 1시간 유효

    if (error) {
        console.error('Supabase Signed URL 생성 실패:', error);
        return null;
    }
    return data.signedUrl;
}

/**
 * 클릭 시 Signed URL을 생성하여 새 탭에서 파일을 엽니다.
 */
export function openSignedFile(location, storageType = 'supabase') {
    return async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const url = await getSignedFileUrl(location, storageType);
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
export function addFileToSourceList(name, id, location, isTraining, isFinance, parsedTextValue = null, status = null, themeColor = '#8b5cf6', storageType = 'supabase') {
    let target = isTraining ? '#source-list-training' : '#source-list-etc'; // Fix: Use isTraining to determine target
    if (isFinance) target = '#source-list-finance'; // If specific finance target exists
    
    const fileUrl = '#';
    
    // AI 검색 반영 여부 판단
    const isSearchable = parsedTextValue && typeof parsedTextValue === 'string' && !parsedTextValue.startsWith('[텍스트 미추출');
    const isPendingRetry = isAiPendingRetry(parsedTextValue);

    // status가 특별히 지정되지 않은 경우, 데이터 속성에 따라 자동 결정
    if (!status) {
        if (parsedTextValue === 'reflected' || parsedTextValue === 'failed' || parsedTextValue === 'loading') {
            status = parsedTextValue;
        } else {
            status = isSearchable ? 'reflected' : 'failed';
        }
    }

    // 배지 hover 시 표시되는 상세 사유 — 일시 장애와 이미지 문서를 구분해 안내
    const failedTitle = isPendingRetry
        ? 'AI 텍스트 추출 서버가 일시적으로 혼잡합니다. 잠시 후 새로고침 아이콘으로 재시도해주세요.'
        : '이미지 위주의 문서이거나 텍스트가 부족하여 AI 검색이 제한됩니다.';
    const reflectedTitle = 'AI 에이전트가 이 문서의 내용을 읽고 답변에 활용할 수 있습니다.';

    let badgeHtml = '';
    if (status === 'loading') {
        badgeHtml = `<span class="ai-status-badge badge-ai-loading" style="font-size: 10px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #e2e8f0;">분석 중...</span>`;
    } else if (status === 'reflected') {
        const bgColor = themeColor + '1a';
        const borderColor = themeColor + '4d';
        badgeHtml = `<span class="ai-status-badge badge-ai-reflected" title="${reflectedTitle}" style="font-size: 10px; font-weight: 600; color: ${themeColor}; background: ${bgColor}; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid ${borderColor};">AI 반영됨</span>`;
    } else {
        badgeHtml = `<span class="ai-status-badge badge-ai-failed" title="${failedTitle}" style="font-size: 10px; font-weight: 600; color: #ef4444; background: #fee2e2; padding: 2px 8px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; border: 1px solid #fecaca;">AI 불가</span>`;
    }

    const retryBtnHtml = (status === 'failed') ? `<button class="btn-reextract" data-id="${id}" title="AI 재인식 시도" style="background: none; border: none; cursor: pointer; color: #64748b; padding: 2px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: opacity 0.2s, transform 0.3s;"><span class="material-symbols-outlined" style="font-size: 16px;">refresh</span></button>` : '';

    const item = $(`
        <li class="list-group-item d-flex align-items-center justify-content-between bg-transparent" data-id="${id}" style="padding: 10px 16px !important; margin: 0 !important; border-bottom: 1px solid #f1f5f9 !important; border-top: none !important; border-left: none !important; border-right: none !important;">
            <div class="d-flex align-items-center overflow-hidden" style="flex: 1; min-width: 0; gap: 6px;">
                ${badgeHtml}
                <a href="${fileUrl}" target="_blank" class="text-decoration-none small text-truncate file-link" style="font-size: 13px; color: #334155 !important; flex: 1; min-width: 0; font-weight: 500;">${name}</a>
            </div>
            <div class="d-flex align-items-center" style="flex-shrink: 0; gap: 2px;">
                ${retryBtnHtml}
                <button class="delete-file" data-id="${id}" style="background: none; border: none; cursor: pointer; color: #ef4444; padding: 2px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.2s;"><span class="material-symbols-outlined" style="font-size: 16px;">close</span></button>
            </div>
        </li>
    `);

    item.find('.btn-reextract').hover(
        function() { $(this).css('opacity', '1'); },
        function() { $(this).css('opacity', '0.6'); }
    );
    
    // Ensure the target container exists before appending
    if ($(target).length) {
        $(target).append(item);
    } else {
        $('#source-list-training').append(item); // Fallback
    }

    // Signed URL 기반 파일 열기 핸들러 등록 (storageType 전달)
    if (location) {
        item.find('.file-link').on('click', openSignedFile(location, storageType));
    }

    item.find('.delete-file').hover(
        function() { $(this).css('opacity', '1'); },
        function() { $(this).css('opacity', '0.7'); }
    );

    return item;
}

const MIME_BY_EXT = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain'
};

/**
 * AI 불가로 표시된 파일의 텍스트를 Storage에서 재추출하여 DB와 UI를 갱신합니다.
 *
 * @param {jQuery} $item - 파일 행 <li> jQuery 객체 (배지/버튼 갱신용)
 * @param {object} fileMeta - 파일 메타 (id, file_name, storage_path|location, storage_type)
 * @param {object} supabaseClient - 페이지의 supabase 클라이언트 (DB 업데이트용)
 * @param {string} [themeColor='#8b5cf6'] - 성공 시 표시할 배지 테마 색상
 * @returns {Promise<{success: boolean, text: string|null}>}
 */
export async function reExtractAndUpdateFile($item, fileMeta, supabaseClient, themeColor = '#8b5cf6') {
    const $badge = $item.find('.ai-status-badge').first();
    const $btnRetry = $item.find('.btn-reextract').first();
    const $icon = $btnRetry.find('.material-symbols-outlined');

    $btnRetry.prop('disabled', true).css('cursor', 'wait');
    $icon.css({ animation: 'spin 1s linear infinite' });
    $badge.removeClass('badge-ai-failed badge-ai-reflected')
        .addClass('badge-ai-loading')
        .text('분석 중...')
        .css({ color: '#64748b', background: '#f1f5f9', 'border-color': '#e2e8f0' });

    try {
        const location = fileMeta.storage_path || fileMeta.location;
        if (!location) throw new Error('파일 경로 정보가 없습니다.');

        const url = await getSignedFileUrl(location, fileMeta.storage_type);
        if (!url) throw new Error('파일 URL을 생성할 수 없습니다.');

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`파일 다운로드 실패 (HTTP ${resp.status})`);
        const blob = await resp.blob();

        let contentType = blob.type;
        if (!contentType || contentType === 'application/octet-stream') {
            const ext = (fileMeta.file_name || '').split('.').pop().toLowerCase();
            contentType = MIME_BY_EXT[ext] || '';
        }
        const fileObj = new File([blob], fileMeta.file_name, { type: contentType });

        const newText = await reExtractTextFromFile(fileObj);
        const isSearchable = newText && !newText.startsWith('[텍스트 미추출');
        const isPendingRetry = isAiPendingRetry(newText);

        if (isSearchable) {
            const previewText = newText.length > 1000 ? newText.substring(0, 1000) + '...' : newText;
            const { error } = await supabaseClient.from('files').update({
                parsedtext: newText,
                summary: previewText
            }).eq('id', fileMeta.id);
            if (error) throw error;

            const bgColor = themeColor + '1a';
            const borderColor = themeColor + '4d';
            $badge.removeClass('badge-ai-loading').addClass('badge-ai-reflected')
                .text('AI 반영됨')
                .css({ color: themeColor, background: bgColor, 'border-color': borderColor });
            $btnRetry.remove();
            showToast(`"${fileMeta.file_name}" AI 인식에 성공했습니다.`, { icon: 'check_circle', iconColor: '#22c55e', duration: 3000 });
            return { success: true, text: newText };
        }

        $badge.removeClass('badge-ai-loading').addClass('badge-ai-failed')
            .text('AI 불가')
            .attr('title', isPendingRetry
                ? 'AI 텍스트 추출 서버가 일시적으로 혼잡합니다. 잠시 후 새로고침 아이콘으로 재시도해주세요.'
                : '이미지 위주의 문서이거나 텍스트가 부족하여 AI 검색이 제한됩니다.')
            .css({ color: '#ef4444', background: '#fee2e2', 'border-color': '#fecaca' });
        $btnRetry.prop('disabled', false).css('cursor', 'pointer');
        $icon.css({ animation: '' });
        if (isPendingRetry) {
            showToast(`"${fileMeta.file_name}": AI 텍스트 추출 서버 일시 혼잡. 잠시 후 새로고침 아이콘으로 다시 시도해주세요.`, { icon: 'schedule', iconColor: '#f59e0b', duration: 4500 });
        } else {
            showToast(`"${fileMeta.file_name}": 이미지 위주 문서로 보입니다. AI 검색에는 활용되지 않습니다.`, { icon: 'info', iconColor: '#64748b', duration: 4000 });
        }
        return { success: false, text: null };
    } catch (err) {
        console.error('Re-extraction error:', err);
        $badge.removeClass('badge-ai-loading').addClass('badge-ai-failed')
            .text('AI 불가')
            .css({ color: '#ef4444', background: '#fee2e2', 'border-color': '#fecaca' });
        $btnRetry.prop('disabled', false).css('cursor', 'pointer');
        $icon.css({ animation: '' });
        showToast(`재인식 실패: ${err.message || err}`, { icon: 'error', iconColor: '#ef4444', duration: 3500 });
        return { success: false, text: null };
    }
}
