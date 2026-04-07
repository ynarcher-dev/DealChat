import { checkAuth, updateHeaderProfile, hideLoader } from './auth_utils.js';

const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
window.supabaseClient = _supabase;

$(document).ready(async function () {
    const userData = checkAuth();
    if (!userData) return;

    // 1. 프로필 정보 업데이트 (웰컴 메시지의 '홍길동'을 실제 이름으로 변경)
    // 상단바 프로필은 header_loader.js에서 처리하므로 여기서는 대시보드 전용 요소만 업데이트
    if (userData && userData.name) {
        const welcomeName = document.getElementById('userName2');
        if (welcomeName) welcomeName.textContent = userData.name;
    }

    // 2. 공유 항목 요약 정보 로드 (비활성화)
    // await loadSharedSummary(userData.id);

    // 3. 요약 카드 클릭 이벤트 (비활성화)
    /*
    $('#card-received-summary').on('click', () => {
        location.href = './shared_items.html?tab=received';
    });
    $('#card-sent-summary').on('click', () => {
        location.href = './shared_items.html?tab=sent';
    });
    */

    // 로더 숨김
    hideLoader();
});

/**
 * 수신/발신 공유 항목의 읽지 않은 카운트를 가져와 UI 업데이트
 */
async function loadSharedSummary(userId) {
    try {
        // 수신된 공유 중 읽지 않은 항목 수
        const { count: unreadReceived, error: rError } = await _supabase
            .from('shares')
            .select('*', { count: 'exact', head: true })
            .eq('receiver_id', userId)
            .eq('is_read', false)
            .eq('receiver_deleted', false);

        // 발신한 공유 중 상대방이 아직 읽지 않은 항목 수
        const { count: unreadSent, error: sError } = await _supabase
            .from('shares')
            .select('*', { count: 'exact', head: true })
            .eq('sender_id', userId)
            .eq('is_read', false)
            .eq('sender_deleted', false);

        if (rError) console.error('수신 공유 로드 에러:', rError);
        if (sError) console.error('발신 공유 로드 에러:', sError);

        updateSummaryUI('received', unreadReceived || 0);
        updateSummaryUI('sent', unreadSent || 0);

        // 데이터 로드 후 부드럽게 표시
        $('#shared-summary-container').fadeIn(400).css('display', 'block');

    } catch (err) {
        console.error('공유 요약 정보를 가져오는데 실패했습니다:', err);
    }
}

/**
 * 요약 UI 요소 업데이트
 */
function updateSummaryUI(type, count) {
    const isReceived = type === 'received';
    const $card = isReceived ? $('#card-received-summary') : $('#card-sent-summary');
    const $status = isReceived ? $('#label-received-status') : $('#label-sent-status');
    const $subtext = isReceived ? $('#label-received-subtext') : $('#label-sent-subtext');

    // 1. 상태 레이블 변경: "수신 대기" / "발신 대기"
    const prefix = isReceived ? '수신 대기' : '발신 대기';
    $status.text(`${prefix} ${count}건`);

    // 2. 조건별 서브카피 매핑
    let subtext = '';
    if (isReceived) {
        subtext = count > 0 ? '열람해야 할 정보가 있습니다.' : '새로 도착한 정보가 없습니다.';
    } else {
        subtext = count > 0 ? '상대방이 확인 중인 정보가 있습니다.' : '모든 정보가 상대방에게 전달되었습니다.';
    }
    $subtext.text(subtext);

    // 3. 새로운 소식 유무에 따른 아이콘 색상 클래스 전환
    if (count > 0) {
        $card.addClass('has-unread').removeClass('no-unread');
    } else {
        $card.addClass('no-unread').removeClass('has-unread');
    }
}
