import { checkAuth } from './auth_utils.js';
import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

$(document).ready(function () {
    const userData = checkAuth();
    if (!userData) return;
    const userId = userData.id;

    // URL 파라미터에서 ID 추출
    const urlParams = new URLSearchParams(window.location.search);
    const buyerId = urlParams.get('id');

    // --- Tag Handling Logic ---
    let selectedUsers = [];

    const renderTags = () => {
        const $container = $('#share-tags-container');
        $container.empty();

        selectedUsers.forEach(user => {
            const tagHtml = `
                <div class="chip">
                    <span>${user}</span>
                    <span class="remove material-symbols-outlined" data-user="${user}" style="font-size: 16px; cursor: pointer;">close</span>
                </div>
            `;
            $container.append(tagHtml);
        });
    };

    // Tag Input Event Listener
    $('#share-with-input').on('keydown', function (e) {
        if (e.originalEvent.isComposing) {
            return;
        }

        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = $(this).val().trim().replace(/,/g, '');

            if (val && !selectedUsers.includes(val)) {
                selectedUsers.push(val);
                renderTags();
            }
            $(this).val('');
        }
    });

    // Tag Remove Event Listener (Delegate)
    $('#share-tags-container').on('click', '.remove', function () {
        const userToRemove = $(this).data('user');
        selectedUsers = selectedUsers.filter(user => user !== userToRemove);
        renderTags();
    });

    // Radio button change listener
    $('input[name="share_type"]').on('change', function () {
        if ($(this).val() === 'select') {
            $('#share-target-wrapper').show();
        } else {
            $('#share-target-wrapper').hide();
        }
    });

    if (buyerId) {
        loadBuyerData(buyerId);
    } else {
        // 신규 등록 모드
        const randomId = crypto.randomUUID();
        $('#buyer-id').val(randomId);
        $('#userId').val(userId);
        $('input[name="share_type"][value="public"]').prop('checked', true);
        $('#share-target-wrapper').hide();
    }

    // 데이터 로드 함수
    function loadBuyerData(id) {
        APIcall({
            action: 'get',
            table: 'buyers',
            id: id
        }, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(data => {
                const item = Array.isArray(data) ? data[0] : data;
                console.log(item);
                if (item) {
                    $('#buyer-id').val(item.id);
                    $('#companyName').val(item.companyName);
                    $('#summary').val(item.summary);
                    $('#interest_summary').val(item.interest_summary);
                    $('#interest_industry').val(item.interest_industry);
                    $('#investment_amount').val(item.investment_amount);
                    $('#etc').val(item.etc);
                    $('#userId').val(item.userId);
                    $('#created_at').val(item.created_at);
                    $('#updated_at').val(item.updated_at);

                    // 공유 설정 (share_type) 라디오 버튼 매칭
                    let visibilityScope = item.share_type || 'private';
                    if (visibilityScope === 'selective') visibilityScope = 'select';

                    $(`input[name="share_type"][value="${visibilityScope}"]`).prop('checked', true);

                    // 공유 대상 (selective_users) 처리
                    const usersStr = item.selective_users || '';
                    if (usersStr) {
                        selectedUsers = usersStr.split(',').map(s => s.trim()).filter(s => s);
                        renderTags();
                    }

                    // Show/hide selective users input based on current value
                    if (visibilityScope === 'select') {
                        $('#share-target-wrapper').show();
                    } else {
                        $('#share-target-wrapper').hide();
                    }
                }
            })
            .catch(err => console.error('Data Load Error:', err));
    }

    // 저장 버튼 이벤트
    $('#save-btn').on('click', function () {
        const formData = {
            id: $('#buyer-id').val(),
            companyName: $('#companyName').val(),
            summary: $('#summary').val(),
            interest_summary: $('#interest_summary').val(),
            interest_industry: $('#interest_industry').val(),
            investment_amount: $('#investment_amount').val(),
            etc: $('#etc').val(),
            userId: $('#userId').val(),
            share_type: $('input[name="share_type"]:checked').val(),
            selective_users: selectedUsers.join(','),
            updated_at: new Date().toISOString(),
            table: 'buyers',
            action: buyerId ? 'update' : 'upload'
        };

        // 신규 등록 시 created_at 추가
        if (!buyerId) {
            formData.created_at = new Date().toISOString();
        }

        const $btn = $(this);
        $btn.prop('disabled', true).text('저장 중...');

        APIcall(formData, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('저장 오류: ' + result.error);
                } else {
                    alert('저장되었습니다.');
                    // 저장 후 목록으로 이동
                    location.href = './buyers.html';
                }
            })
            .catch(err => alert('요청 실패: ' + err.message))
            .finally(() => $btn.prop('disabled', false).text('Update'));
    });

    // 삭제 버튼 이벤트
    $('#delete-btn').on('click', function () {
        if (!buyerId) {
            alert('삭제할 수 없습니다.');
            return;
        }

        if (!confirm('정말로 삭제하시겠습니까?')) return;

        const id = $('#buyer-id').val();
        APIcall({
            action: 'delete',
            table: 'buyers',
            id: id
        }, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(() => {
                alert('삭제되었습니다.');
                location.href = './buyers.html';
            })
            .catch(err => alert('삭제 실패: ' + err.message));
    });
});
