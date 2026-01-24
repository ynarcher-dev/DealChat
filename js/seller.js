import { APIcall } from './APIcallFunction.js';

const LAMBDA_URL = 'https://fx4w4useafzrufeqxfqui6z5p40aazkb.lambda-url.ap-northeast-2.on.aws/';
const userId = "67b320626fc0e9133183cb8b";

$(document).ready(function () {
    const urlParams = new URLSearchParams(window.location.search);
    const sellerId = urlParams.get('id');
    let selectedSharedFiles = [];
    let selectedShareTargets = [];

    if (!sellerId) {
        alert('잘못된 접근입니다.');
        location.href = './sellers.html';
        return;
    }

    // 1. 데이터 불러오기
    function loadSellerData() {
        APIcall({
            table: 'sellers',
            id: sellerId,
            userId: userId
        }, LAMBDA_URL, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert('데이터를 불러오는데 실패했습니다: ' + data.error);
                    return;
                }

                // 폼 채우기
                $('#seller-id').val(data.id || '');
                $('#companyName').val(data.companyName || '');
                $('#summary').val(data.summary || '');
                $('#industry').val(data.industry || '');
                $('#sale_method').val(data.sale_method || '');
                $('#sale_price').val(data.sale_price || '');
                $('#userId').val(data.userId || '');
                $('#others').val(data.others || '');

                // 공유 설정 채우기
                if (data.share_type) {
                    $(`input[name="share_type"][value="${data.share_type}"]`).prop('checked', true);
                    if (data.share_type === 'select') {
                        $('#share-target-wrapper').show();
                    }
                }

                if (Array.isArray(data.share_with)) {
                    selectedShareTargets = data.share_with;
                    renderShareTags();
                }

                // 공유 파일 채우기
                if (Array.isArray(data.share_files)) {
                    selectedSharedFiles = data.share_files;
                    renderSharedFileChips();
                }
            })
            .catch(error => {
                console.error('Fetch Error:', error);
                alert('데이터 로딩 중 오류가 발생했습니다.');
            });
    }

    loadSellerData();

    // 2. 공유 파일 칩 렌더링
    function renderSharedFileChips() {
        const $container = $('#shared-files-container');
        $container.empty();
        selectedSharedFiles.forEach((fileName, index) => {
            const $chip = $(`
                <div class="chip">
                    <span class="material-symbols-outlined" style="font-size: 16px;">attachment</span>
                    <span>${fileName}</span>
                    <span class="remove-file" data-index="${index}">
                        <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">close</span>
                    </span>
                </div>
            `);
            $container.append($chip);
        });
    }

    // 3. 공유 대상 태그 렌더링
    function renderShareTags() {
        const $container = $('#share-tags-container');
        $container.empty();
        selectedShareTargets.forEach((name, index) => {
            const $tag = $(`
                <div class="chip">
                    <span>${name}</span>
                    <span class="remove-target" data-index="${index}">
                        <span class="material-symbols-outlined" style="font-size: 16px; cursor: pointer;">close</span>
                    </span>
                </div>
            `);
            $container.append($tag);
        });
    }

    // 4. 이벤트 핸들러

    // 파일 입력 처리
    $('#share-file-input').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const fileName = $(this).val().trim();
            if (fileName && !selectedSharedFiles.includes(fileName)) {
                selectedSharedFiles.push(fileName);
                renderSharedFileChips();
                $(this).val('');
            }
        }
    });

    $(document).on('click', '.remove-file', function () {
        const index = $(this).data('index');
        selectedSharedFiles.splice(index, 1);
        renderSharedFileChips();
    });

    // 대상 선택 입력 처리
    $('#share-with-input').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const name = $(this).val().trim();
            if (name && !selectedShareTargets.includes(name)) {
                selectedShareTargets.push(name);
                renderShareTags();
                $(this).val('');
            }
        }
    });

    $(document).on('click', '.remove-target', function () {
        const index = $(this).data('index');
        selectedShareTargets.splice(index, 1);
        renderShareTags();
    });

    // 공유 타입 변경 감지
    $('input[name="share_type"]').on('change', function () {
        if ($(this).val() === 'select') {
            $('#share-target-wrapper').fadeIn(200);
        } else {
            $('#share-target-wrapper').fadeOut(200);
        }
    });

    // 5. 저장 처리
    $('#save-btn').on('click', function () {
        const formData = {
            id: $('#seller-id').val(),
            companyName: $('#companyName').val(),
            summary: $('#summary').val(),
            industry: $('#industry').val(),
            sale_method: $('#sale_method').val(),
            sale_price: $('#sale_price').val(),
            userId: $('#userId').val(),
            others: $('#others').val(),
            share_files: selectedSharedFiles,
            share_type: $('input[name="share_type"]:checked').val(),
            share_with: selectedShareTargets,
            table: 'sellers',
            action: 'update'
        };

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('저장 중...');

        APIcall(formData, LAMBDA_URL, {
            'Content-Type': 'application/json'
        })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('저장 중 오류가 발생했습니다: ' + result.error);
                } else {
                    alert('성공적으로 저장되었습니다.');
                }
            })
            .catch(error => {
                console.error('Save Error:', error);
                alert('저장 요청에 실패했습니다.');
            })
            .finally(() => {
                $btn.prop('disabled', false).text(originalText);
            });
    });
});
