$(document).ready(function () {
    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    const $guidePanel = $('#guide-panel');

    // URL에서 id 파라미터 추출
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');

    // 현재 불러온 회사 데이터를 저장할 변수
    let currentCompanyData = null;
    const LAMBDA_URL = 'https://fx4w4useafzrufeqxfqui6z5p40aazkb.lambda-url.ap-northeast-2.on.aws/';

    // 회사 ID가 있으면 Lambda에서 데이터 가져오기
    if (companyId) {
        fetch(LAMBDA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                table: 'companies',
                id: companyId
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    console.error('데이터를 불러오는 중 오류가 발생했습니다:', data.error);
                } else {
                    currentCompanyData = data;
                    console.log('회사 정보:', data);

                    if (data.companyName) {
                        $('.notebook-title').text(data.companyName);
                    }

                    if (data.summary) {
                        $('#summary').val(data.summary);
                    }
                }
            })
            .catch(error => {
                console.error('데이터 로드 실패:', error);
            });
    }

    // Save 버튼 클릭 이벤트
    $('#save-summary').on('click', function () {
        if (!currentCompanyData) {
            alert('수정할 데이터가 로드되지 않았습니다.');
            return;
        }

        const updatedSummary = $('#modal-summary-text').val();
        
        // 기존 데이터에 수정된 요약본 반영
        const updatePayload = {
            ...currentCompanyData,
            summary: updatedSummary,
            table: 'companies',
            action: 'update' // Lambda에서 저장 로직을 타게 하기 위한 식별자
        };

        const $btn = $(this);
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('Saving...');

        // PUT 대신 POST를 사용하여 405 Method Not Allowed 에러 방지
        fetch(LAMBDA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatePayload)
        })
            .then(response => response.json())
            .then(result => {
                if (result.error) {
                    alert('저장 중 오류가 발생했습니다: ' + result.error);
                } else {
                    // 로컬 데이터 및 UI 업데이트
                    currentCompanyData.summary = updatedSummary;
                    $('#summary').val(updatedSummary);
                    $summaryModal.hide();
                }
            })
            .catch(error => {
                console.error('저장 실패:', error);
                alert('저장 요청에 실패했습니다.');
            })
            .finally(() => {
                $btn.prop('disabled', false).text(originalText);
            });
    });

    // Auto-resize textarea
    $chatInput.on('input', function () {
        $(this).css('height', 'auto');
        $(this).css('height', this.scrollHeight + 'px');
    });

    // Send message function
    function sendMessage() {
        const text = $chatInput.val().trim();
        if (text) {
            if ($welcomeScreen.length) {
                $welcomeScreen.hide();
            }

            // User Message
            addMessage(text, 'user');
            $chatInput.val('').css('height', 'auto');

            // Simulate AI response
            setTimeout(() => {
                addAiResponse(text);
            }, 800);
        }
    }

    function addMessage(text, sender) {
        const avatar = sender === 'ai'
            ? '<div class="avatar material-symbols-outlined">auto_awesome</div>'
            : '<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" class="avatar">';

        const messageHtml = `
            <div class="message ${sender}">
                ${sender === 'ai' ? avatar : ''}
                <div class="message-content">${text}</div>
                ${sender === 'user' ? avatar : ''}
            </div>
        `;

        const $message = $(messageHtml);
        $chatMessages.append($message);

        // Scroll to bottom
        $chatMessages.animate({ scrollTop: $chatMessages[0].scrollHeight }, 300);
    }

    function addAiResponse(userInput) {
        let response = "";
        if (userInput.includes("요약")) {
            response = "업로드된 소스들을 바탕으로 한 요약입니다:<br>1. 2024 신규 사업 전략은 AI 기술 도입을 최우선 과제로 선정했습니다.<br>2. 주요 타겟 시장은 동남아시아 3개국입니다.<br>3. 예산은 전년 대비 15% 증액되었습니다.";
        } else if (userInput.includes("시장")) {
            response = "시장 분석 결과, 현재 생성형 AI 솔루션에 대한 수요가 급증하고 있습니다. 특히 리서치 보조 도구 분야에서 연평균 30% 성장이 기대됩니다.";
        } else {
            response = `'${userInput}'에 대해 소스를 분석한 결과, 관련 내용은 프로젝트 개요 PDF의 4페이지와 시장 조사 보고서의 12페이지에서 언급되고 있습니다. 추가로 구체적인 내용이 필요하신가요?`;
        }

        addMessage(response, 'ai');
    }

    // Event Listeners
    $('#send-btn').on('click', sendMessage);

    $chatInput.on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Sidebar Toggle
    $('#toggle-sidebar').on('click', function () {
        $('.sidebar').toggleClass('collapsed');
        const isCollapsed = $('.sidebar').hasClass('collapsed');
        $(this).find('.material-symbols-outlined').text(isCollapsed ? 'menu' : 'menu_open');
    });

    // Guide Panel Toggle
    $('.btn-primary').on('click', function () {
        $guidePanel.toggleClass('hidden');
    });

    $('#close-guide').on('click', function () {
        $guidePanel.addClass('hidden');
    });

    // Prompt Chips
    $('.prompt-chip').on('click', function () {
        const promptText = $(this).text();
        $chatInput.val(promptText);
        sendMessage();
    });

    // Summary Expand Modal Logic
    const $summaryModal = $('#summary-modal');
    const $summaryText = $('#summary');
    const $modalSummaryText = $('#modal-summary-text');

    $('#expand-summary').on('click', function () {
        $modalSummaryText.val($summaryText.val());
        $summaryModal.css('display', 'flex');
    });

    $('#close-summary-modal').on('click', function () {
        $summaryModal.hide();
    });



    // AI Generate Logic (in Modal)
    $('#ai-generate').on('click', function () {
        const $btn = $(this);
        const originalText = $btn.html();
        
        $btn.prop('disabled', true).html('<span class="material-symbols-outlined spin" style="font-size: 18px;">sync</span> 생성 중...');
        
        // Simulate AI generation delay
        setTimeout(() => {
            const aiGeneratedSummary = "이 회사는 2010년에 설립된 AI 기반 리서치 전문 기업입니다.\n\n주요 성과:\n1. 독자적인 NLP 모델 개발\n2. 글로벌 500대 기업 중 50개사와 파트너십 체결\n3. 2023년 시리즈 B 투자 유치 성공\n\n현재 DealChat 프로젝트를 통해 혁신적인 투자 검토 프로세스를 구축하고 있습니다.";
            $modalSummaryText.val(aiGeneratedSummary);
            $btn.prop('disabled', false).html(originalText);
        }, 1500);
    });

    // Close modal on click outside
    $summaryModal.on('click', function (e) {
        if ($(e.target).hasClass('modal-overlay')) {
            $summaryModal.hide();
        }
    });

    // Add Source logic
    const $fileUpload = $('#file-upload');
    const $sourceList = $('#source-list');

    $('#add-source').on('click', function () {
        $fileUpload.click();
    });

    $fileUpload.on('change', function (e) {
        const files = e.target.files;
        if (files.length > 0) {
            if ($welcomeScreen.length) {
                $welcomeScreen.hide();
            }

            Array.from(files).forEach(file => {
                const icon = getFileIcon(file.name);
                const $newItem = $(`
                    <li class="source-item">
                        <span class="material-symbols-outlined">${icon}</span>
                        <span class="source-name">${file.name}</span>
                    </li>
                `);

                $newItem.on('click', function () {
                    $('.source-item').removeClass('active');
                    $(this).addClass('active');
                });

                $sourceList.append($newItem);
            });

            addMessage(`${files.length}개의 소스가 추가되었습니다.`, 'ai');

            // Reset input so the same file can be uploaded again if needed
            $fileUpload.val('');
        }
    });

    function getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
            case 'pdf': return 'description';
            case 'doc':
            case 'docx': return 'article';
            case 'txt': return 'text_fields';
            default: return 'attachment';
        }
    }
});
