
$(document).ready(function () {
    const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

    $('#qna-form').on('submit', function (e) {
        e.preventDefault();

        // 1. Validate form
        const inquiryType = $('input[name="inquiryType"]:checked').val();
        if (!inquiryType) {
            alert("문의 유형을 선택해주세요.");
            return;
        }

        const formData = {
            table: 'qna',
            action: 'upload',
            inquiry_type: inquiryType,
            name: $('input[name="name"]').val().trim(),
            contact: $('input[name="contact"]').val().trim(),
            email: $('input[name="email"]').val().trim(),
            company_name: $('input[name="companyName"]').val().trim(),
            subject: $('input[name="subject"]').val().trim(),
            content: $('textarea[name="content"]').val().trim(),
        };

        const $btn = $('.btn-submit');
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('제출 중...');

        // 2. Submit data via API
        if (typeof APIcall === 'undefined') {
            console.error("APIcall function is missing.");
            alert("시스템 오류가 발생했습니다. 관리자에게 문의해주세요.");
            $btn.prop('disabled', false).text(originalText);
            return;
        }

        APIcall(formData, SUPABASE_ENDPOINT, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('제출 중 오류가 발생했습니다: ' + result.error);
                } else {
                    alert("상담 문의가 성공적으로 접수되었습니다.\n담당자 확인 후 연락드리겠습니다.");
                    $('#qna-form')[0].reset();
                }
            })
            .catch(error => {
                console.error('Q&A Submit Error:', error);
                alert('제출 요청에 실패했습니다.');
            })
            .finally(() => {
                $btn.prop('disabled', false).text(originalText);
            });
    });
});
